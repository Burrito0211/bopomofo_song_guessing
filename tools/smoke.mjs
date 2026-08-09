// 用最小的 DOM 假物件把整局遊戲跑一遍，確認流程不會炸。
// 用法：npm run smoke
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const CR = String.fromCharCode(13);
const NL = String.fromCharCode(10);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 統一換行：Windows checkout 會把檔案變成 CRLF，字串比對會對不上
const read = (p) =>
  readFileSync(join(ROOT, p), 'utf8').split(CR + NL).join(NL);

/* ── 極簡 DOM ── */
function makeEl(id = '') {
  const el = {
    id,
    children: [],
    _classes: new Set(),
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    hidden: false,
    style: {},
    dataset: {},
    offsetWidth: 1,
    classList: {
      add: (...c) => c.forEach((x) => el._classes.add(x)),
      remove: (...c) => c.forEach((x) => el._classes.delete(x)),
      toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)),
      contains: (c) => el._classes.has(c),
    },
    appendChild: (child) => el.children.push(child),
    addEventListener: (type, fn) => (el._handlers ??= {})[type] = fn,
    focus: () => {},
  };
  return el;
}

const els = new Map();
const el = (id) => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};

const checked = { mode: 'mixed', level: 'normal' };

const document = {
  documentElement: makeEl('html'),
  querySelector(sel) {
    if (sel.startsWith('#')) return el(sel.slice(1));
    const m = sel.match(/input\[name="(\w+)"\]:checked/);
    if (m) return { value: checked[m[1]] };
    return makeEl();
  },
  querySelectorAll(sel) {
    if (sel === '.screen') {
      return ['screen-start', 'screen-game', 'screen-over'].map(el);
    }
    return [];
  },
  createElement: () => makeEl(),
  addEventListener: (t, fn) => (document._handlers ??= {})[t] = fn,
};

const store = new Map();
const window = {
  GameData: {
    loadQuestions: async () => {
      const raw = JSON.parse(read('data/questions.json'));
      return { questions: raw.questions, songCount: raw.songCount };
    },
  },
};

const localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
};

/* setInterval 不真的等，手動控制時間 */
const timers = [];
const setInterval = (fn) => { timers.push(fn); return timers.length; };
const clearInterval = () => {};
let clock = 0;
const performance = { now: () => clock };

/* ── 載入 app.js，並多回傳幾個內部函式來驅動測試 ── */
const src = read('assets/app.js')
  .replace("(function () {\n'use strict';", '')
  .replace(/main\(\);\s*\}\)\(\);\s*$/, '');

const app = new Function(
  'document', 'window', 'localStorage', 'setInterval', 'clearInterval', 'performance', 'alert',
  `${src}\nreturn { main, startGame, nextQuestion, resolveQuestion, proceed, useHint, skipQuestion, state, judge };`
)(document, window, localStorage, setInterval, clearInterval, performance, () => {});

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e.message}`); }
};

console.log('整局流程');

await app.main();

test('題庫載入後 startGame 不會爆', () => {
  app.startGame();
  assert.ok(app.state.current, '沒有出題');
  assert.equal(app.state.lives, 3);
  assert.equal(el('screen-game')._classes.has('is-active'), true, '沒切到遊戲畫面');
});

test('磚塊有畫出來', () => {
  assert.ok(el('q-tiles').children.length > 0, 'q-tiles 是空的');
});

test('開場有直接送字，而且沒送完', () => {
  // 找一題夠長的，短句本來就不送字
  for (let i = 0; i < 30 && app.state.current.line.length < 6; i++) app.nextQuestion();
  assert.ok(app.state.given.size > 0, '一個字都沒送');
  const shown = el('q-tiles').children.filter((c) => c._classes.has('is-given'));
  assert.equal(shown.length, app.state.given.size, '送的字沒畫成 is-given');
});

test('買提示不會重複揭已經送出去的字', () => {
  const overlap = () => [...app.state.revealed].filter((i) => app.state.given.has(i));
  app.useHint(); app.useHint(); app.useHint();
  assert.deepEqual(overlap(), [], '提示揭到已經送過的字');
});

test('答對會加分並累積連擊', () => {
  const before = app.state.score;
  app.resolveQuestion('correct', 'exact');
  assert.ok(app.state.score > before, '分數沒增加');
  assert.equal(app.state.streak, 1);
  assert.equal(el('feedback').hidden, false, '結果視窗沒跳出來');
  app.proceed();
  assert.ok(app.state.current, '沒有下一題');
});

test('提示會扣可得分數、連對兩題倍率上升', () => {
  app.useHint();
  assert.equal(app.state.hintsUsed, 1);
  assert.equal(el('hint-box').hidden, false);
  app.resolveQuestion('correct', 'exact');
  assert.equal(app.state.streak, 2);
  app.proceed();
});

test('跳過會歸零連擊但不扣命', () => {
  const lives = app.state.lives;
  app.skipQuestion();
  assert.equal(app.state.streak, 0);
  assert.equal(app.state.lives, lives);
  assert.equal(app.state.skipsLeft, 2);
  app.proceed();
});

test('答錯扣一顆愛心', () => {
  app.resolveQuestion('wrong');
  assert.equal(app.state.lives, 2);
  app.proceed();
});

test('超時也扣愛心', () => {
  app.resolveQuestion('timeout');
  assert.equal(app.state.lives, 1);
  app.proceed();
});

test('愛心歸零就進結算，並寫入最高分', () => {
  app.resolveQuestion('wrong');
  assert.equal(app.state.lives, 0);
  app.proceed();
  assert.equal(el('screen-over')._classes.has('is-active'), true, '沒切到結算畫面');
  assert.ok(Number(el('over-score').textContent) >= 0);
  assert.ok(store.get('bpmf-lyrics:v1'), '最高分沒存進 localStorage');
});

test('題庫用完會自動重洗，連續 300 題不出錯', () => {
  app.startGame();
  for (let i = 0; i < 300; i++) {
    app.resolveQuestion('correct', 'exact');
    app.state.lives = 3;      // 撐住不讓它結束
    app.proceed();
  }
  assert.ok(app.state.asked >= 300);
});

test('計時器歸零會判超時', () => {
  app.startGame();
  clock = 0;
  app.nextQuestion();
  const tick = timers[timers.length - 1];
  clock = 999999;             // 時間快轉
  tick();
  assert.equal(app.state.lives, 2, '超時沒扣命');
});

console.log(failures ? `\n✗ ${failures} 項失敗` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
