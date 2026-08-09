// 出貨前的自我檢查：語法、DOM id 對得上、答案判定邏輯。
// 用法：npm run check
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { pinyinToInitial } from './zhuyin.mjs';

const CR = String.fromCharCode(13);
const NL = String.fromCharCode(10);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 統一換行：Windows checkout 會把檔案變成 CRLF，字串比對會對不上
const read = (p) =>
  readFileSync(join(ROOT, p), 'utf8').split(CR + NL).join(NL);

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

// challenge.js 是個 IIFE，把它掛到一個假的 window 上就能單獨測
const challengeHost = { btoa, atob, crypto };
new Function('window', read('assets/challenge.js'))(challengeHost);
const Challenge = challengeHost.Challenge;

/* ── 1. HTML 裡的 id 是否涵蓋 app.js 用到的所有 $('#…') ── */
console.log('DOM 對照');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const usedIds = [...appSrc.matchAll(/\$\('#([^']+)'\)/g)].map((m) => m[1]);

test('app.js 用到的 id 都存在於 index.html', () => {
  const missing = [...new Set(usedIds)].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `找不到這些 id：${missing.join(', ')}`);
});

test('每個年代在 index.html 都有對應的按鈕，選擇器對得上', () => {
  // app.js 用 .chip[data-era="…"] 找按鈕、再往下找 .chip-count 寫數量，
  // 兩邊對不上的話只有在瀏覽器裡才會炸，所以在這裡先擋下來。
  const chips = [...html.matchAll(/<label class="chip" data-era="([^"]+)">([\s\S]*?)<\/label>/g)];
  const inHtml = chips.map((m) => m[1]);
  const inJs = [...appSrc.matchAll(/\{ id: '([^']+)', label: '[^']*', match:/g)].map((m) => m[1]);

  assert.deepEqual(inHtml, inJs, 'index.html 的年代按鈕跟 app.js 的 ERAS 對不起來');
  for (const [tag, id, body] of chips.map((m) => [m[0], m[1], m[2]])) {
    assert.ok(body.includes('class="chip-count"'), `${id} 少了 .chip-count`);
    assert.ok(tag.includes(`name="era" value="${id}"`), `${id} 的 value 不對`);
  }
});

test('年代是複選（checkbox），而且預設全部勾起來', () => {
  const boxes = [...html.matchAll(/<input type="(\w+)" name="era"[^>]*>/g)];
  assert.equal(boxes.length, 4, '應該有四個年代選項');
  for (const [tag, type] of boxes.map((m) => [m[0], m[1]])) {
    assert.equal(type, 'checkbox', `年代要用 checkbox 才能複選：${tag}`);
    assert.ok(tag.includes('checked'), `預設要勾起來：${tag}`);
  }
  assert.ok(
    /aria-label="年代，可複選"/.test(html),
    '複選群組不該再標成 radiogroup，要讓螢幕閱讀器知道可以多選'
  );
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
  `${inner}\nreturn { normalize, judge, editDistance, hanChars, spreadBySong, pickFreebies, LEVELS, ERAS };`
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

/* ── 零聲母的字最容易出錯：拼音的 y/w 跟注音的 ㄧ/ㄨ/ㄩ 不是一對一 ── */
console.log('\n注音首符');

test('零聲母音節都對應到正確的注音首符', () => {
  const table = {
    // y 開頭大多是 ㄧ
    ya: 'ㄧ', ye: 'ㄧ', yao: 'ㄧ', you: 'ㄧ', yan: 'ㄧ', yin: 'ㄧ',
    yang: 'ㄧ', ying: 'ㄧ', yi: 'ㄧ', yo: 'ㄧ',
    // 但 yu- 與 yong 是 ㄩ（yong＝ㄩㄥ，永用擁勇湧）
    yu: 'ㄩ', yue: 'ㄩ', yuan: 'ㄩ', yun: 'ㄩ', yong: 'ㄩ',
    // w 開頭都是 ㄨ
    wa: 'ㄨ', wo: 'ㄨ', wai: 'ㄨ', wei: 'ㄨ', wan: 'ㄨ',
    wen: 'ㄨ', wang: 'ㄨ', weng: 'ㄨ', wu: 'ㄨ',
    // 純韻母
    a: 'ㄚ', o: 'ㄛ', e: 'ㄜ', ai: 'ㄞ', ei: 'ㄟ', ao: 'ㄠ', ou: 'ㄡ',
    an: 'ㄢ', en: 'ㄣ', ang: 'ㄤ', eng: 'ㄥ', er: 'ㄦ',
  };
  const wrong = Object.entries(table)
    .map(([py, want]) => [py, want, pinyinToInitial(py)])
    .filter(([, want, got]) => want !== got);
  assert.deepEqual(
    wrong.map(([py, want, got]) => `${py} 應該是 ${want}，卻得到 ${got}`),
    []
  );
});

test('21 個聲母都對得上', () => {
    const table = {
      ba: 'ㄅ', pa: 'ㄆ', ma: 'ㄇ', fa: 'ㄈ', da: 'ㄉ', ta: 'ㄊ', na: 'ㄋ',
      la: 'ㄌ', ga: 'ㄍ', ka: 'ㄎ', ha: 'ㄏ', ji: 'ㄐ', qi: 'ㄑ', xi: 'ㄒ',
      zha: 'ㄓ', cha: 'ㄔ', sha: 'ㄕ', re: 'ㄖ', za: 'ㄗ', ca: 'ㄘ', sa: 'ㄙ',
      // 兩個字母的要先比對，不然 zh/ch/sh 會被 z/c/s 搶走
      zhi: 'ㄓ', chi: 'ㄔ', shi: 'ㄕ', zi: 'ㄗ', ci: 'ㄘ', si: 'ㄙ',
    };
    const wrong = Object.entries(table)
      .map(([py, want]) => [py, want, pinyinToInitial(py)])
      .filter(([, want, got]) => want !== got);
    assert.deepEqual(wrong.map(([py, w, g]) => `${py} 應該是 ${w}，卻得到 ${g}`), []);
  });

test('有聲母的字取聲母，不會被零聲母規則搶走', () => {
  assert.equal(pinyinToInitial('zhong'), 'ㄓ');   // 中
  assert.equal(pinyinToInitial('xiong'), 'ㄒ');   // 兄
  assert.equal(pinyinToInitial('yun'), 'ㄩ');     // 雲
  assert.equal(pinyinToInitial('jun'), 'ㄐ');     // 軍
});

test('歌詞裡沒有混進非中文的雜字', () => {
  // 手打歌詞很容易不小心貼到別的語言的字，這種字轉不出注音，題目就變成無解
  const junk = [];
  for (const q of bank.questions) {
    if (q.mode !== 'lyric') continue;
    const bad = [...q.line].filter(
      (c) => !/[\p{Script=Han}\s0-9A-Za-z·，。！？、－]/u.test(c)
    );
    if (bad.length) junk.push(`${q.title}：${q.line} → ${bad.join('')}`);
  }
  assert.deepEqual([...new Set(junk)], []);
});

test('每個磚塊都轉得出注音，沒有問號', () => {
  const unknown = bank.questions
    .filter((q) => q.tiles.some((t) => t.k === 'han' && t.t === '？'))
    .map((q) => `${q.title}：${q.line}`);
  assert.deepEqual([...new Set(unknown)], []);
});

console.log('\n多人競賽');

test('比賽代碼編碼解碼可以來回', () => {
  const settings = {
    seed: 3735928559,
    mode: 'lyric',
    level: 'hard',
    eras: ['classic', 'y2020s'],
    rounds: 20,
  };
  const back = Challenge.decodeChallenge(Challenge.encodeChallenge(settings));
  assert.equal(back.seed, settings.seed);
  assert.equal(back.mode, settings.mode);
  assert.equal(back.level, settings.level);
  assert.deepEqual(back.eras, settings.eras);
  assert.equal(back.rounds, settings.rounds);
});

test('代碼大小寫、空白都不影響，看不懂的回 null', () => {
  const code = Challenge.encodeChallenge({
    seed: 42, mode: 'mixed', level: 'normal', eras: ['y2000s'], rounds: 10,
  });
  assert.deepEqual(
    Challenge.decodeChallenge(code.toLowerCase()),
    Challenge.decodeChallenge(` ${code} `)
  );
  for (const bad of ['', 'ABC', '$$$-$$$', 'ZZZ', null, undefined, '1-2']) {
    assert.equal(Challenge.decodeChallenge(bad), null, `${bad} 應該解不出來`);
  }
});

test('一個年代都沒選就編不出代碼', () => {
  assert.throws(() =>
    Challenge.encodeChallenge({ seed: 1, mode: 'mixed', level: 'normal', eras: [], rounds: 10 })
  );
});

test('題數會被夾在合理範圍內', () => {
  assert.equal(Challenge.clampRounds(0), Challenge.MIN_ROUNDS);
  assert.equal(Challenge.clampRounds(9999), Challenge.MAX_ROUNDS);
  assert.equal(Challenge.clampRounds(12), 12);
});

test('challenge.js 的年代順序跟 app.js 的 ERAS 一致', () => {
  // 代碼把年代存成位元遮罩，兩邊順序一旦不同，舊代碼就會解出錯的年代
  assert.deepEqual(Challenge.ERA_IDS, exposed.ERAS.map((e) => e.id));
});

test('同一個種子抽出來的題目順序完全一樣', () => {
  const seed = 20260810;
  const a = spreadBySong(bank.questions, Challenge.makeRng(seed)).map((q) => q.id);
  const b = spreadBySong(bank.questions, Challenge.makeRng(seed)).map((q) => q.id);
  assert.deepEqual(a, b, '同種子卻抽到不一樣的順序，比賽就不公平了');
});

test('不同種子會抽到不一樣的順序', () => {
  const a = spreadBySong(bank.questions, Challenge.makeRng(1)).map((q) => q.id);
  const b = spreadBySong(bank.questions, Challenge.makeRng(2)).map((q) => q.id);
  assert.notDeepEqual(a, b);
});

test('同一個種子，每一題送的字也一樣', () => {
  const seed = 555;
  for (let i = 0; i < 20; i++) {
    const q = bank.questions[i * 7];
    const pick = () =>
      [...pickFreebies(q, LEVELS.normal.reveal, Challenge.makeRng(Challenge.mixSeed(seed, i)))]
        .sort((x, y) => x - y);
    assert.deepEqual(pick(), pick(), `第 ${i} 題送的字不穩定`);
  }
});

test('每一題的亂數各自獨立，買提示不會害後面的題目跟別人不同步', () => {
  // 送字的種子只跟「代碼種子＋題號」有關，跟前面消耗掉多少亂數無關
  const seed = 777;
  const forIndex = (i) => Challenge.mixSeed(seed, i);
  assert.equal(forIndex(3), forIndex(3), 'mixSeed 應該是純函式');
  const seen = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(forIndex));
  assert.equal(seen.size, 8, '不同題號應該推出不同的種子');
});

test('成績碼編碼解碼可以來回，中文名字也不會壞', () => {
  const r = { code: 'ABC-123', name: '小明', score: 2340, correct: 8, asked: 10, combo: 5 };
  assert.deepEqual(Challenge.decodeResult(Challenge.encodeResult(r)), r);
});

test('壞掉的成績碼回 null，不會把排行榜弄爛', () => {
  for (const bad of ['', 'not-base64!!', Buffer.from('{}').toString('base64'), '@@@']) {
    assert.equal(Challenge.decodeResult(bad), null, `${bad} 應該解不出來`);
  }
});

test('排名依分數高低，同分再比答對題數', () => {
  const ranked = Challenge.rank([
    { name: 'a', score: 100, correct: 3 },
    { name: 'b', score: 300, correct: 5 },
    { name: 'c', score: 300, correct: 9 },
  ]);
  assert.deepEqual(ranked.map((r) => r.name), ['c', 'b', 'a']);
});

console.log('\n年代分組');
const { ERAS } = exposed;
const buckets = ERAS;

test('每首歌都有年份，才分得進年代', () => {
  const undated = bank.questions.filter((q) => typeof q.year !== 'number');
  assert.deepEqual([...new Set(undated.map((q) => q.title))], []);
});

test('每一題剛好落在一個年代，不重疊也不漏掉', () => {
  for (const q of bank.questions) {
    const hits = buckets.filter((e) => e.match(q.year)).map((e) => e.id);
    assert.equal(hits.length, 1, `${q.title}（${q.year}）落在 ${hits.length} 個年代：${hits}`);
  }
});

test('四個年代加起來就是整個題庫', () => {
  const covered = bank.questions.filter((q) => buckets.some((e) => e.match(q.year)));
  assert.equal(covered.length, bank.questions.length, '有題目不屬於任何年代');
});

test('每個年代都有歌，介面上不會出現空選項', () => {
  const empty = buckets.filter(
    (e) => !bank.questions.some((q) => e.match(q.year))
  );
  assert.deepEqual(empty.map((e) => e.label), []);
});

/* ── 部署：模擬 Wrangler 會上傳哪些檔案 ── */
console.log('\n部署（Cloudflare）');

const CF_MAX_BYTES = 25 * 1024 * 1024; // 單檔上限 25 MiB

const ignorePatterns = read('.assetsignore')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const isIgnored = (rel) => {
  const parts = rel.split('/');
  return ignorePatterns.some((p) => rel === p || parts[0] === p || rel.startsWith(`${p}/`));
};

function walk(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir === '' ? '.' : dir), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (isIgnored(rel)) continue;
    if (entry.isDirectory()) out.push(...walk(rel, rel));
    else out.push(rel);
  }
  return out;
}

const uploaded = walk('');

test('node_modules 不會被上傳（就是它害部署失敗的）', () => {
  const leaked = uploaded.filter((f) => f.startsWith('node_modules/'));
  assert.equal(leaked.length, 0, `還會上傳 ${leaked.length} 個 node_modules 檔案`);
});

test('沒有任何檔案超過 Cloudflare 的 25 MiB 上限', () => {
  const tooBig = uploaded
    .map((f) => [f, statSync(join(ROOT, f)).size])
    .filter(([, size]) => size > CF_MAX_BYTES);
  assert.deepEqual(tooBig, [], `過大：${tooBig.map(([f]) => f).join(', ')}`);
});

test('網站真正需要的檔案都還在', () => {
  for (const f of [
    'index.html',
    'assets/app.js',
    'assets/challenge.js',
    'assets/data.js',
    'assets/styles.css',
    'data/questions.js',
    'data/questions.json',
  ]) {
    assert.ok(uploaded.includes(f), `${f} 被 .assetsignore 誤殺了`);
  }
});

console.log(failures ? `\n✗ ${failures} 項失敗` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
