/**
 * 多人競賽的純邏輯層 —— 不碰 DOM，方便單獨測試。
 *
 * 沒有後端，所以「同一場比賽」靠的是一組代碼：代碼裡帶著亂數種子與設定，
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

const MIN_ROUNDS = 5;
const MAX_ROUNDS = 40;

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

function randomSeed() {
  if (global.crypto && global.crypto.getRandomValues) {
    return global.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/* ─────────────── 比賽代碼 ─────────────── */

const b36 = (n) => n.toString(36).toUpperCase();

/**
 * 設定 → 代碼。格式是「種子-設定」兩段 base36，例如 3F2K9Z-1A9。
 * @param {{seed:number, mode:string, level:string, eras:string[], rounds:number}} s
 */
function encodeChallenge(s) {
  const mode = Math.max(0, MODES.indexOf(s.mode));
  const level = Math.max(0, LEVELS.indexOf(s.level));
  const eraMask = ERA_IDS.reduce(
    (m, id, i) => (s.eras.includes(id) ? m | (1 << i) : m),
    0
  );
  if (!eraMask) throw new Error('至少要選一個年代');

  const rounds = clampRounds(s.rounds);
  const packed = mode | (level << 2) | (eraMask << 4) | (rounds << 8);
  return `${b36(s.seed >>> 0)}-${b36(packed)}`;
}

/** 代碼 → 設定；看不懂就回 null（不丟例外，呼叫端好處理） */
function decodeChallenge(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = cleaned.match(/^([0-9A-Z]+)-([0-9A-Z]+)$/);
  if (!m) return null;

  const seed = parseInt(m[1], 36);
  const packed = parseInt(m[2], 36);
  if (!Number.isFinite(seed) || !Number.isFinite(packed) || packed < 0) return null;

  const eraMask = (packed >> 4) & 0b1111;
  if (!eraMask) return null;

  const rounds = (packed >> 8) & 0b111111;
  if (rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) return null;

  return {
    seed: seed >>> 0,
    mode: MODES[packed & 0b11] ?? MODES[0],
    level: LEVELS[(packed >> 2) & 0b11] ?? LEVELS[1],
    eras: ERA_IDS.filter((_, i) => eraMask & (1 << i)),
    rounds,
    code: `${m[1]}-${m[2]}`,
  };
}

function clampRounds(n) {
  const r = Math.round(Number(n) || 0);
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, r));
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
  MIN_ROUNDS,
  MAX_ROUNDS,
  makeRng,
  mixSeed,
  randomSeed,
  clampRounds,
  encodeChallenge,
  decodeChallenge,
  encodeResult,
  decodeResult,
  rank,
};

})(typeof window !== 'undefined' ? window : globalThis);
