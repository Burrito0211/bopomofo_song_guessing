(function () {
'use strict';
const loadQuestions = () => window.GameData.loadQuestions();

/* ─────────────── 設定 ─────────────── */

const LIVES = 3;
const SKIPS = 3;
const HINT_COST = 50;
const MIN_AWARD = 10;
const MAX_MULTIPLIER = 3;

// reveal＝開場就直接送出去的中文字比例（其餘才是要猜的注音聲母）
const LEVELS = {
  chill: { seconds: 60, reveal: 0.45, label: '悠閒' },
  normal: { seconds: 30, reveal: 0.30, label: '正常' },
  hard: { seconds: 15, reveal: 0.12, label: '刺激' },
};

// 年代分組。依歌曲年份把題庫切開，玩家可以只挑某個世代來玩。
const ERAS = [
  { id: 'classic', label: '90年代以前', match: (y) => y != null && y <= 1999 },
  { id: 'y2000s', label: '2000年代', match: (y) => y >= 2000 && y <= 2009 },
  { id: 'y2010s', label: '2010年代', match: (y) => y >= 2010 && y <= 2019 },
  { id: 'y2020s', label: '2020年代', match: (y) => y >= 2020 },
];

/** 目前勾起來的年代；一個都沒勾就回空陣列（開始遊戲時會擋下來） */
function checkedEras() {
  const ids = [...document.querySelectorAll('input[name="era"]:checked')].map((el) => el.value);
  return ERAS.filter((e) => ids.includes(e.id));
}

/** 依目前的題型與年代篩題目 */
function filterBank(all, mode, eras) {
  return all.filter(
    (q) => (mode === 'mixed' || q.mode === mode) && eras.some((e) => e.match(q.year))
  );
}

// 這些字給出來只是幫忙讀順，不太會直接洩漏答案，優先送
const GLUE = new Set([...'的了是不在有就都和也很到我你他她們一個這那要會來去上下中又再為之以把被給對從而但還沒過只才更最每些麼呢吧啊嗎與或且因所卻讓使將']);

const STORE_KEY = 'bpmf-lyrics:v1';

/* ─────────────── 小工具 ─────────────── */

const $ = (sel) => document.querySelector(sel);

/** 比對答案前先洗掉標點、空白、全形、大小寫的差異 */
function normalize(str) {
  return String(str)
    .normalize('NFKC')          // 全形英數 → 半形
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .trim();
}

/** 編輯距離，用來容忍一個錯字 */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * 判斷答案。回傳 'exact' | 'close' | 'wrong'。
 * 'close' 是差一個字，照樣算對，但會提醒正確寫法。
 */
function judge(input, acceptList) {
  const guess = normalize(input);
  if (!guess) return 'wrong';
  let best = 'wrong';
  for (const candidate of acceptList) {
    const target = normalize(candidate);
    if (!target) continue;
    if (guess === target) return 'exact';
    if (target.length >= 6 && editDistance(guess, target) <= 1) best = 'close';
  }
  return best;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 洗牌後再推開同一首歌的題目，避免上一題剛好爆雷下一題 */
function spreadBySong(list) {
  const out = shuffle(list);
  for (let i = 1; i < out.length; i++) {
    if (out[i].songId !== out[i - 1].songId) continue;
    const j = out.findIndex(
      (q, k) => k > i && q.songId !== out[i - 1].songId &&
                (k + 1 >= out.length || out[k + 1].songId !== out[i].songId)
    );
    if (j > -1) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const hanChars = (s) => [...s].filter((c) => /\p{Script=Han}/u.test(c));

/**
 * 開場就直接送給玩家的字（顯示原字而不是聲母）。
 * 猜歌名時一定先給開頭兩個字，讀起來像半句話比較好聯想；
 * 其餘名額優先給虛字，最後一定留至少兩個字要猜。
 */
function pickFreebies(q, ratio) {
  const chars = hanChars(q.line);
  const n = chars.length;
  if (n <= 2) return new Set();

  const maxReveal = n - 2;
  const picked = new Set();

  if (q.mode === 'title') {
    for (let i = 0; i < Math.min(2, maxReveal); i++) picked.add(i);
  }

  const quota = Math.min(maxReveal, Math.max(picked.size, 1, Math.round(n * ratio)));
  const rest = chars.map((_, i) => i).filter((i) => !picked.has(i));
  const glue = shuffle(rest.filter((i) => GLUE.has(chars[i])));
  const other = shuffle(rest.filter((i) => !GLUE.has(chars[i])));

  for (const i of [...glue, ...other]) {
    if (picked.size >= quota) break;
    picked.add(i);
  }
  return picked;
}

function loadBest() {
  try {
    return { score: 0, combo: 0, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return { score: 0, combo: 0 };
  }
}

function saveBest(best) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(best)); } catch { /* 無痕模式就算了 */ }
}

/* ─────────────── 遊戲狀態 ─────────────── */

const state = {
  bank: [],
  queue: [],
  cursor: 0,
  current: null,
  score: 0,
  streak: 0,
  bestStreak: 0,
  lives: LIVES,
  skipsLeft: SKIPS,
  asked: 0,
  correct: 0,
  missed: [],
  hintsUsed: 0,
  hints: [],
  revealed: new Set(),
  given: new Set(),
  secondsTotal: LEVELS.normal.seconds,
  revealRatio: LEVELS.normal.reveal,
  msLeft: 0,
  ticker: null,
  awaitingNext: false,
  composing: false,
};

const multiplier = () => Math.min(1 + state.streak * 0.15, MAX_MULTIPLIER);

/* ─────────────── 畫面切換 ─────────────── */

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) {
    el.classList.toggle('is-active', el.id === id);
  }
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth; // 強制重排，讓動畫可以重播
  el.classList.add('bump');
}

/* ─────────────── 渲染 ─────────────── */

/** 已揭露的字直接顯示原字，其餘維持聲母 */
function renderQuestionTiles() {
  const q = state.current;
  const container = $('#q-tiles');
  container.innerHTML = '';

  const lineHan = hanChars(q.line);
  let hanIndex = -1;

  q.tiles.forEach((tile, i) => {
    const el = document.createElement('span');
    el.className = 'tile pop';
    el.style.animationDelay = `${Math.min(i * 28, 600)}ms`;

    if (tile.k === 'han') {
      hanIndex++;
      if (state.revealed.has(hanIndex)) {
        el.classList.add('is-revealed');
        el.textContent = lineHan[hanIndex];
      } else if (state.given.has(hanIndex)) {
        el.classList.add('is-given');
        el.textContent = lineHan[hanIndex];
      } else {
        el.textContent = tile.t;
      }
    } else if (tile.k === 'space') {
      el.classList.add('is-space');
    } else if (tile.k === 'latin') {
      el.classList.add('is-latin');
      el.textContent = tile.t;
    } else {
      el.classList.add('is-punct');
      el.textContent = tile.t ?? '';
    }
    container.appendChild(el);
  });
}

function renderHud() {
  $('#hud-score').textContent = state.score;
  $('#hud-combo').textContent = `×${multiplier().toFixed(1)}`;
  $('#hud-lives').textContent = '❤️'.repeat(state.lives) + '🖤'.repeat(LIVES - state.lives);
  $('#hud-index').textContent = state.asked + 1;
  $('#skip-left').textContent = state.skipsLeft;
  $('#btn-skip').disabled = state.skipsLeft <= 0;
  $('#btn-hint').disabled = state.hintsUsed >= state.hints.length;
}

/* ─────────────── 計時器 ─────────────── */

function startTimer() {
  stopTimer();
  state.msLeft = state.secondsTotal * 1000;
  const fill = $('#timer-fill');
  fill.classList.remove('is-low');
  fill.style.transform = 'scaleX(1)';

  const startedAt = performance.now();
  state.ticker = setInterval(() => {
    state.msLeft = Math.max(0, state.secondsTotal * 1000 - (performance.now() - startedAt));
    const ratio = state.msLeft / (state.secondsTotal * 1000);
    fill.style.transform = `scaleX(${ratio})`;
    fill.classList.toggle('is-low', ratio <= 0.25);
    if (state.msLeft <= 0) {
      stopTimer();
      resolveQuestion('timeout');
    }
  }, 100);
}

function stopTimer() {
  if (state.ticker) clearInterval(state.ticker);
  state.ticker = null;
}

/* ─────────────── 出題 ─────────────── */

function buildHints(q) {
  const hints = [];
  if (q.mode === 'title') {
    hints.push(`演唱者：${q.artist}${q.year ? `（${q.year}）` : ''}`);
    hints.push(`歌名共 ${hanChars(q.answer).length} 個字，第一個字是「${hanChars(q.answer)[0]}」`);
    const chars = hanChars(q.answer);
    if (chars.length > 2) hints.push(`最後一個字是「${chars[chars.length - 1]}」`);
  } else {
    hints.push(`演唱者：${q.artist}${q.year ? `（${q.year}）` : ''}`);
    hints.push('__reveal__');
    hints.push('__reveal__');
  }
  return hints;
}

function nextQuestion() {
  if (state.cursor >= state.queue.length) {
    state.queue = spreadBySong(state.bank); // 題庫跑完就重洗
    state.cursor = 0;
  }

  state.current = state.queue[state.cursor++];
  state.hintsUsed = 0;
  state.hints = buildHints(state.current);
  state.revealed = new Set();
  state.given = pickFreebies(state.current, state.revealRatio);
  state.awaitingNext = false;

  const q = state.current;
  renderPrompt(q);

  $('#q-meta').textContent =
    q.mode === 'title'
      ? `答案是歌名，共 ${hanChars(q.answer).length} 個字`
      : `這句共 ${hanChars(q.answer).length} 個字`;

  const hintBox = $('#hint-box');
  hintBox.hidden = true;
  hintBox.textContent = '';

  renderQuestionTiles();
  renderHud();

  const input = $('#answer-input');
  input.value = '';
  input.disabled = false;
  input.focus();

  startTimer();
}

/**
 * 這首歌的 YouTube 連結。來源檔有填 youtube（影片 id）就直接連過去，
 * 沒填就退成「歌手＋歌名」的搜尋結果——192 首歌沒辦法一一去查影片 id，
 * 但搜尋幾乎都會把正確的那支排在第一個。
 */
function youtubeUrl(q) {
  if (q.youtube) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(q.youtube)}`;
  }
  const query = `${q.artist} ${q.title}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/**
 * 題目那行字。猜歌詞時歌名本來就給你了，做成連結不會洩漏答案，
 * 想不起旋律可以直接點去聽。一定要開新分頁，不然一點就把這局玩掉了。
 */
function renderPrompt(q) {
  const el = $('#q-prompt');
  el.innerHTML = '';

  if (q.mode === 'title') {
    el.textContent = '這句歌詞出自哪首歌？';
    return;
  }

  const link = document.createElement('a');
  link.className = 'song-name';
  link.href = youtubeUrl(q);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = `在 YouTube 上聽《${q.title}》（開新分頁）`;
  link.textContent = `《${q.title}》`;
  el.appendChild(link);

  const tail = document.createElement('span');
  tail.textContent = '的這句歌詞是什麼？';
  el.appendChild(tail);
}

/* ─────────────── 提示 / 跳過 ─────────────── */

function useHint() {
  if (state.hintsUsed >= state.hints.length) return;
  const hint = state.hints[state.hintsUsed];
  state.hintsUsed++;

  const box = $('#hint-box');
  if (hint === '__reveal__') {
    const chars = hanChars(state.current.line);
    const candidates = chars
      .map((_, i) => i)
      .filter((i) => !state.revealed.has(i) && !state.given.has(i));
    if (candidates.length) {
      state.revealed.add(candidates[Math.floor(Math.random() * candidates.length)]);
      renderQuestionTiles();
    }
    box.textContent = `已幫你揭開 ${state.revealed.size} 個字（紫色磚塊）`;
  } else {
    const shown = state.hints
      .slice(0, state.hintsUsed)
      .filter((h) => h !== '__reveal__');
    box.textContent = shown.join('　·　');
  }
  box.hidden = false;
  renderHud();
  $('#answer-input').focus();
}

function skipQuestion() {
  if (state.skipsLeft <= 0) return;
  state.skipsLeft--;
  resolveQuestion('skip');
}

/* ─────────────── 判定結果 ─────────────── */

function resolveQuestion(outcome, matchKind) {
  stopTimer();
  const q = state.current;
  state.asked++;
  $('#answer-input').disabled = true;

  let gained = 0;
  let verdict = '';
  let verdictClass = 'bad';
  let note = '';

  if (outcome === 'correct') {
    state.correct++;
    const base = 60 + q.difficulty * 40;
    const timeBonus = Math.round((state.msLeft / 1000) * 4);
    const raw = Math.max(MIN_AWARD, base + timeBonus - state.hintsUsed * HINT_COST);
    gained = Math.round(raw * multiplier());

    state.score += gained;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);

    verdict = state.streak >= 5 ? `🔥 連對 ${state.streak} 題！` : '✅ 答對了';
    verdictClass = 'good';
    note = `+${gained} 分　（基本 ${base} ＋ 時間 ${timeBonus}` +
      (state.hintsUsed ? ` − 提示 ${state.hintsUsed * HINT_COST}` : '') +
      `）× ${multiplier().toFixed(1)}`;
    if (matchKind === 'close') note = `差一個字，算你對！　${note}`;
  } else {
    state.streak = 0;
    state.missed.push(q);
    if (outcome === 'skip') {
      verdict = '⏭ 跳過';
    } else {
      state.lives--;
      verdict = outcome === 'timeout' ? '⏰ 時間到' : '❌ 答錯了';
    }
    note = outcome === 'skip' ? '連擊歸零' : `失去一顆愛心，還剩 ${state.lives} 顆`;
  }

  const fb = $('#feedback');
  const verdictEl = $('#fb-verdict');
  verdictEl.textContent = verdict;
  verdictEl.className = `fb-verdict ${verdictClass}`;

  const year = q.year ? `（${q.year}）` : '';
  $('#fb-answer').textContent = q.mode === 'title' ? `《${q.answer}》` : q.answer;
  $('#fb-song').textContent =
    q.mode === 'title'
      ? `${q.artist}${year}　·　${q.line}`
      : `${q.artist}《${q.title}》${year}`;
  $('#fb-points').textContent = note;

  renderHud();
  bump($('#hud-score'));

  fb.hidden = false;
  $('#btn-next').textContent = state.lives > 0 ? '下一題' : '看結果';
  $('#btn-next').focus();
  state.awaitingNext = true;
}

function proceed() {
  if (!state.awaitingNext) return;
  state.awaitingNext = false;
  $('#feedback').hidden = true;
  if (state.lives <= 0) gameOver();
  else nextQuestion();
}

/* ─────────────── 開始 / 結束 ─────────────── */

function startGame() {
  if (!state.allQuestions) return; // 題庫還沒載好
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const level = document.querySelector('input[name="level"]:checked').value;
  const eras = checkedEras();

  if (!eras.length) {
    alert('至少要選一個年代');
    return;
  }

  state.bank = filterBank(state.allQuestions, mode, eras);

  if (!state.bank.length) {
    alert('這個題型加上這些年代目前沒有題目，換一個試試');
    return;
  }

  Object.assign(state, {
    queue: spreadBySong(state.bank),
    cursor: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    lives: LIVES,
    skipsLeft: SKIPS,
    asked: 0,
    correct: 0,
    missed: [],
    secondsTotal: LEVELS[level].seconds,
    revealRatio: LEVELS[level].reveal,
  });

  $('#feedback').hidden = true;
  showScreen('screen-game');
  nextQuestion();
}

function gameOver() {
  stopTimer();
  showScreen('screen-over');

  const best = loadBest();
  const newRecord = state.score > best.score;
  best.score = Math.max(best.score, state.score);
  best.combo = Math.max(best.combo, state.bestStreak);
  saveBest(best);

  $('#over-badge').textContent = newRecord ? '🏆 新紀錄！' : '遊戲結束';
  $('#over-score').textContent = state.score;
  $('#over-sub').textContent = newRecord
    ? '刷新了你自己的最高分'
    : `最高紀錄 ${best.score} 分`;

  const rate = state.asked ? Math.round((state.correct / state.asked) * 100) : 0;
  $('#over-correct').textContent = state.correct;
  $('#over-total').textContent = state.asked;
  $('#over-rate').textContent = `${rate}%`;
  $('#over-combo').textContent = state.bestStreak;

  const missedBox = $('#over-missed');
  const list = $('#over-missed-list');
  list.innerHTML = '';
  const seen = new Set();
  for (const q of state.missed) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    const li = document.createElement('li');
    li.innerHTML =
      `<strong>${q.line}</strong><span>${q.artist}《${q.title}》${q.year ? `（${q.year}）` : ''}</span>`;
    list.appendChild(li);
  }
  missedBox.hidden = state.missed.length === 0;

  refreshBestDisplay();
}

/** 把各年代的歌曲數量寫進按鈕，順便把空的年代停用 */
function renderEraCounts() {
  for (const era of ERAS) {
    const chip = document.querySelector(`.chip[data-era="${era.id}"]`);
    if (!chip) continue;
    const songs = new Set(
      state.allQuestions.filter((q) => era.match(q.year)).map((q) => q.songId)
    );
    chip.querySelector('.chip-count').textContent = `${songs.size}首`;
    chip.querySelector('input').disabled = songs.size === 0;
  }
}

/** 「題庫」那格顯示目前選到的範圍，不是全部 */
function updateBankSummary() {
  const el = $('#bank-size');
  if (!state.allQuestions) return;

  const eras = checkedEras();
  if (!eras.length) {
    el.textContent = '未選年代';
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked').value;
  const picked = filterBank(state.allQuestions, mode, eras);
  const songs = new Set(picked.map((q) => q.songId)).size;
  el.textContent = `${songs} 首 · ${picked.length} 題`;
}

function refreshBestDisplay() {
  const best = loadBest();
  $('#best-score').textContent = best.score;
  $('#best-combo').textContent = best.combo;
}

/* ─────────────── 事件綁定 ─────────────── */

function bindEvents() {
  $('#btn-start').addEventListener('click', startGame);
  $('#btn-again').addEventListener('click', startGame);
  $('#btn-home').addEventListener('click', () => showScreen('screen-start'));
  $('#btn-hint').addEventListener('click', useHint);
  $('#btn-skip').addEventListener('click', skipQuestion);
  $('#btn-next').addEventListener('click', proceed);

  for (const el of document.querySelectorAll('input[name="era"], input[name="mode"]')) {
    el.addEventListener('change', updateBankSummary);
  }

  $('#btn-quit').addEventListener('click', () => {
    stopTimer();
    $('#feedback').hidden = true;
    gameOver();
  });

  const input = $('#answer-input');
  // 中文輸入法選字時按 Enter 不能算送出
  input.addEventListener('compositionstart', () => { state.composing = true; });
  input.addEventListener('compositionend', () => { state.composing = false; });

  $('#answer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.composing || state.awaitingNext) return;

    const value = input.value.trim();
    if (!value) return;

    const result = judge(value, state.current.accept);
    if (result === 'wrong') {
      input.classList.remove('shake');
      void input.offsetWidth;
      input.classList.add('shake');
      resolveQuestion('wrong');
    } else {
      resolveQuestion('correct', result);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (state.awaitingNext && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      proceed();
    }
  });

  // 深色模式
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('bpmf-theme', next); } catch { /* ignore */ }
  });
}

/* ─────────────── 啟動 ─────────────── */

async function main() {
  bindEvents();
  refreshBestDisplay();

  const startBtn = $('#btn-start');
  startBtn.disabled = true;
  startBtn.textContent = '載入題庫中…';

  try {
    const { questions } = await loadQuestions();
    state.allQuestions = questions;
    renderEraCounts();
    updateBankSummary();
    $('#footer-count').textContent = questions.length;
    startBtn.disabled = false;
    startBtn.textContent = '開始遊戲';
  } catch (err) {
    console.error(err);
    $('#bank-size').textContent = '載入失敗';
    $('#btn-start').disabled = true;
    $('#btn-start').textContent = '題庫載入失敗';
  }
}

main();

})();
