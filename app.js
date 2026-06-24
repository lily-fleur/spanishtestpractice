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
  quizMode: "choice",  // choice | spell
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
    }
  } catch (_) {}
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      words: state.words,
      stats: state.stats,
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
function buildQueue(filterCat) {
  let pool = filterCat === "全て"
    ? state.words
    : state.words.filter(w => w.category === filterCat);
  if (pool.length === 0) return [];

  const scored = pool.map(w => ({ ...w, wrongRate: getWrongRate(w.id) }));
  scored.sort((a, b) => b.wrongRate - a.wrongRate);
  const repeated = scored.flatMap((w, i) =>
    (i < 3 && w.wrongRate > 0.4) ? [w, w] : [w]
  );
  return shuffle(repeated);
}

function startQuiz() {
  state.queue        = buildQueue(state.quizFilter);
  state.qIndex       = 0;
  state.selected     = null;
  state.showResult   = false;
  state.sessionRight = 0;
  state.sessionWrong = 0;
  state.quizDone     = false;
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
  if (isCorrect) state.sessionRight++;
  else           state.sessionWrong++;

  const prev = state.stats[String(current.id)] ?? { correct: 0, wrong: 0 };
  state.stats[String(current.id)] = {
    correct: prev.correct + (isCorrect ? 1 : 0),
    wrong:   prev.wrong   + (isCorrect ? 0 : 1),
  };
  saveData();
  renderQuiz();
}

function nextQuestion() {
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
  const current   = state.queue[state.qIndex];
  const answerWord = state.quizDir === "es-ja" ? current.ja : current.es;
  const isCorrect  = checkSpelling(state.spellAnswer, answerWord);
  if (isCorrect) state.sessionRight++;
  else           state.sessionWrong++;
  const prev = state.stats[String(current.id)] ?? { correct: 0, wrong: 0 };
  state.stats[String(current.id)] = {
    correct: prev.correct + (isCorrect ? 1 : 0),
    wrong:   prev.wrong   + (isCorrect ? 0 : 1),
  };
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
}

// ── レンダリング ──────────────────────────────────────────────

function updateWordCount() {
  document.getElementById("word-count-num").textContent = state.words.length;
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
  document.getElementById("quiz-dir-es-ja").classList.toggle("active", quizDir === "es-ja");
  document.getElementById("quiz-dir-ja-es").classList.toggle("active", quizDir === "ja-es");

  // カテゴリフィルター
  const cats = ["全て", ...Array.from(new Set(words.map(w => w.category)))];
  const filterHtml = cats.map(c => `
    <button class="cat-btn${c === quizFilter ? " active" : ""}" data-cat="${c}">${c}</button>
  `).join("");
  document.getElementById("quiz-filters").innerHTML = filterHtml;
  document.querySelectorAll(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.quizFilter = btn.dataset.cat;
      startQuiz();
      renderQuiz();
    });
  });

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
    const emoji = pct >= 80 ? "🎉" : "💪";
    content.innerHTML = `
      <div class="done-card">
        <div class="done-icon">${emoji}</div>
        <h2>セッション完了！</h2>
        <p class="done-sub">${queue.length}問中</p>
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
        <button class="retry-btn" id="retry-btn">もう一度</button>
      </div>`;
    document.getElementById("retry-btn").addEventListener("click", () => {
      startQuiz(); renderQuiz();
    });
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

  // ── スペルモード ──
  if (quizMode === "spell") {
    const questionWord = quizDir === "es-ja" ? current.es : current.ja;
    const answerWord   = quizDir === "es-ja" ? current.ja : current.es;
    const hint         = quizDir === "es-ja" ? "次のスペイン語を日本語でタイプしてください" : "次の日本語をスペイン語でタイプしてください";
    const placeholder  = quizDir === "es-ja" ? "日本語を入力..." : "スペイン語を入力...";

    // 未回答フェーズ
    if (!spellChecked) {
      content.innerHTML = `
        <div class="progress-wrap">
          <div class="progress-meta">
            <span>問題 ${qIndex + 1} / ${queue.length}</span>
            <span class="score">✓ ${sessionRight}　✗ ${sessionWrong}</span>
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
          </div>
        </div>
        <div class="spell-input-wrap">
          <input id="spell-input" class="spell-input" type="text"
            placeholder="${placeholder}"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
          <button class="spell-check-btn" id="spell-check-btn">確認</button>
        </div>
      `;
      const inp = document.getElementById("spell-input");
      inp.focus();
      inp.addEventListener("input", e => { state.spellAnswer = e.target.value; });
      let isComposing = false;
      inp.addEventListener("compositionstart", () => { isComposing = true; });
      inp.addEventListener("compositionend",   () => { isComposing = false; });
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter" && !isComposing) {
          e.preventDefault();
          submitSpell();
        }
      });
      document.getElementById("spell-check-btn").addEventListener("click", submitSpell);

    // 回答済みフェーズ（Enter1回待ってから次へ）
    } else {
      const isCorrectSpell = checkSpelling(spellAnswer, answerWord);
      content.innerHTML = `
        <div class="progress-wrap">
          <div class="progress-meta">
            <span>問題 ${qIndex + 1} / ${queue.length}</span>
            <span class="score">✓ ${sessionRight}　✗ ${sessionWrong}</span>
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
          </div>
        </div>
        <div class="spell-input-wrap">
          <input class="spell-input" type="text" value="${spellAnswer}" disabled
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="result-bar ${isCorrectSpell ? "ok" : "ng"}">
          <p class="result-text">
            ${isCorrectSpell
              ? `<span class="ok-text">✓ 正解！ ${answerWord}</span>`
              : `<span class="ng-text">✗ 不正解　正解：${answerWord}</span>`}
          </p>
          <button class="next-btn" id="next-btn">次へ →</button>
        </div>
      `;
      document.getElementById("next-btn").addEventListener("click", nextQuestion);
      // setTimeoutで登録を遅らせることで確認EnterがそのままここにこないようにEする
      setTimeout(() => {
        document.addEventListener("keydown", function onEnter(e) {
          if (e.key === "Enter") {
            document.removeEventListener("keydown", onEnter);
            nextQuestion();
          }
        });
      }, 100);
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
        <span class="score">✓ ${sessionRight}　✗ ${sessionWrong}</span>
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

  // 1〜4キーで選択肢を選ぶ＋Enterで次へ
  const onKeyQuiz = (e) => {
    if (state.quizMode !== "choice") return;
    if (e.key === "Enter" && state.showResult) {
      document.removeEventListener("keydown", onKeyQuiz);
      nextQuestion();
      return;
    }
    const idx = parseInt(e.key) - 1;
    if (!state.showResult && idx >= 0 && idx < state.choices.length) {
      document.removeEventListener("keydown", onKeyQuiz);
      handleAnswer(state.choices[idx].id);
    }
  };
  document.addEventListener("keydown", onKeyQuiz);

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
  document.getElementById("app").style.display     = "block";
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
