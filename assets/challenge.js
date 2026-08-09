/**
 * 多人競賽的純邏輯層 —— 不碰 DOM，方便單獨測試。
 *
 * 沒有後端，所以「同一場比賽」全靠一組 4 碼代碼：代碼裡帶著亂數種子與設定，
 * 誰拿到代碼，誰就會抽到完全一樣的題目、一樣的順序、一樣的送字。
 * 主持人建立代碼分享出去，挑戰者各自玩完再把成績碼貼回來比。
 */
(function (global) {
'use strict';

// 代碼裡年代欄位的位元順序。改動等於讓舊代碼失效，所以要跟 app.js 的 ERAS
// 保持一致（tools/check.mjs 有測試釘住這件事）。
const ERA_IDS = ['classic', 'y2000s', 'y2010s', 'y2020s'];
const MODES = ['mixed', 'title', 'lyric'];
const LEVELS = ['chill', 'normal', 'hard'];

// 題數只給這四種，因為代碼裡只有 2 個位元可以放
const ROUND_CHOICES = [5, 10, 20, 40];

/**
 * 代碼用的 32 個字元。故意拿掉 I L O U：
 * I 跟 1、L 跟 1、O 跟 0 唸出來或看起來都會搞混，U 拿掉是為了湊剛好 32 個
 * （32 = 2^5，一個字元剛好 5 個位元，四個字元剛好 20 位元）。
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LEN = 4;

// 20 位元怎麼分：設定佔低 10 位，種子佔高 10 位
const SETTING_BITS = 10;
const SEED_MAX = 1 << 10;          // 1024 種不同的考卷

/** 唸錯／打錯也認得出來的常見替換 */
const CONFUSABLE = { I: '1', L: '1', O: '0', U: 'V' };

/**
 * 20 位元的打散。設定在低 10 位、種子在高 10 位，不打散的話同一組設定編出來的
 * 代碼後兩個字永遠一樣（CT34、3734、SM34…），看起來很像壞掉。
 *
 * 這裡用 4 回合的 Feistel：把 20 位元切成兩個 10 位元，反覆
 * (L, R) → (R, L xor F(R))。不管 F 是什麼，這個變換一定是一對一的，
 * 而且高低兩半會互相影響，所以低位也會被攪動。反向就是把回合倒著跑一次。
 */
const HALF_BITS = 10;
const HALF_MASK = (1 << HALF_BITS) - 1;
const ROUNDS = 4;

function feistelF(x, round) {
  let h = (x ^ Math.imul(round + 1, 0x9e37)) & 0xffff;
  h = Math.imul(h, 0x2545f) & 0xfffff;
  h ^= h >>> 7;
  return h & HALF_MASK;
}

function scramble(v) {
  let L = (v >>> HALF_BITS) & HALF_MASK;
  let R = v & HALF_MASK;
  for (let i = 0; i < ROUNDS; i++) {
    const nextR = (L ^ feistelF(R, i)) & HALF_MASK;
    L = R;
    R = nextR;
  }
  return ((L << HALF_BITS) | R) >>> 0;
}

function unscramble(v) {
  let L = (v >>> HALF_BITS) & HALF_MASK;
  let R = v & HALF_MASK;
  for (let i = ROUNDS - 1; i >= 0; i--) {
    const prevR = L;
    const prevL = (R ^ feistelF(prevR, i)) & HALF_MASK;
    L = prevL;
    R = prevR;
  }
  return ((L << HALF_BITS) | R) >>> 0;
}

/**
 * mulberry32：小巧的可重現亂數。同一個種子永遠吐出同一串數字，
 * 這是「大家題目一樣」的關鍵。
 */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把種子跟題號混成另一個種子，讓每一題的送字獨立於玩家做過什麼 */
function mixSeed(seed, n) {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 取得某一題專用的亂數。代碼裡的種子只有 10 位元，相鄰的種子直接餵進
 * mulberry32 開頭會有點像，所以一律先用 mixSeed 打散再用。
 */
function rngFor(seed, index) {
  return makeRng(mixSeed(seed, index));
}

/** 抽題順序用的亂數（用 -1 當題號，跟任何一題都不會撞） */
const QUEUE_INDEX = -1;

function randomSeed() {
  if (global.crypto && global.crypto.getRandomValues) {
    return global.crypto.getRandomValues(new Uint32Array(1))[0] % SEED_MAX;
  }
  return Math.floor(Math.random() * SEED_MAX);
}

/* ─────────────── 比賽代碼 ─────────────── */

/** 最接近的合法題數，例如 12 → 10 */
function nearestRounds(n) {
  const target = Number(n) || 0;
  return ROUND_CHOICES.reduce((best, r) =>
    Math.abs(r - target) < Math.abs(best - target) ? r : best
  );
}

/** 打字時把容易混淆的字元救回來，並吃掉空白與連字號 */
function normalizeCode(raw) {
  return String(raw)
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .split('')
    .map((c) => CONFUSABLE[c] ?? c)
    .join('');
}

/**
 * 設定 → 4 碼代碼，例如 7K2P。
 * @param {{seed:number, mode:string, level:string, eras:string[], rounds:number}} s
 */
function encodeChallenge(s) {
  const mode = MODES.indexOf(s.mode);
  const level = LEVELS.indexOf(s.level);
  if (mode < 0) throw new Error(`不認得的題型：${s.mode}`);
  if (level < 0) throw new Error(`不認得的難度：${s.level}`);

  const eraMask = ERA_IDS.reduce(
    (m, id, i) => (s.eras.includes(id) ? m | (1 << i) : m),
    0
  );
  if (!eraMask) throw new Error('至少要選一個年代');

  const roundsIdx = ROUND_CHOICES.indexOf(nearestRounds(s.rounds));
  const settings = mode | (level << 2) | (eraMask << 4) | (roundsIdx << 8);
  const seed = (s.seed >>> 0) % SEED_MAX;

  let v = scramble((seed << SETTING_BITS) | settings);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out = ALPHABET[v & 31] + out;
    v >>>= 5;
  }
  return out;
}

/** 代碼 → 設定；看不懂就回 null（不丟例外，呼叫端好處理） */
function decodeChallenge(raw) {
  if (typeof raw !== 'string') return null;
  const code = normalizeCode(raw);
  if (code.length !== CODE_LEN) return null;

  let packed = 0;
  for (const ch of code) {
    const d = ALPHABET.indexOf(ch);
    if (d < 0) return null;
    packed = packed * 32 + d;
  }
  const v = unscramble(packed);

  const settings = v & (SEED_MAX - 1);
  const seed = (v >>> SETTING_BITS) & (SEED_MAX - 1);

  const mode = MODES[settings & 0b11];
  const level = LEVELS[(settings >> 2) & 0b11];
  const eraMask = (settings >> 4) & 0b1111;
  const rounds = ROUND_CHOICES[(settings >> 8) & 0b11];

  // 這三個欄位都有用不到的位元組合，撞到就代表這不是我們發出去的代碼
  if (!mode || !level || !eraMask || !rounds) return null;

  return {
    seed,
    mode,
    level,
    eras: ERA_IDS.filter((_, i) => eraMask & (1 << i)),
    rounds,
    code,
  };
}

/* ─────────────── 成績碼 ─────────────── */
// 純粹是為了方便貼來貼去，不是防作弊。想改分數的人改得掉，朋友間玩夠用了。

const toB64 = (s) =>
  global.btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/=+$/, '');

const fromB64 = (s) =>
  new TextDecoder().decode(
    Uint8Array.from(global.atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  );

/** @param {{code:string,name:string,score:number,correct:number,asked:number,combo:number}} r */
function encodeResult(r) {
  return toB64(
    JSON.stringify([r.code, r.name, r.score, r.correct, r.asked, r.combo])
  );
}

function decodeResult(raw) {
  try {
    const a = JSON.parse(fromB64(String(raw).trim()));
    if (!Array.isArray(a) || a.length < 6) return null;
    const [code, name, score, correct, asked, combo] = a;
    if (typeof code !== 'string' || typeof score !== 'number') return null;
    return {
      code,
      name: String(name || '匿名').slice(0, 20),
      score,
      correct: Number(correct) || 0,
      asked: Number(asked) || 0,
      combo: Number(combo) || 0,
    };
  } catch {
    return null;
  }
}

/** 依分數排名，同分再比答對題數 */
function rank(results) {
  return results
    .slice()
    .sort((a, b) => b.score - a.score || b.correct - a.correct);
}

global.Challenge = {
  ERA_IDS,
  MODES,
  LEVELS,
  ROUND_CHOICES,
  ALPHABET,
  CODE_LEN,
  SEED_MAX,
  QUEUE_INDEX,
  scramble,
  unscramble,
  makeRng,
  mixSeed,
  rngFor,
  randomSeed,
  nearestRounds,
  normalizeCode,
  encodeChallenge,
  decodeChallenge,
  encodeResult,
  decodeResult,
  rank,
};

})(typeof window !== 'undefined' ? window : globalThis);
