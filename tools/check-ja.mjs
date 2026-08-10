// 日文題庫的檢查：npm run check:ja
// 日文沒辦法自動斷詞與轉讀音，全靠來源檔人工標注，所以更需要機器把對不上的地方抓出來。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { firstKana, toTiles } from './build-ja.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e.message}`); }
};

const src = JSON.parse(read('data/songs.ja.json'));
const bank = JSON.parse(read('data/questions.ja.json'));

console.log('日文首音');

test('平假名與片假名都取得出首音', () => {
  assert.equal(firstKana('しずむ'), 'し');
  assert.equal(firstKana('ように'), 'よ');
  assert.equal(firstKana('テーゼ'), 'テ');
  assert.equal(firstKana('ふぉーちゅんくっきー'), 'ふ');
});

test('拗音・促音開頭會還原成大字', () => {
  // ちいさい假名不會單獨當一個詞的開頭，真的遇到就還原
  assert.equal(firstKana('ゃ'), 'や');
  assert.equal(firstKana('っ'), 'つ');
  assert.equal(firstKana('ォ'), 'オ');
});

test('長音符號不會被當成首音', () => {
  assert.equal(firstKana('ーめん'), 'め');
});

test('取不出首音時回 null，不會硬湊', () => {
  assert.equal(firstKana(''), null);
  assert.equal(firstKana('123'), null);
});

console.log('\n斷詞');

test('歌詞與讀音的詞數必須一樣', () => {
  const bad = [];
  for (const song of src.songs) {
    for (const [i, line] of song.lines.entries()) {
      const words = line.text.trim().split(/\s+/).filter(Boolean).length;
      const kana = line.kana.trim().split(/\s+/).filter(Boolean).length;
      if (words !== kana) bad.push(`${song.title} 第 ${i + 1} 句：${words} vs ${kana}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('每個詞都配到一個假名首音，沒有問號', () => {
  const bad = bank.questions
    .flatMap((q) => q.tiles.filter((t) => t.k === 'word' && t.t === '？').map(() => q.title));
  assert.deepEqual([...new Set(bad)], []);
});

test('磚塊數量等於斷出來的詞數', () => {
  for (const q of bank.questions) {
    if (q.mode !== 'lyric') continue;
    const words = q.tiles.filter((t) => t.k === 'word').length;
    assert.equal(words, q.units, `${q.id} 詞數對不上`);
  }
});

test('每個詞磚都帶著原本的詞，揭曉時才有東西可以顯示', () => {
  for (const q of bank.questions) {
    for (const t of q.tiles) {
      if (t.k === 'word') assert.ok(t.w, `${q.id} 有詞磚沒有 w`);
    }
  }
});

test('首音都是假名', () => {
  const kana = /^[぀-ゟ゠-ヿ]$/;
  for (const q of bank.questions) {
    for (const t of q.tiles) {
      if (t.k === 'word') assert.match(t.t, kana, `${q.id} 的「${t.t}」不是假名`);
    }
  }
});

console.log('\n題目資料');

test('答案是把斷詞的空白拿掉的原句', () => {
  for (const q of bank.questions) {
    if (q.mode !== 'lyric') continue;
    assert.ok(!/\s/.test(q.answer), `${q.id} 的答案還留著空白`);
    const fromTiles = q.tiles.filter((t) => t.k === 'word').map((t) => t.w).join('');
    assert.equal(fromTiles, q.answer, `${q.id} 磚塊拼起來跟答案不一樣`);
  }
});

test('每題都有答案、磚塊、難度、語言標記', () => {
  for (const q of bank.questions) {
    assert.equal(q.lang, 'ja', `${q.id} 沒有標成日文`);
    assert.ok(q.answer, `${q.id} 沒有答案`);
    assert.ok(q.tiles.length, `${q.id} 沒有磚塊`);
    assert.ok(q.difficulty >= 1 && q.difficulty <= 4, `${q.id} 難度怪怪的`);
    assert.ok(q.accept.includes(q.answer), `${q.id} accept 沒包含答案`);
  }
});

test('每首歌都有年份', () => {
  const undated = src.songs.filter((s) => typeof s.year !== 'number');
  assert.deepEqual(undated.map((s) => s.title), []);
});

test('歌曲 id 不重複', () => {
  const ids = src.songs.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('同一句歌詞不會同時屬於兩首歌', () => {
  const owner = new Map();
  const dup = [];
  for (const song of src.songs) {
    for (const line of song.lines) {
      const key = line.text.replace(/\s+/g, '');
      if (owner.has(key)) dup.push(`${key}：${owner.get(key)} / ${song.id}`);
      owner.set(key, song.id);
    }
  }
  assert.deepEqual(dup, []);
});

console.log('\n斷詞工具');

test('詞數對不上時會出現警告而不是安靜地錯掉', () => {
  // toTiles 會把問題記進 warnings，這裡確認它至少不會炸、也不會亂配對
  const tiles = toTiles('君 と 僕', 'きみ と', '測試');
  const words = tiles.filter((t) => t.k === 'word');
  assert.equal(words.length, 3, '詞還是要照歌詞的數量排出來');
  assert.equal(words[2].t, '？', '配不到讀音的詞應該標成問號讓人發現');
});

test('詞與詞之間會插入空白磚', () => {
  const tiles = toTiles('君 と 僕', 'きみ と ぼく', '測試');
  assert.deepEqual(tiles.map((t) => t.k), ['word', 'space', 'word', 'space', 'word']);
});

console.log(failures ? `\n✗ ${failures} 項失敗` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
