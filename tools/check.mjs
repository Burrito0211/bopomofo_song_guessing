// 出貨前的自我檢查：語法、DOM id 對得上、答案判定邏輯。
// 用法：npm run check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

const html = read('index.html');
const appSrc = read('assets/app.js');

/* ── 1. HTML 裡的 id 是否涵蓋 app.js 用到的所有 $('#…') ── */
console.log('DOM 對照');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const usedIds = [...appSrc.matchAll(/\$\('#([^']+)'\)/g)].map((m) => m[1]);

test('app.js 用到的 id 都存在於 index.html', () => {
  const missing = [...new Set(usedIds)].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `找不到這些 id：${missing.join(', ')}`);
});

test('index.html 有載入 data.js 與 app.js', () => {
  assert.ok(html.includes('assets/data.js'), '缺少 data.js');
  assert.ok(html.includes('assets/app.js'), '缺少 app.js');
  assert.ok(html.includes('data/questions.js'), '缺少題庫');
});

/* ── 1b. hidden 屬性真的會把東西藏起來嗎？ ──
   class 選擇器的優先權比瀏覽器預設的 [hidden]{display:none} 高，
   所以只要某個會被 hidden 控制的元素，它的 class 有設 display，
   就必須有一條全域的 [hidden] 規則壓住它。 */
const css = read('assets/styles.css');

test('用 hidden 控制的元素不會被 class 的 display 蓋掉', () => {
  const hiddenEls = [...html.matchAll(/<[^>]*\bhidden\b[^>]*>/g)].map((m) => m[0]);
  const risky = [];

  for (const tag of hiddenEls) {
    const classAttr = tag.match(/class="([^"]+)"/);
    if (!classAttr) continue;
    for (const cls of classAttr[1].split(/\s+/)) {
      // 找 .cls { … display: … } 這種規則
      const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*display\\s*:`, 'g');
      if (rule.test(css)) risky.push(`.${cls}`);
    }
  }

  if (risky.length) {
    const guard = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css);
    assert.ok(
      guard,
      `${[...new Set(risky)].join(', ')} 有設 display，但 CSS 少了 [hidden]{display:none!important}`
    );
  }
});

/* ── 2. 把 app.js 的純函式挖出來測（去掉 IIFE 外殼跟 main()） ── */
const inner = appSrc
  .replace("(function () {\n'use strict';", '')
  .replace(/main\(\);\s*\}\)\(\);\s*$/, '')
  .replace("const loadQuestions = () => window.GameData.loadQuestions();", '');

const exposed = new Function(
  `${inner}\nreturn { normalize, judge, editDistance, hanChars, spreadBySong, pickFreebies, LEVELS };`
)();

console.log('\n答案判定');
const { normalize, judge, hanChars, spreadBySong } = exposed;

test('標點、空白、全形都不影響比對', () => {
  assert.equal(normalize('　我 懷念的，'), '我懷念的');
  assert.equal(normalize('Ｈｅｌｌｏ！'), 'hello');
});

test('完全正確 → exact', () => {
  assert.equal(judge('晴天', ['晴天']), 'exact');
  assert.equal(judge(' 晴天 ', ['晴天']), 'exact');
  assert.equal(judge('《晴天》', ['晴天']), 'exact');
});

test('長句差一個字 → close（仍算對）', () => {
  assert.equal(judge('我懷念的是無話不講', ['我懷念的是無話不說']), 'close');
});

test('短答案不做模糊比對，避免誤判', () => {
  assert.equal(judge('晴大', ['晴天']), 'wrong');
});

test('完全不對 → wrong', () => {
  assert.equal(judge('稻香', ['晴天']), 'wrong');
  assert.equal(judge('', ['晴天']), 'wrong');
});

test('別名也接受', () => {
  assert.equal(judge('我怀念的', ['我懷念的', '我怀念的']), 'exact');
});

const bank = JSON.parse(read('data/questions.json'));

console.log('\n開場送字');
const { pickFreebies, LEVELS } = exposed;

test('永遠留至少兩個字要猜，不會整句送完', () => {
  for (const q of bank.questions) {
    const n = hanChars(q.line).length;
    for (const lv of Object.values(LEVELS)) {
      for (let i = 0; i < 20; i++) {            // 有隨機性，多跑幾次
        const given = pickFreebies(q, lv.reveal);
        assert.ok(n - given.size >= 2, `${q.id} 只剩 ${n - given.size} 個字要猜`);
      }
    }
  }
});

test('猜歌名時固定送出這句的開頭兩個字', () => {
  for (const q of bank.questions.filter((x) => x.mode === 'title')) {
    if (hanChars(q.line).length < 4) continue;
    const given = pickFreebies(q, LEVELS.hard.reveal);  // 最少字的難度也要給
    assert.ok(given.has(0) && given.has(1), `${q.id} 沒送開頭`);
  }
});

test('送出去的位置都在句子範圍內', () => {
  for (const q of bank.questions) {
    const n = hanChars(q.line).length;
    for (const i of pickFreebies(q, LEVELS.chill.reveal)) {
      assert.ok(i >= 0 && i < n, `${q.id} 位置 ${i} 超出範圍`);
    }
  }
});

test('難度越低送越多字', () => {
  const avg = (ratio) => {
    let total = 0, runs = 0;
    for (const q of bank.questions.filter((x) => x.mode === 'lyric')) {
      for (let i = 0; i < 10; i++) { total += pickFreebies(q, ratio).size; runs++; }
    }
    return total / runs;
  };
  const chill = avg(LEVELS.chill.reveal);
  const hard = avg(LEVELS.hard.reveal);
  assert.ok(chill > hard, `悠閒 ${chill.toFixed(2)} 沒有比刺激 ${hard.toFixed(2)} 多`);
});

console.log('\n題目資料');

test('每題都有答案、磚塊、難度', () => {
  for (const q of bank.questions) {
    assert.ok(q.answer, `${q.id} 沒有答案`);
    assert.ok(Array.isArray(q.tiles) && q.tiles.length, `${q.id} 沒有磚塊`);
    assert.ok(q.difficulty >= 1 && q.difficulty <= 4, `${q.id} 難度怪怪的`);
    assert.ok(q.accept.includes(q.answer), `${q.id} accept 沒包含答案`);
  }
});

test('磚塊數量等於歌詞的中文字數', () => {
  for (const q of bank.questions) {
    if (q.mode !== 'lyric') continue;
    const hanTiles = q.tiles.filter((t) => t.k === 'han').length;
    assert.equal(hanTiles, hanChars(q.line).length, `${q.id}：${q.line}`);
  }
});

test('所有聲母都是合法的注音符號', () => {
  const ok = /^[ㄅ-ㄩ]$/;
  for (const q of bank.questions) {
    for (const t of q.tiles) {
      if (t.k === 'han') assert.ok(ok.test(t.t), `${q.id} 出現非注音符號「${t.t}」`);
    }
  }
});

test('題目順序不會讓同一首歌連在一起', () => {
  const ordered = spreadBySong(bank.questions);
  let adjacent = 0;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].songId === ordered[i - 1].songId) adjacent++;
  }
  assert.ok(adjacent === 0, `還有 ${adjacent} 處相鄰同歌`);
});

console.log(failures ? `\n✗ ${failures} 項失敗` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
