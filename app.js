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
  return normalizeText(input) === normalizeText(correct);
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
  const current  = state.queue[state.qIndex];
  const isCorrect = checkSpelling(state.spellAnswer, current.es);
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
  const { words, queue, qIndex, quizDone, quizFilter, quizMode,
          choices, selected, showResult,
          sessionRight, sessionWrong, spellAnswer, spellChecked } = state;

  // モード切替
  document.getElementById("quiz-mode-choice").classList.toggle("active", quizMode === "choice");
  document.getElementById("quiz-mode-spell").classList.toggle("active", quizMode === "spell");

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
    const isCorrectSpell = spellChecked && checkSpelling(spellAnswer, current.es);
    const spellResult = spellChecked
      ? (isCorrectSpell
        ? `<div class="result-bar ok"><p class="result-text"><span class="ok-text">✓ 正解！ ${current.es}</span></p><button class="next-btn" id="next-btn">次へ →</button></div>`
        : `<div class="result-bar ng"><p class="result-text"><span class="ng-text">✗ 不正解　正解：${current.es}</span></p><button class="next-btn" id="next-btn">次へ →</button></div>`)
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
        <p class="question-hint">次の日本語をスペイン語でタイプしてください</p>
        <p class="question-word">${current.ja}</p>
        <div class="question-badges">
          <span class="badge badge-cat">${current.category}</span>
          ${isWeak ? '<span class="badge badge-weak">🔥 苦手</span>' : ""}
        </div>
      </div>
      <div class="spell-input-wrap">
        <input id="spell-input" class="spell-input" type="text"
          placeholder="スペイン語を入力..."
          value="${spellAnswer}"
          ${spellChecked ? "disabled" : ""}
          autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
        ${!spellChecked ? '<button class="spell-check-btn" id="spell-check-btn">確認</button>' : ""}
      </div>
      ${spellResult}
    `;

    if (!spellChecked) {
      const inp = document.getElementById("spell-input");
      inp.focus();
      inp.addEventListener("input", e => { state.spellAnswer = e.target.value; });
      inp.addEventListener("keydown", e => { if (e.key === "Enter") submitSpell(); });
      document.getElementById("spell-check-btn").addEventListener("click", submitSpell);
    }
    const nextBtn = document.getElementById("next-btn");
    if (nextBtn) nextBtn.addEventListener("click", nextQuestion);
    return;
  }

  const choicesHtml = choices.map(c => {
    let cls = "choice-btn";
    if (showResult) {
      if (String(c.id) === String(current.id))  cls += " correct";
      else if (String(c.id) === String(selected)) cls += " wrong";
    }
    return `<button class="${cls}" data-id="${c.id}" ${showResult ? "disabled" : ""}>${c.ja}</button>`;
  }).join("");

  const resultHtml = showResult ? (() => {
    const ok = String(selected) === String(current.id);
    return `
      <div class="result-bar ${ok ? "ok" : "ng"}">
        <p class="result-text">
          ${ok
            ? `<span class="ok-text">✓ 正解！ ${current.ja}</span>`
            : `<span class="ng-text">✗ 不正解　正解：${current.ja}</span>`
          }
        </p>
        <button class="next-btn" id="next-btn">次へ →</button>
      </div>`;
  })() : "";

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
      <p class="question-hint">次のスペイン語の意味は？</p>
      <p class="question-word">${current.es}</p>
      <div class="question-badges">
        <span class="badge badge-cat">${current.category}</span>
        ${isWeak ? '<span class="badge badge-weak">🔥 苦手</span>' : ""}
      </div>
    </div>

    <div class="choices-grid">${choicesHtml}</div>

    ${resultHtml}
  `;

  document.querySelectorAll(".choice-btn").forEach(btn => {
    btn.addEventListener("click", () => handleAnswer(btn.dataset.id));
  });
  const nextBtn = document.getElementById("next-btn");
  if (nextBtn) nextBtn.addEventListener("click", nextQuestion);
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
