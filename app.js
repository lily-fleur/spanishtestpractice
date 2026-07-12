// ── 初期データ ────────────────────────────────────────────────
const INITIAL_WORDS = [
  { id: "1", es: "el gato",     ja: "猫",    category: "動物" },
  { id: "2", es: "el perro",    ja: "犬",    category: "動物" },
  { id: "3", es: "comer",       ja: "食べる", category: "動詞" },
  { id: "4", es: "beber",       ja: "飲む",  category: "動詞" },
  { id: "5", es: "el pan",      ja: "パン",  category: "食べ物" },
  { id: "6", es: "la manzana",  ja: "りんご", category: "食べ物" },
];

const CATEGORIES = ["動物", "動詞", "食べ物", "形容詞", "名詞", "その他"];
const STORAGE_KEY = "espanyol-quiz-data";

// ── 状態 ──────────────────────────────────────────────────────
let state = {
  words: [...INITIAL_WORDS],
  stats: {},           // { [wordId]: { correct, wrong } }
  tab: "quiz",
  quizFilter: "全て",
  quizLevel: "全て",   // DELEソース時のレベルフィルター
  sessionSize: 20,     // 1セッションの出題数（"all"で全部）
  source: "my",        // my | dele
  _myWords: null,
  _deleWords: [],
  quizMode: "choice",  // choice | spell | example
  quizDir:  "es-ja",   // es-ja | ja-es

  // クイズ
  queue: [],
  qIndex: 0,
  choices: [],
  selected: null,
  showResult: false,
  sessionRight: 0,
  sessionWrong: 0,
  quizDone: false,
  streak: 0,
  maxStreak: 0,
  wrongIds: [],
  reviewMode: false,
  spellAnswer: "",
  spellChecked: false,

  // 単語フォーム
  editId: null,
  newEs: "",
  newJa: "",
  newCat: CATEGORIES[0],
};

// ── 永続化 ────────────────────────────────────────────────────
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.words) state.words = data.words;
      if (data.stats) state.stats = data.stats;
      if (data.srs)   state.srs   = data.srs;
      state._deleWords = data.wordsDele ?? [];
      state.source     = data.source ?? "my";
      state.sessionSize = data.sessionSize ?? 20;
      state._myWords   = data.words ?? state.words;
      // 現在ソースのビューをセット
      state.words = state.source === "my" ? state._myWords : state._deleWords;
    }
  } catch (_) {}
}

function saveData() {
  try {
    // 現在編集中の単語を実体に同期
    if (state.source === "my") state._myWords   = state.words;
    else                       state._deleWords = state.words;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      words:     state._myWords ?? state.words,
      wordsDele: state._deleWords ?? [],
      source:    state.source,
      sessionSize: state.sessionSize,
      stats: state.stats,
      srs:   state.srs ?? {},
    }));
  } catch (_) {}
}


// ── アクセント正規化 ──────────────────────────────────────────
function normalizeText(str) {
  return str.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function checkSpelling(input, correct) {
  // スペイン語はアクセント無視、日本語はそのまま比較
  const isSpanish = /[a-zA-Z]/.test(correct);
  if (isSpanish) return normalizeText(input) === normalizeText(correct);
  return input.trim() === correct.trim();
}



// ── グローバルキーハンドラ（初期化時に1個だけ登録・累積なし）──
function globalQuizKeyHandler(e) {
  if (state.tab !== "quiz" || state.quizDone) return;
  if (state.queue.length === 0) return;

  if (state.quizMode === "spell") {
    // inputにフォーカスがあるときはform submitが処理するのでスキップ（二重発火防止）
    const active = document.activeElement;
    if (active && active.id === "spell-input") return;
    // スペル：確認から400ms以上たったEnterで次へ（確認Enterとの連鎖防止）
    if (e.key === "Enter" && state.spellChecked &&
        Date.now() - (state.spellCheckedAt || 0) > 400) {
      nextQuestion();
    }
    return;
  }

  // 4択・例文モード
  if (e.key === "Enter" && state.showResult) {
    nextQuestion();
    return;
  }
  const idx = parseInt(e.key) - 1;
  if (!state.showResult && !isNaN(idx) && idx >= 0 && idx < state.choices.length) {
    handleAnswer(state.choices[idx].id);
  }
}

// ── 音声読み上げ ──────────────────────────────────────────────
function speakSpanish(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "es-ES";
  utter.rate = 0.9;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}

// ── ユーティリティ ────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWrong(correct, count = 3) {
  const pool = state.words.filter(w => String(w.id) !== String(correct.id));
  return shuffle(pool).slice(0, count);
}

function getWrongRate(wordId) {
  const s = state.stats[wordId] ?? { correct: 0, wrong: 0 };
  const total = s.correct + s.wrong;
  return total === 0 ? 0.5 : s.wrong / total;
}

// ── クイズロジック ────────────────────────────────────────────
// ── SRS（間隔反復）────────────────────────────────────────────
// レベル別の復習間隔（ミリ秒）
const SRS_INTERVALS = [
  10 * 60 * 1000,           // Lv0→1: 10分
  24 * 60 * 60 * 1000,      // Lv1→2: 1日
  3  * 24 * 60 * 60 * 1000, // Lv2→3: 3日
  7  * 24 * 60 * 60 * 1000, // Lv3→4: 1週間
  14 * 24 * 60 * 60 * 1000, // Lv4→5: 2週間
  30 * 24 * 60 * 60 * 1000, // Lv5:    1ヶ月
];
const SRS_MAX_LEVEL = 5;

function getSrs(wordId) {
  if (!state.srs) state.srs = {};
  return state.srs[String(wordId)] ?? { level: 0, nextReview: 0 };
}

function updateSrs(wordId, isCorrect) {
  if (!state.srs) state.srs = {};
  const cur = getSrs(wordId);
  if (isCorrect) {
    const newLevel = Math.min(cur.level + 1, SRS_MAX_LEVEL);
    state.srs[String(wordId)] = {
      level: newLevel,
      nextReview: Date.now() + SRS_INTERVALS[Math.min(newLevel, SRS_INTERVALS.length - 1)],
    };
  } else {
    state.srs[String(wordId)] = { level: 0, nextReview: Date.now() };
  }
}

// 復習期日が来ている単語の数
function countDueWords(filterCat) {
  const pool = filterCat === "全て"
    ? state.words
    : state.words.filter(w => w.category === filterCat);
  const now = Date.now();
  return pool.filter(w => {
    const s = getSrs(w.id);
    return s.level > 0 && s.nextReview <= now;
  }).length;
}

function buildQueue(filterCat) {
  let pool = state.words;
  if (state.source === "dele") {
    // DELE: レベル（category列）＋ジャンル（genre列）の2段フィルター
    if (state.quizLevel !== "全て") pool = pool.filter(w => w.category === state.quizLevel);
    if (filterCat !== "全て")       pool = pool.filter(w => (w.genre ?? "") === filterCat);
  } else {
    if (filterCat !== "全て") pool = pool.filter(w => w.category === filterCat);
  }
  if (pool.length === 0) return [];

  const now = Date.now();

  // SRS分類：復習期日到来 / 新規（未学習） / 学習済み（期日前）
  const due      = [];  // 復習期日が来た単語（最優先）
  const fresh    = [];  // まだ一度も正解していない単語
  const learning = [];  // 学習済みで期日前の単語

  for (const w of pool) {
    const s = getSrs(w.id);
    if (s.level === 0)            fresh.push(w);
    else if (s.nextReview <= now) due.push(w);
    else                          learning.push(w);
  }

  // 苦手単語（間違い率が高い）はさらに優先度UP
  const sortByWrong = arr => arr.sort((a, b) => getWrongRate(b.id) - getWrongRate(a.id));
  sortByWrong(due);
  sortByWrong(fresh);

  // 期日到来 → 新規 → 学習済みの順で並べる（ダブりなし：1単語1問）
  const ordered = [...due, ...fresh, ...shuffle(learning)];
  return shuffle(ordered);
}

function startQuiz(reviewQueue) {
  if (reviewQueue && reviewQueue.length > 0) {
    state.queue = shuffle(reviewQueue);
    state.reviewMode = true;
  } else {
    state.queue = buildQueue(state.quizFilter);
    state.reviewMode = false;
  }
  // 例文モードは例文がある単語のみ
  if (state.quizMode === "example") {
    state.queue = state.queue.filter(w => w.example);
  }
  // セッションサイズで区切る（復習モードは全部出す）
  if (!state.reviewMode && state.sessionSize !== "all") {
    state.queue = state.queue.slice(0, state.sessionSize);
  }
  state.qIndex       = 0;
  state.selected     = null;
  state.showResult   = false;
  state.sessionRight = 0;
  state.sessionWrong = 0;
  state.quizDone     = false;
  state.streak       = 0;
  state.maxStreak    = 0;
  state.wrongIds     = [];
  state.spellAnswer  = "";
  state.spellChecked = false;
  generateChoices();
}

function generateChoices() {
  if (state.queue.length === 0 || state.qIndex >= state.queue.length) return;
  const current = state.queue[state.qIndex];
  const wrong = pickWrong(current, 3);
  state.choices = shuffle([current, ...wrong]);
}

function handleAnswer(choiceId) {
  if (state.selected !== null) return;
  state.selected = choiceId;
  state.showResult = true;

  const current = state.queue[state.qIndex];
  const isCorrect = String(choiceId) === String(current.id);
  if (isCorrect) {
    state.sessionRight++;
    state.streak++;
    state.maxStreak = Math.max(state.maxStreak, state.streak);
  } else {
    state.sessionWrong++;
    state.streak = 0;
    if (!state.wrongIds.includes(String(current.id))) state.wrongIds.push(String(current.id));
  }

  const prev = state.stats[String(current.id)] ?? { correct: 0, wrong: 0 };
  state.stats[String(current.id)] = {
    correct: prev.correct + (isCorrect ? 1 : 0),
    wrong:   prev.wrong   + (isCorrect ? 0 : 1),
  };
  updateSrs(current.id, isCorrect);
  saveData();
  renderQuiz();
}

function nextQuestion() {
  // 二重発火・連打ガード（300ms）
  if (Date.now() - (state.lastNextAt || 0) < 300) return;
  state.lastNextAt = Date.now();
  state.selected     = null;
  state.showResult   = false;
  state.spellAnswer  = "";
  state.spellChecked = false;
  if (state.qIndex + 1 >= state.queue.length) {
    state.quizDone = true;
  } else {
    state.qIndex++;
    generateChoices();
  }
  renderQuiz();
}

function submitSpell() {
  if (state.spellChecked) return;
  state.spellChecked = true;
  state.spellCheckedAt = Date.now();
  const current   = state.queue[state.qIndex];
  const answerWord = state.quizDir === "es-ja" ? current.ja : current.es;
  const isCorrect  = checkSpelling(state.spellAnswer, answerWord);
  if (isCorrect) {
    state.sessionRight++;
    state.streak++;
    state.maxStreak = Math.max(state.maxStreak, state.streak);
  } else {
    state.sessionWrong++;
    state.streak = 0;
    if (!state.wrongIds.includes(String(current.id))) state.wrongIds.push(String(current.id));
  }
  const prev = state.stats[String(current.id)] ?? { correct: 0, wrong: 0 };
  state.stats[String(current.id)] = {
    correct: prev.correct + (isCorrect ? 1 : 0),
    wrong:   prev.wrong   + (isCorrect ? 0 : 1),
  };
  updateSrs(current.id, isCorrect);
  saveData();
  renderQuiz();
}

// ── 単語管理 ──────────────────────────────────────────────────
function saveWord() {
  const es  = state.newEs.trim();
  const ja  = state.newJa.trim();
  const cat = state.newCat;
  if (!es || !ja) return;

  if (state.editId !== null) {
    state.words = state.words.map(w =>
      w.id === state.editId ? { ...w, es, ja, category: cat } : w
    );
    state.editId = null;
  } else {
    state.words.push({ id: String(Date.now()), es, ja, category: cat });
  }
  state.newEs = "";
  state.newJa = "";
  state.newCat = CATEGORIES[0];
  saveData();
  renderWords();
  updateWordCount();
}

function deleteWord(id) {
  state.words = state.words.filter(w => String(w.id) !== String(id));
  delete state.stats[id];
  saveData();
  renderWords();
  updateWordCount();
}

function startEdit(id) {
  const w = state.words.find(w => String(w.id) === String(id));
  if (!w) return;
  state.editId = id;
  state.newEs  = w.es;
  state.newJa  = w.ja;
  state.newCat = w.category;
  renderWordForm();
  // フォームまでスクロール
  setTimeout(() => {
    const formCard = document.querySelector(".form-card");
    if (formCard) formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}

// ── レンダリング ──────────────────────────────────────────────

function updateWordCount() {
  document.getElementById("word-count-num").textContent = state.words.length;
}

/* ── ソース切り替え（マイ単語 / DELE） ── */
function switchSource(src) {
  if (src === state.source) return;
  // 現在の単語を退避
  if (state.source === "my") state._myWords   = state.words;
  else                       state._deleWords = state.words;
  state.source = src;
  state.words = src === "my" ? (state._myWords ?? []) : (state._deleWords ?? []);
  state.quizFilter = "全て";
  state.quizLevel  = "全て";
  saveData();
  updateWordCount();
  updateSourceButtons();

  // スプシのシート名デフォルトを切り替え
  const sheetNameInput = document.getElementById("sheets-sheetname");
  if (sheetNameInput) sheetNameInput.value = src === "my" ? "Sheet1" : "DELE";

  // 現在のタブを再描画
  if (state.tab === "quiz")      { startQuiz(); renderQuiz(); }
  else if (state.tab === "words") renderWords();
  else if (state.tab === "stats") renderStats();
}

function updateSourceButtons() {
  const myBtn   = document.getElementById("source-my");
  const deleBtn = document.getElementById("source-dele");
  if (myBtn)   myBtn.classList.toggle("active", state.source === "my");
  if (deleBtn) deleBtn.classList.toggle("active", state.source === "dele");
}

/* ── タブ切り替え ── */
function switchTab(tab) {
  state.tab = tab;

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === "tab-" + tab);
  });

  if (tab === "quiz") {
    startQuiz();
    renderQuiz();
  } else if (tab === "words") {
    renderWords();
  } else if (tab === "stats") {
    renderStats();
  }
}

/* ── クイズタブ ── */
function renderQuiz() {
  const panel = document.getElementById("tab-quiz");
  const { words, queue, qIndex, quizDone, quizFilter, quizMode, quizDir,
          choices, selected, showResult,
          sessionRight, sessionWrong, spellAnswer, spellChecked } = state;

  // モード・方向切替ボタン
  document.getElementById("quiz-mode-choice").classList.toggle("active", quizMode === "choice");
  document.getElementById("quiz-mode-spell").classList.toggle("active", quizMode === "spell");
  document.getElementById("quiz-mode-example").classList.toggle("active", quizMode === "example");

  // 例文モードは方向の概念がないため方向スイッチを非表示
  const dirSwitch = document.querySelector(".quiz-dir-switch");
  if (dirSwitch) dirSwitch.style.display = quizMode === "example" ? "none" : "flex";

  // セッションサイズボタンのactive状態
  document.querySelectorAll(".size-btn").forEach(btn => {
    btn.classList.toggle("active", String(state.sessionSize) === btn.dataset.size);
  });

  // 設定サマリーの更新
  const summaryEl = document.getElementById("settings-summary");
  if (summaryEl) {
    const dirLabel  = quizDir === "es-ja" ? "🇪🇸→🇯🇵" : "🇯🇵→🇪🇸";
    const modeLabel = { choice: "4択", spell: "スペル", example: "📖例文" }[quizMode];
    const sizeLabel = state.sessionSize === "all" ? "全部" : `${state.sessionSize}問`;
    let filterLabel;
    if (state.source === "dele") {
      filterLabel = state.quizLevel + (quizFilter !== "全て" ? `・${quizFilter}` : "");
    } else {
      filterLabel = quizFilter;
    }
    const parts = quizMode === "example"
      ? [modeLabel, sizeLabel, filterLabel]
      : [dirLabel, modeLabel, sizeLabel, filterLabel];
    summaryEl.textContent = "⚙️ " + parts.join("・");
  }
  document.getElementById("quiz-dir-es-ja").classList.toggle("active", quizDir === "es-ja");
  document.getElementById("quiz-dir-ja-es").classList.toggle("active", quizDir === "ja-es");

  // フィルターUI（ソース別）
  const filterWrap = document.getElementById("quiz-filters");
  if (state.source === "dele") {
    // DELE：レベルボタン＋ジャンルプルダウン
    const levels = ["全て", ...Array.from(new Set(words.map(w => w.category))).sort()];
    const levelPool = state.quizLevel === "全て" ? words : words.filter(w => w.category === state.quizLevel);
    const genres = ["全て", ...Array.from(new Set(levelPool.map(w => w.genre).filter(Boolean)))];

    const levelHtml = levels.map(l => {
      const count = l === "全て" ? words.length : words.filter(w => w.category === l).length;
      return `<button class="cat-btn${l === state.quizLevel ? " active" : ""}" data-level="${l}">${l} <span class="cat-count">${count}</span></button>`;
    }).join("");

    const genreOptions = genres.map(g => {
      const count = g === "全て" ? levelPool.length : levelPool.filter(w => w.genre === g).length;
      return `<option value="${g}"${g === quizFilter ? " selected" : ""}>${g}（${count}語）</option>`;
    }).join("");

    filterWrap.innerHTML = `
      <div class="level-row">${levelHtml}</div>
      <select id="genre-select" class="genre-select">${genreOptions}</select>`;

    filterWrap.querySelectorAll("[data-level]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.quizLevel = btn.dataset.level;
        state.quizFilter = "全て"; // レベル変更時はジャンルをリセット
        startQuiz();
        renderQuiz();
      });
    });
    document.getElementById("genre-select").addEventListener("change", (e) => {
      state.quizFilter = e.target.value;
      startQuiz();
      renderQuiz();
    });
  } else {
    // マイ単語：従来のカテゴリボタン
    const cats = ["全て", ...Array.from(new Set(words.map(w => w.category)))];
    const filterHtml = cats.map(c => {
      const count = c === "全て" ? words.length : words.filter(w => w.category === c).length;
      const due   = countDueWords(c);
      const dueBadge = due > 0 ? `<span class="due-badge">${due}</span>` : "";
      return `<button class="cat-btn${c === quizFilter ? " active" : ""}" data-cat="${c}">${c} <span class="cat-count">${count}</span>${dueBadge}</button>`;
    }).join("");
    filterWrap.innerHTML = filterHtml;
    filterWrap.querySelectorAll(".cat-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.quizFilter = btn.dataset.cat;
        startQuiz();
        renderQuiz();
      });
    });
  }

  const content = document.getElementById("quiz-content");

  // 単語が少ない
  if (words.length < 4) {
    content.innerHTML = `
      <div class="empty-card">
        <div class="icon">📚</div>
        <p>単語帳に4語以上登録するとクイズができます</p>
      </div>`;
    return;
  }

  // クイズ完了
  if (quizDone) {
    const total = sessionRight + sessionWrong;
    const pct   = total === 0 ? 0 : Math.round(sessionRight / total * 100);
    const emoji = pct === 100 ? "🏆" : pct >= 80 ? "🎉" : "💪";
    const wrongCount = state.wrongIds.length;
    const perfectMsg = pct === 100 ? '<p class="done-perfect">全問正解！お見事です 🌟</p>' : "";

    // 間違えた単語オブジェクトを取得
    const reviewWords = state.wrongIds
      .map(id => state.words.find(w => String(w.id) === String(id)))
      .filter(Boolean);

    content.innerHTML = `
      <div class="done-card">
        <div class="done-icon">${emoji}</div>
        <h2>セッション完了！</h2>
        <p class="done-sub">${queue.length}問中${state.reviewMode ? "（復習モード）" : ""}</p>
        ${perfectMsg}
        <div class="done-scores">
          <div class="done-score-box">
            <div class="done-score-num" style="color:#27ae60">${sessionRight}</div>
            <div class="done-score-lbl">正解</div>
          </div>
          <div class="done-score-box">
            <div class="done-score-num" style="color:#C0392B">${sessionWrong}</div>
            <div class="done-score-lbl">不正解</div>
          </div>
          <div class="done-score-box">
            <div class="done-score-num" style="color:#F39C12">${pct}%</div>
            <div class="done-score-lbl">正答率</div>
          </div>
        </div>
        <div class="done-streak">🔥 最高 ${state.maxStreak} 連続正解</div>
        <div class="done-actions">
          ${wrongCount > 0 ? `<button class="review-btn" id="review-btn">間違えた${wrongCount}問を復習</button>` : ""}
          ${state.sessionSize !== "all" && !state.reviewMode ? '<button class="retry-btn" id="next-set-btn">次のセットへ →</button>' : ""}
          <button class="retry-btn secondary" id="retry-btn">もう一度</button>
        </div>
      </div>`;

    document.getElementById("retry-btn").addEventListener("click", () => {
      startQuiz(); renderQuiz();
    });
    const nextSetBtn = document.getElementById("next-set-btn");
    if (nextSetBtn) {
      nextSetBtn.addEventListener("click", () => {
        // SRSにより回答済み単語は自動で後回しになるので、そのまま次セットを開始
        startQuiz(); renderQuiz();
      });
    }
    const reviewBtn = document.getElementById("review-btn");
    if (reviewBtn) {
      reviewBtn.addEventListener("click", () => {
        startQuiz(reviewWords); renderQuiz();
      });
    }
    return;
  }

  // キューが空
  if (queue.length === 0) {
    content.innerHTML = `<p style="color:#7f8c8d;text-align:center;padding:40px 0">このカテゴリに単語がありません</p>`;
    return;
  }

  const current   = queue[qIndex];
  const s         = state.stats[String(current.id)] ?? { correct: 0, wrong: 0 };
  const totalS    = s.correct + s.wrong;
  const wrongRate = totalS > 0 ? s.wrong / totalS : 0;
  const isWeak    = totalS > 0 && wrongRate > 0.4;
  const pct       = Math.round(qIndex / queue.length * 100);

  // ── 例文モード（穴埋め4択） ──
  if (quizMode === "example") {
    if (queue.length === 0) {
      content.innerHTML = `
        <div class="empty-card">
          <div class="icon">📖</div>
          <p>例文つきの単語がありません。<br>スプシタブから最新データを読み込んでください（E列に例文が必要です）</p>
        </div>`;
      return;
    }
    // 例文がない単語はスキップ用の表示
    if (!current.example) {
      // 例文のない単語は次に飛ばす
      if (qIndex + 1 < queue.length) {
        state.qIndex++;
        generateChoices();
        renderQuiz();
      } else {
        state.quizDone = true;
        renderQuiz();
      }
      return;
    }

    // 例文中の単語を空欄にする（大文字小文字・アクセント無視でマッチ）
    const makeBlank = (sentence, word) => {
      const normSentence = sentence.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const normWord     = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const idx = normSentence.indexOf(normWord);
      if (idx === -1) return sentence.replace(word, "＿＿＿");
      return sentence.slice(0, idx) + "＿＿＿" + sentence.slice(idx + word.length);
    };
    const blankSentence = makeBlank(current.example, current.es);

    const choicesHtml = choices.map(c => {
      let cls = "choice-btn";
      if (showResult) {
        if (String(c.id) === String(current.id))  cls += " correct";
        else if (String(c.id) === String(selected)) cls += " wrong";
      }
      return `<button class="${cls}" data-id="${c.id}" ${showResult ? "disabled" : ""}>${c.es}</button>`;
    }).join("");

    const resultHtml = showResult ? (() => {
      const ok = String(selected) === String(current.id);
      return `
        <div class="result-bar ${ok ? "ok" : "ng"}">
          <p class="result-text">
            ${ok
              ? `<span class="ok-text">✓ 正解！ ${current.es}</span>`
              : `<span class="ng-text">✗ 不正解　正解：${current.es}</span>`
            }
          </p>
          <button class="next-btn" id="next-btn">次へ →</button>
        </div>`;
    })() : "";

    content.innerHTML = `
      <div class="progress-wrap">
        <div class="progress-meta">
          <span>問題 ${qIndex + 1} / ${queue.length}</span>
          <span class="score">${state.streak >= 2 ? `<span class="streak-badge">🔥${state.streak}</span> ` : ""}✓ ${sessionRight}　✗ ${sessionWrong}</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>

      <div class="question-card">
        <p class="question-hint">空欄に入る単語は？</p>
        <p class="example-sentence">${showResult ? current.example : blankSentence}</p>
        <p class="example-ja">${current.exampleJa || ""}</p>
        <div class="question-badges">
          <span class="badge badge-cat">${current.category}</span>
          ${isWeak ? '<span class="badge badge-weak">🔥 苦手</span>' : ""}
          <span class="badge badge-srs">Lv.${getSrs(current.id).level}</span>
        </div>
      </div>

      <div class="choices-grid">${choicesHtml}</div>

      ${resultHtml}
    `;

    document.querySelectorAll(".choice-btn").forEach(btn => {
      btn.addEventListener("click", () => handleAnswer(btn.dataset.id));
    });
    const nextBtnEx = document.getElementById("next-btn");
    if (nextBtnEx) nextBtnEx.addEventListener("click", nextQuestion);

    // 回答後に例文全文を読み上げ
    if (showResult) speakSpanish(current.example);

    return;
  }

  // ── スペルモード ──
  if (quizMode === "spell") {
    const questionWord = quizDir === "es-ja" ? current.es : current.ja;
    const answerWord   = quizDir === "es-ja" ? current.ja : current.es;
    const hint         = quizDir === "es-ja" ? "次のスペイン語を日本語でタイプしてください" : "次の日本語をスペイン語でタイプしてください";
    const placeholder  = quizDir === "es-ja" ? "日本語を入力..." : "スペイン語を入力...";
    const isCorrectSpell = spellChecked ? checkSpelling(spellAnswer, answerWord) : false;

    // ── DOMを使い回す方式：キーボードを開いたままにして画面の揺れを防ぐ ──
    let spellUI = document.getElementById("spell-ui");
    if (!spellUI) {
      // 初回のみHTML構築＋イベント登録
      content.innerHTML = `
        <div id="spell-ui">
          <div class="progress-wrap">
            <div class="progress-meta">
              <span id="sp-progress"></span>
              <span class="score" id="sp-score"></span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" id="sp-bar" style="width:0%"></div>
            </div>
          </div>
          <div class="question-card">
            <p class="question-hint" id="sp-hint"></p>
            <p class="question-word" id="sp-word"></p>
            <div class="question-badges" id="sp-badges"></div>
          </div>
          <form id="spell-form" class="spell-input-wrap" action="javascript:void(0)">
            <input id="spell-input" class="spell-input" type="text"
              enterkeyhint="done"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
            <button type="submit" class="spell-check-btn" id="spell-check-btn">確認</button>
          </form>
          <div class="result-bar hidden-placeholder" id="sp-result"></div>
        </div>
      `;

      const inp  = document.getElementById("spell-input");
      const form = document.getElementById("spell-form");

      inp.addEventListener("input", e => { state.spellAnswer = e.target.value; });

      let isComposing = false;
      inp.addEventListener("compositionstart", () => { isComposing = true; });
      inp.addEventListener("compositionend",   () => {
        setTimeout(() => { isComposing = false; }, 100);
      });

      form.addEventListener("submit", e => {
        e.preventDefault();
        if (isComposing) return;
        if (!state.spellChecked) {
          submitSpell();
        } else if (Date.now() - (state.spellCheckedAt || 0) > 400) {
          nextQuestion();
        }
      });
    }

    // ── 部分更新（毎回） ──
    document.getElementById("sp-progress").textContent = `問題 ${qIndex + 1} / ${queue.length}`;
    document.getElementById("sp-score").innerHTML =
      `${state.streak >= 2 ? `<span class="streak-badge">🔥${state.streak}</span> ` : ""}✓ ${sessionRight}　✗ ${sessionWrong}`;
    document.getElementById("sp-bar").style.width = pct + "%";
    document.getElementById("sp-hint").textContent = hint;
    document.getElementById("sp-word").textContent = questionWord;
    document.getElementById("sp-badges").innerHTML = `
      <span class="badge badge-cat">${current.category}</span>
      ${isWeak ? '<span class="badge badge-weak">🔥 苦手</span>' : ""}
      <span class="badge badge-srs">Lv.${getSrs(current.id).level}</span>`;

    const inp      = document.getElementById("spell-input");
    const checkBtn = document.getElementById("spell-check-btn");
    const resultEl = document.getElementById("sp-result");

    if (!spellChecked) {
      // 未回答：readonly解除・入力値同期・キーボード維持のままフォーカス
      inp.readOnly = false;
      inp.placeholder = placeholder;
      if (inp.value !== spellAnswer) inp.value = spellAnswer;
      checkBtn.textContent = "確認";
      resultEl.className = "result-bar hidden-placeholder";
      resultEl.innerHTML = "";
      inp.focus({ preventScroll: true });
      if (quizDir === "es-ja") speakSpanish(current.es);
    } else {
      // 回答済み：readonlyでキーボードを閉じずに判定表示
      inp.readOnly = true;
      checkBtn.textContent = "次へ →";
      resultEl.className = "result-bar " + (isCorrectSpell ? "ok" : "ng");
      resultEl.innerHTML = `
        <p class="result-text">
          ${isCorrectSpell
            ? `<span class="ok-text">✓ 正解！ ${answerWord}</span>`
            : `<span class="ng-text">✗ 不正解　正解：${answerWord}</span>`}
        </p>`;
      inp.focus({ preventScroll: true });
    }
    return;
  }

  // 方向に応じて問題文・選択肢・正解を切り替え
  const questionWord  = quizDir === "es-ja" ? current.es : current.ja;
  const answerLabel   = quizDir === "es-ja" ? (c) => c.ja : (c) => c.es;
  const correctAnswer = quizDir === "es-ja" ? current.ja : current.es;
  const hint          = quizDir === "es-ja" ? "次のスペイン語の意味は？" : "次の日本語をスペイン語で選んでください";

  const choicesHtml = choices.map(c => {
    let cls = "choice-btn";
    if (showResult) {
      if (String(c.id) === String(current.id))  cls += " correct";
      else if (String(c.id) === String(selected)) cls += " wrong";
    }
    return `<button class="${cls}" data-id="${c.id}" ${showResult ? "disabled" : ""}>${answerLabel(c)}</button>`;
  }).join("");

  const resultHtml = showResult ? (() => {
    const ok = String(selected) === String(current.id);
    return `
      <div class="result-bar ${ok ? "ok" : "ng"}">
        <p class="result-text">
          ${ok
            ? `<span class="ok-text">✓ 正解！ ${correctAnswer}</span>`
            : `<span class="ng-text">✗ 不正解　正解：${correctAnswer}</span>`
          }
        </p>
        <button class="next-btn" id="next-btn">次へ →</button>
      </div>`;
  })() : "";

  const speakBtnHtml = quizDir === "es-ja"
    ? '<button class="speak-btn" id="speak-btn" title="もう一度聞く">🔊</button>'
    : "";

  content.innerHTML = `
    <div class="progress-wrap">
      <div class="progress-meta">
        <span>問題 ${qIndex + 1} / ${queue.length}</span>
        <span class="score">${state.streak >= 2 ? `<span class="streak-badge">🔥${state.streak}</span> ` : ""}✓ ${sessionRight}　✗ ${sessionWrong}</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
      </div>
    </div>

    <div class="question-card">
      <p class="question-hint">${hint}</p>
      <p class="question-word">${questionWord}</p>
      <div class="question-badges">
        <span class="badge badge-cat">${current.category}</span>
        ${isWeak ? '<span class="badge badge-weak">🔥 苦手</span>' : ""}
        <span class="badge badge-srs">Lv.${getSrs(current.id).level}</span>
        ${speakBtnHtml}
      </div>
    </div>

    <div class="choices-grid">${choicesHtml}</div>

    ${resultHtml}
  `;

  document.querySelectorAll(".choice-btn").forEach(btn => {
    btn.addEventListener("click", () => handleAnswer(btn.dataset.id));
  });
  const speakBtn = document.getElementById("speak-btn");
  if (speakBtn) speakBtn.addEventListener("click", () => speakSpanish(current.es));
  const nextBtn = document.getElementById("next-btn");
  if (nextBtn) nextBtn.addEventListener("click", nextQuestion);

  // es-jaのときだけ自動読み上げ
  if (!showResult && quizDir === "es-ja") speakSpanish(current.es);

  // 数字キーのヒントを表示
  if (!showResult) {
    const grid = document.querySelector(".choices-grid");
    if (grid) {
      grid.querySelectorAll(".choice-btn").forEach((btn, i) => {
        const label = document.createElement("span");
        label.className = "key-hint";
        label.textContent = i + 1;
        btn.prepend(label);
      });
    }
  }
}

/* ── 単語帳タブ ── */
function renderWordForm() {
  document.getElementById("form-title").textContent =
    state.editId ? "✏️ 単語を編集" : "＋ 単語を追加";
  document.getElementById("input-es").value  = state.newEs;
  document.getElementById("input-ja").value  = state.newJa;
  document.getElementById("input-cat").value = state.newCat;

  const cancelBtn = document.getElementById("cancel-btn");
  cancelBtn.style.display = state.editId ? "block" : "none";
  document.getElementById("save-btn").textContent = state.editId ? "更新" : "追加";
}

function renderWords() {
  renderWordForm();

  // カテゴリ選択肢を最新に
  const catSelect = document.getElementById("input-cat");
  catSelect.innerHTML = CATEGORIES.map(c =>
    `<option value="${c}"${c === state.newCat ? " selected" : ""}>${c}</option>`
  ).join("");

  const list = document.getElementById("word-list");
  if (state.words.length === 0) {
    list.innerHTML = `<div class="empty-card"><div class="icon">📝</div><p>単語を追加してください</p></div>`;
    return;
  }

  list.innerHTML = state.words.map(w => {
    const s         = state.stats[String(w.id)] ?? { correct: 0, wrong: 0 };
    const total     = s.correct + s.wrong;
    const wrongRate = total === 0 ? null : s.wrong / total;
    const isWeak    = wrongRate !== null && wrongRate > 0.4;
    const scoreHtml = total > 0
      ? `${s.correct}正/${s.wrong}誤${isWeak ? ' <span style="color:#e74c3c">🔥苦手</span>' : ""}`
      : "";
    return `
      <div class="word-item${isWeak ? " weak" : ""}">
        <div class="word-item-info">
          <div class="word-pair">
            <span class="word-es">${w.es}</span>
            <span class="word-arrow">→</span>
            <span class="word-ja">${w.ja}</span>
          </div>
          <div class="word-meta">
            <span class="badge badge-cat">${w.category}</span>
            ${total > 0 ? `<span class="word-score">${scoreHtml}</span>` : ""}
          </div>
        </div>
        <button class="edit-btn" data-id="${w.id}">編集</button>
        <button class="del-btn"  data-id="${w.id}">削除</button>
      </div>`;
  }).join("");

  list.querySelectorAll(".edit-btn").forEach(btn =>
    btn.addEventListener("click", () => startEdit(btn.dataset.id))
  );
  list.querySelectorAll(".del-btn").forEach(btn =>
    btn.addEventListener("click", () => deleteWord(btn.dataset.id))
  );
}

/* ── 成績タブ ── */
function renderStats() {
  const totalC = Object.values(state.stats).reduce((a, s) => a + s.correct, 0);
  const totalW = Object.values(state.stats).reduce((a, s) => a + s.wrong,   0);
  const total  = totalC + totalW;
  const pct    = total === 0 ? "–" : Math.round(totalC / total * 100) + "%";

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-correct").textContent = totalC;
  document.getElementById("stat-wrong").textContent   = totalW;
  document.getElementById("stat-pct").textContent     = pct;
  document.getElementById("stat-bar").style.width     = total === 0 ? "0%" : (totalC / total * 100) + "%";

  // カテゴリ別
  const cats = Array.from(new Set(state.words.map(w => w.category)));
  document.getElementById("cat-stat-list").innerHTML = cats.map(cat => {
    const catWords = state.words.filter(w => w.category === cat);
    const catC = catWords.reduce((a, w) => a + (state.stats[String(w.id)]?.correct ?? 0), 0);
    const catW = catWords.reduce((a, w) => a + (state.stats[String(w.id)]?.wrong   ?? 0), 0);
    const catTotal = catC + catW;
    const catPct   = catTotal === 0 ? null : Math.round(catC / catTotal * 100);
    const fillPct  = catTotal === 0 ? 0 : catC / catTotal * 100;
    return `
      <div class="cat-stat-item">
        <div class="cat-stat-row">
          <span>${cat}</span>
          <span class="cat-stat-meta">
            ${catWords.length}語
            ${catPct !== null ? `<span class="cat-stat-pct">${catPct}%</span>` : ""}
          </span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${fillPct}%"></div>
        </div>
      </div>`;
  }).join("");

  // 苦手ランキング
  const weakWords = state.words
    .filter(w => (state.stats[String(w.id)]?.wrong ?? 0) > 0)
    .map(w => {
      const s = state.stats[String(w.id)];
      const t = s.correct + s.wrong;
      return { ...w, wrongRate: s.wrong / t, wrongCount: s.wrong, correctRate: Math.round(s.correct / t * 100) };
    })
    .sort((a, b) => b.wrongRate - a.wrongRate)
    .slice(0, 5);

  const weakEl = document.getElementById("weak-list");
  if (weakWords.length === 0) {
    weakEl.innerHTML = `<p class="no-weak">まだ不正解がありません 🎉</p>`;
  } else {
    weakEl.innerHTML = weakWords.map((w, i) => `
      <div class="weak-item">
        <span class="weak-rank">${i + 1}</span>
        <div class="weak-info">
          <div class="weak-word">${w.es} <span>→ ${w.ja}</span></div>
          <div class="weak-score">不正解 ${w.wrongCount}回（正答率 ${w.correctRate}%）</div>
        </div>
      </div>`).join("");
  }
}

// ── 初期化 ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadData();

  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display     = "flex";
  updateWordCount();

  // タブボタン
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // 単語フォーム
  document.getElementById("input-es").addEventListener("input",   e => { state.newEs  = e.target.value; });
  document.getElementById("input-ja").addEventListener("input",   e => { state.newJa  = e.target.value; });
  document.getElementById("input-cat").addEventListener("change", e => { state.newCat = e.target.value; });
  document.getElementById("save-btn").addEventListener("click", saveWord);
  document.getElementById("cancel-btn").addEventListener("click", () => {
    state.editId = null;
    state.newEs  = "";
    state.newJa  = "";
    state.newCat = CATEGORIES[0];
    renderWordForm();
  });

  // グローバルキーハンドラ（1個だけ）
  document.addEventListener("keydown", globalQuizKeyHandler);

  // ソース切り替えボタン
  document.querySelectorAll(".source-btn").forEach(btn => {
    btn.addEventListener("click", () => switchSource(btn.dataset.source));
  });
  updateSourceButtons();

  // 設定パネルの開閉
  document.getElementById("settings-toggle").addEventListener("click", () => {
    const panel = document.getElementById("quiz-settings");
    const arrow = document.getElementById("settings-arrow");
    const isCollapsed = panel.classList.toggle("collapsed");
    arrow.textContent = isCollapsed ? "▼" : "▲";
  });

  // セッションサイズボタン
  document.querySelectorAll(".size-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.sessionSize = btn.dataset.size === "all" ? "all" : Number(btn.dataset.size);
      saveData();
      startQuiz();
      renderQuiz();
    });
  });

  // クイズ方向切替ボタン
  document.querySelectorAll(".dir-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.quizDir = btn.dataset.dir;
      startQuiz();
      renderQuiz();
    });
  });

  // クイズモード切替ボタン
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.quizMode = btn.dataset.mode;
      startQuiz();
      renderQuiz();
    });
  });

  // スプシ読み込みボタン
  document.getElementById("sheets-import-btn").addEventListener("click", importFromSheetsCsv);

  switchTab("quiz");
});

// ── Google Sheets CSV読み込み（APIキー不要版）────────────────

const SHEET_ID = "1M9Qfifg-e7M_5j7VfxwUMTDYikn8PsKob6mXSKo-dUg";

async function importFromSheetsCsv() {
  const sheetName = document.getElementById("sheets-sheetname").value.trim() || "Sheet1";
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

  setSheetStatus("loading", "読み込み中...");

  try {
    const res = await fetch(csvUrl);
    if (!res.ok) {
      setSheetStatus("error", `取得失敗 (${res.status})。スプシを「ウェブに公開」してください`);
      return;
    }
    const text = await res.text();
    const rows = parseCSV(text);
    const dataRows = rows.slice(1).filter(r => r[0] && r[1]);

    if (dataRows.length === 0) {
      setSheetStatus("error", "データが見つかりませんでした。A列・B列にデータがあるか確認してください");
      return;
    }

    const imported = dataRows.map(row => ({
      id: String(Date.now()) + String(Math.random()).slice(2),
      es:       row[0].trim(),
      ja:       row[1].trim(),
      category: (row[2] ?? "その他").trim() || "その他",
      pos:      (row[3] ?? "").trim(),
      example:  (row[4] ?? "").trim(),
      exampleJa: (row[5] ?? "").trim(),
      genre:    (row[6] ?? "").trim(),
    }));

    const mode = document.querySelector('input[name="import-mode"]:checked').value;
    if (mode === "replace") {
      state.words = imported;
      state.stats = {};
    } else {
      const existing = new Set(state.words.map(w => w.es));
      state.words = [...state.words, ...imported.filter(w => !existing.has(w.es))];
    }

    saveData();
    updateWordCount();
    setSheetStatus("success", `✓ ${imported.length}語を読み込みました！`);
    setTimeout(() => switchTab("quiz"), 1200);

  } catch (e) {
    setSheetStatus("error", "ネットワークエラー。インターネット接続とスプシの公開設定を確認してください");
  }
}

function setSheetStatus(type, msg) {
  const el = document.getElementById("sheets-status");
  el.textContent   = msg;
  el.className     = "sheets-status " + type;
  el.style.display = "block";
}

function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cols.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}
