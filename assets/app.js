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

// 日文的助詞與常見綴詞，跟中文的虛詞一樣：送出來幫忙讀順，不太會洩漏答案
const GLUE_JA = new Set([
  'の', 'に', 'を', 'は', 'が', 'と', 'で', 'も', 'か', 'ね', 'よ', 'な', 'や',
  'から', 'まで', 'ように', 'よう', 'って', 'だ', 'です', 'ます', 'でも',
  'そして', 'けど', 'のに', 'こと', 'して', 'いる', 'ない',
]);

const isGlue = (unit) => GLUE.has(unit) || GLUE_JA.has(unit);

const STORE_KEY = 'bpmf-lyrics:v1';
const LANG_KEY = 'bpmf-lyrics:lang';

const currentLang = () => {
  const el = document.querySelector('input[name="lang"]:checked');
  return el ? el.value : 'zh';
};

/* ─────────────── 小工具 ─────────────── */

const $ = (sel) => document.querySelector(sel);

// 答案判定跟伺服器端共用同一份實作（assets/judge.js）。即時競賽必須由伺服器
// 判定誰先答對，兩邊規則不一致的話就會出現「我明明打對了卻沒拿到分」。
const { normalize, editDistance, judge } = window.Judge;

// 平常用 Math.random，競賽時換成由代碼種子推出來的亂數，
// 這樣同一組代碼的每個人抽到的題目與送字才會一模一樣。
const nativeRng = () => Math.random();

function shuffle(arr, rng = nativeRng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 洗牌後再推開同一首歌的題目，避免上一題剛好爆雷下一題 */
function spreadBySong(list, rng = nativeRng) {
  const out = shuffle(list, rng);
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

// 「可以猜的一格」：中文是一個漢字（han），日文是一個詞（word）。
// 兩種磚塊在畫面上都是一格、都能被送字或提示揭開，所以一起處理。
const GUESSABLE = new Set(['han', 'word']);

/** 這一題每一格底下真正的字（揭開時要顯示的東西） */
function unitTexts(q) {
  const han = hanChars(q.line);
  let hi = 0;
  return q.tiles
    .filter((t) => GUESSABLE.has(t.k))
    .map((t) => (t.k === 'han' ? han[hi++] : t.w));
}

/** 答案有幾個字：日文直接數字元，中文只數漢字 */
const answerChars = (q) => (q.lang === 'ja' ? [...q.answer] : hanChars(q.answer));

/**
 * 開場就直接送給玩家的字（顯示原字而不是聲母）。
 * 猜歌名時一定先給開頭兩個字，讀起來像半句話比較好聯想；
 * 其餘名額優先給虛字，最後一定留至少兩個字要猜。
 */
function pickFreebies(q, ratio, rng = nativeRng) {
  const chars = unitTexts(q);
  const n = chars.length;
  if (n <= 2) return new Set();

  const maxReveal = n - 2;
  const picked = new Set();

  if (q.mode === 'title') {
    for (let i = 0; i < Math.min(2, maxReveal); i++) picked.add(i);
  }

  const quota = Math.min(maxReveal, Math.max(picked.size, 1, Math.round(n * ratio)));
  const rest = chars.map((_, i) => i).filter((i) => !picked.has(i));
  const glue = shuffle(rest.filter((i) => isGlue(chars[i])), rng);
  const other = shuffle(rest.filter((i) => !isGlue(chars[i])), rng);

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
  lastInput: '',
  challenge: null,   // { code, seed, rounds, … }，一般模式是 null
  qrng: nativeRng,   // 這一題專用的亂數（送字與提示都用它）
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

  const units = unitTexts(q);
  let unitIndex = -1;

  q.tiles.forEach((tile, i) => {
    const el = document.createElement('span');
    el.className = 'tile pop';
    el.style.animationDelay = `${Math.min(i * 28, 600)}ms`;

    if (GUESSABLE.has(tile.k)) {
      unitIndex++;
      if (tile.k === 'word') el.classList.add('is-word');
      if (state.revealed.has(unitIndex)) {
        el.classList.add('is-revealed');
        el.textContent = units[unitIndex];
      } else if (state.given.has(unitIndex)) {
        el.classList.add('is-given');
        el.textContent = units[unitIndex];
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
  $('#hud-lives-box').hidden = !!state.challenge;   // 競賽是固定題數，沒有愛心
  $('#hud-index').textContent = state.challenge
    ? `${Math.min(state.asked + 1, state.challenge.rounds)}/${state.challenge.rounds}`
    : state.asked + 1;
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
    const chars = answerChars(q);
    hints.push(`歌名共 ${chars.length} 個字，第一個字是「${chars[0]}」`);
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
    // 競賽的題數上限一定小於題庫，照理不會走到這裡；真的走到就用種子重洗，
    // 保證每個人重洗出來的順序還是一樣。
    state.queue = spreadBySong(
      state.bank,
      state.challenge ? Challenge.rngFor(state.challenge.seed, Challenge.QUEUE_INDEX) : nativeRng
    );
    state.cursor = 0;
  }

  state.current = state.queue[state.cursor++];
  state.hintsUsed = 0;
  state.hints = buildHints(state.current);
  state.revealed = new Set();
  state.lastInput = '';

  // 每題一條獨立的亂數流：用「種子＋題號」推出來，不受玩家按過幾次提示影響，
  // 否則有人買提示就會讓後面每一題的送字都跟別人不一樣。
  state.qrng = state.challenge
    ? Challenge.rngFor(state.challenge.seed, state.asked)
    : nativeRng;

  state.given = pickFreebies(state.current, state.revealRatio, state.qrng);
  state.awaitingNext = false;

  const q = state.current;
  renderPrompt(q);

  const answerLen = answerChars(q).length;
  $('#q-meta').textContent =
    q.mode === 'title'
      ? `答案是歌名，共 ${answerLen} 個字`
      : `這句共 ${answerLen} 個字`;

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
    const chars = unitTexts(state.current);
    const candidates = chars
      .map((_, i) => i)
      .filter((i) => !state.revealed.has(i) && !state.given.has(i));
    if (candidates.length) {
      state.revealed.add(candidates[Math.floor(state.qrng() * candidates.length)]);
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

/* ─────────────── 對答案 ─────────────── */

/**
 * 最長共同子序列，用來標出「哪幾個字打錯了」。
 * 答案都很短（十幾個字），O(n·m) 綽綽有餘。
 */
function matchedPairs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const inA = new Array(a.length).fill(false);
  const inB = new Array(b.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      inA[i] = true;
      inB[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { inA, inB };
}

/** 把字串一個字一個字塞進容器，對不上的標紅 */
function paintChars(container, text, keep, badClass) {
  container.innerHTML = '';
  [...text].forEach((ch, i) => {
    const span = document.createElement('span');
    span.textContent = ch;
    if (!keep[i]) span.classList.add(badClass);
    container.appendChild(span);
  });
}

/**
 * 送出之後讓玩家自己對答案：把你打的跟正解並排，
 * 差在哪個字直接標出來。答對（完全一樣）就不用囉嗦。
 */
function renderAnswerCheck(q, outcome, matchKind) {
  const box = $('#fb-check');
  const typed = state.lastInput;

  if (!typed || (outcome === 'correct' && matchKind === 'exact')) {
    box.hidden = true;
    return;
  }

  const guess = [...normalize(typed)];
  const answer = [...normalize(q.answer)];
  const { inA, inB } = matchedPairs(guess, answer);

  paintChars($('#fb-check-yours'), normalize(typed), inA, 'ch-bad');
  paintChars($('#fb-check-answer'), normalize(q.answer), inB, 'ch-miss');

  const missed = inB.filter((ok) => !ok).length;
  $('#fb-check-note').textContent =
    outcome === 'correct'
      ? `只差 ${missed} 個字，算你對`
      : missed === 0
        ? '字都對了，但順序或長度不一樣'
        : `差了 ${missed} 個字`;

  box.hidden = false;
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
      if (!state.challenge) state.lives--;
      verdict = outcome === 'timeout' ? '⏰ 時間到' : '❌ 答錯了';
    }
    note = outcome === 'skip'
      ? '連擊歸零'
      : state.challenge
        ? '連擊歸零，繼續下一題'
        : `失去一顆愛心，還剩 ${state.lives} 顆`;
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
  renderAnswerCheck(q, outcome, matchKind);

  renderHud();
  bump($('#hud-score'));

  fb.hidden = false;
  $('#btn-next').textContent = isRunOver() ? '看結果' : '下一題';
  $('#btn-next').focus();
  state.awaitingNext = true;
}

/** 這一局結束了沒：競賽是題數用完，一般模式是愛心用完 */
function isRunOver() {
  return state.challenge ? state.asked >= state.challenge.rounds : state.lives <= 0;
}

function proceed() {
  if (!state.awaitingNext) return;
  state.awaitingNext = false;
  $('#feedback').hidden = true;
  if (isRunOver()) gameOver();
  else nextQuestion();
}

/* ─────────────── 開始 / 結束 ─────────────── */

function startGame() {
  if (!state.allQuestions) return; // 題庫還沒載好
  const mode = document.querySelector('input[name="mode"]:checked').value;
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

  beginRun(null);
}

/** 真正開一局。challenge 為 null 就是一般無盡模式。 */
function beginRun(challenge) {
  const level = challenge
    ? challenge.level
    : document.querySelector('input[name="level"]:checked').value;

  Object.assign(state, {
    challenge,
    queue: spreadBySong(
      state.bank,
      challenge ? Challenge.rngFor(challenge.seed, Challenge.QUEUE_INDEX) : nativeRng
    ),
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
  // 競賽是固定題數，跟無盡模式的分數不能混在一起比
  const newRecord = !state.challenge && state.score > best.score;
  if (!state.challenge) {
    best.score = Math.max(best.score, state.score);
    best.combo = Math.max(best.combo, state.bestStreak);
    saveBest(best);
  }

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

  renderVsResult();
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

/* ─────────────── 多人競賽 ─────────────── */

const BOARD_KEY = 'bpmf-lyrics:board:';

const playerName = () => ($('#vs-name').value || '').trim().slice(0, 20) || '匿名';

const VS_TABS = ['live', 'host', 'join'];

function showVsPanel(which) {
  const active = VS_TABS.includes(which) ? which : 'live';
  for (const name of VS_TABS) {
    const on = name === active;
    $(`#panel-${name}`).hidden = !on;
    $(`#tab-${name}`).classList.toggle('is-on', on);
    $(`#tab-${name}`).setAttribute('aria-selected', String(on));
  }
}

/** 用首頁目前的設定 ＋ 一個新種子，做出一組比賽代碼 */
function makeChallenge() {
  const eras = checkedEras();
  if (!eras.length) {
    alert('先在首頁選好年代再建立比賽');
    return;
  }
  const settings = {
    seed: Challenge.randomSeed(),
    mode: document.querySelector('input[name="mode"]:checked').value,
    level: document.querySelector('input[name="level"]:checked').value,
    eras: eras.map((e) => e.id),
    rounds: Number(document.querySelector('input[name="vs-rounds"]:checked').value),
  };

  // 先確認這組設定真的抽得到題目，不然朋友點進來才發現是空的
  if (!filterBank(state.allQuestions, settings.mode, eras).length) {
    alert('這個題型加上這些年代沒有題目，換一個再建立');
    return;
  }

  const code = Challenge.encodeChallenge(settings);
  state.pendingChallenge = { ...settings, code };

  $('#vs-code').textContent = code;
  $('#vs-code-box').hidden = false;
}

function challengeLink(code) {
  const url = new URL(location.href);
  url.hash = '';
  url.search = `?c=${encodeURIComponent(code)}`;
  return url.toString();
}

async function copyText(text, btn) {
  const done = (ok) => {
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = ok ? '已複製 ✓' : '複製失敗';
    setTimeout(() => { btn.textContent = original; }, 1500);
  };
  try {
    await navigator.clipboard.writeText(text);
    done(true);
  } catch {
    done(false);
  }
}

/** 把代碼變成一場比賽並開打 */
function startChallenge(settings) {
  const eras = ERAS.filter((e) => settings.eras.includes(e.id));
  const bank = filterBank(state.allQuestions, settings.mode, eras);
  if (!bank.length) {
    alert('這組代碼的設定目前沒有題目');
    return false;
  }
  state.bank = bank;
  beginRun(settings);
  return true;
}

function joinChallenge() {
  const err = $('#vs-join-error');
  const settings = Challenge.decodeChallenge($('#vs-code-input').value);
  if (!settings) {
    err.textContent = '代碼看不懂，再確認一次（長得像 3F2K9Z-1A9）';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  startChallenge(settings);
}

/* ── 排行榜（存在自己的瀏覽器，沒有伺服器） ── */

function loadBoard(code) {
  try {
    const raw = localStorage.getItem(BOARD_KEY + code);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveBoard(code, list) {
  try { localStorage.setItem(BOARD_KEY + code, JSON.stringify(list)); } catch { /* 無痕就算了 */ }
}

/** 同一個人重複貼就取比較高的那筆 */
function mergeResult(list, r) {
  const out = list.filter((x) => x.name !== r.name);
  const previous = list.find((x) => x.name === r.name);
  out.push(previous && previous.score > r.score ? previous : r);
  return Challenge.rank(out);
}

function renderBoard(code) {
  const list = Challenge.rank(loadBoard(code));
  const table = $('#vs-board');
  const body = $('#vs-board-body');
  body.innerHTML = '';
  table.hidden = list.length === 0;

  list.forEach((r, i) => {
    const tr = document.createElement('tr');
    for (const text of [`${i + 1}`, r.name, `${r.score}`, `${r.correct}/${r.asked}`]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  });
}

function addPastedResult() {
  const err = $('#vs-paste-error');
  const code = state.challenge?.code ?? state.lastChallengeCode;
  const r = Challenge.decodeResult($('#vs-paste').value);

  if (!r) {
    err.textContent = '成績碼看不懂，請對方整段重貼一次';
    err.hidden = false;
    return;
  }
  if (r.code !== code) {
    err.textContent = '這是別場比賽的成績碼';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  $('#vs-paste').value = '';
  saveBoard(code, mergeResult(loadBoard(code), r));
  renderBoard(code);
}

/** 結算畫面的競賽區塊 */
function renderVsResult() {
  const box = $('#vs-result');
  const challenge = state.challenge;
  box.hidden = !challenge;
  if (!challenge) return;

  const code = challenge.code;
  state.lastChallengeCode = code;

  const mine = {
    code,
    name: playerName(),
    score: state.score,
    correct: state.correct,
    asked: state.asked,
    combo: state.bestStreak,
  };

  $('#vs-result-code').textContent = code;
  $('#vs-my-result').textContent = Challenge.encodeResult(mine);

  saveBoard(code, mergeResult(loadBoard(code), mine));
  renderBoard(code);
}

/* ─────────────── 事件綁定 ─────────────── */

function bindEvents() {
  $('#btn-start').addEventListener('click', startGame);
  $('#btn-again').addEventListener('click', () => {
    if (state.challenge) beginRun(state.challenge);
    else startGame();
  });
  $('#btn-home').addEventListener('click', () => showScreen('screen-start'));
  $('#btn-hint').addEventListener('click', useHint);
  $('#btn-skip').addEventListener('click', skipQuestion);
  $('#btn-next').addEventListener('click', proceed);

  for (const el of document.querySelectorAll('input[name="era"], input[name="mode"]')) {
    el.addEventListener('change', updateBankSummary);
  }

  for (const el of document.querySelectorAll('input[name="lang"]')) {
    el.addEventListener('change', () => switchLanguage(el.value));
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

    state.lastInput = value;
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
  $('#btn-vs').addEventListener('click', () => {
    showVsPanel('live');
    showScreen('screen-vs');
  });
  $('#btn-vs-back').addEventListener('click', () => showScreen('screen-start'));
  $('#tab-live').addEventListener('click', () => showVsPanel('live'));
  $('#tab-host').addEventListener('click', () => showVsPanel('host'));
  $('#tab-join').addEventListener('click', () => showVsPanel('join'));
  if (window.Live) window.Live.bind();
  $('#btn-make-code').addEventListener('click', makeChallenge);
  $('#btn-join').addEventListener('click', joinChallenge);
  $('#btn-host-play').addEventListener('click', () => {
    if (state.pendingChallenge) startChallenge(state.pendingChallenge);
  });
  $('#btn-copy-code').addEventListener('click', (e) =>
    copyText(state.pendingChallenge.code, e.currentTarget));
  $('#btn-copy-link').addEventListener('click', (e) =>
    copyText(challengeLink(state.pendingChallenge.code), e.currentTarget));
  $('#btn-copy-result').addEventListener('click', (e) =>
    copyText($('#vs-my-result').textContent, e.currentTarget));
  $('#btn-add-result').addEventListener('click', addPastedResult);
  $('#btn-clear-board').addEventListener('click', () => {
    const code = state.challenge?.code ?? state.lastChallengeCode;
    if (code) { saveBoard(code, []); renderBoard(code); }
  });

  $('#vs-code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); joinChallenge(); }
  });
  $('#vs-paste').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPastedResult(); }
  });

  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('bpmf-theme', next); } catch { /* ignore */ }
  });
}

/** 有人是點邀請連結進來的：直接跳到加入畫面並把代碼填好 */
function openInvite() {
  const code = new URLSearchParams(location.search).get('c');
  if (!code) return;
  if (!Challenge.decodeChallenge(code)) return;
  $('#vs-code-input').value = code.toUpperCase();
  showVsPanel('join');
  showScreen('screen-vs');
}

/** 換語言：整份題庫換掉，設定與紀錄不動 */
async function switchLanguage(lang) {
  const startBtn = $('#btn-start');
  startBtn.disabled = true;
  startBtn.textContent = '載入題庫中…';
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch { /* 無痕模式就算了 */ }

  try {
    const { questions } = await loadQuestions(lang);
    state.allQuestions = questions;
    renderEraCounts();
    updateBankSummary();
    $('#footer-count').textContent = questions.length;
    startBtn.disabled = false;
    startBtn.textContent = '開始遊戲';
  } catch (err) {
    console.error(err);
    startBtn.textContent = '題庫載入失敗';
  }
}

/* ─────────────── 啟動 ─────────────── */

async function main() {
  bindEvents();
  refreshBestDisplay();

  const startBtn = $('#btn-start');
  startBtn.disabled = true;
  startBtn.textContent = '載入題庫中…';

  let saved = 'zh';
  try { saved = localStorage.getItem(LANG_KEY) || 'zh'; } catch { /* ignore */ }
  const radio = document.querySelector(`input[name="lang"][value="${saved}"]`);
  if (radio) radio.checked = true;

  try {
    const { questions } = await loadQuestions(currentLang());
    state.allQuestions = questions;
    renderEraCounts();
    updateBankSummary();
    $('#footer-count').textContent = questions.length;
    startBtn.disabled = false;
    startBtn.textContent = '開始遊戲';
    openInvite();
  } catch (err) {
    console.error(err);
    $('#bank-size').textContent = '載入失敗';
    $('#btn-start').disabled = true;
    $('#btn-start').textContent = '題庫載入失敗';
  }
}

main();

})();
