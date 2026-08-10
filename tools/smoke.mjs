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
    querySelector: (sel) => stub(`${id}>${sel}`),
    addEventListener: (type, fn) => (el._handlers ??= {})[type] = fn,
    focus: () => {},
  };
  Object.defineProperty(el, 'className', {
    get: () => [...el._classes].join(' '),
    set: (v) => {
      el._classes.clear();
      for (const c of String(v).split(/s+/).filter(Boolean)) el._classes.add(c);
    },
  });
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set: (v) => {
      html = v;
      if (v === '') el.children.length = 0;
    },
  });
  return el;
}

const els = new Map();
const stub = (id) => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};
const el = stub;

const checked = { mode: 'mixed', level: 'normal', 'vs-rounds': '10', lang: 'zh' };
// 年代改成複選，用陣列表示目前勾了哪幾個
let checkedEras = ['classic', 'y2000s', 'y2010s', 'y2020s'];

const document = {
  documentElement: makeEl('html'),
  querySelector(sel) {
    if (sel.startsWith('#')) return el(sel.slice(1));
    const m = sel.match(/input\[name="([\w-]+)"\]:checked/);
    if (m) return { value: checked[m[1]] };
    return stub(`sel:${sel}`);
  },
  querySelectorAll(sel) {
    if (sel === 'input[name="lang"]') return [{ value: 'zh', addEventListener() {} }];
    if (sel === '.screen') {
      return ['screen-start', 'screen-game', 'screen-over'].map(el);
    }
    if (sel === 'input[name="era"]:checked') {
      return checkedEras.map((value) => ({ value }));
    }
    return [];
  },
  createElement: () => makeEl(),
  addEventListener: (t, fn) => (document._handlers ??= {})[t] = fn,
};

const challengeHost = { btoa, atob, crypto };
new Function('window', read('assets/challenge.js'))(challengeHost);
const Challenge = challengeHost.Challenge;

const judgeHost = {};
new Function('window', read('assets/judge.js'))(judgeHost);

const store = new Map();
const window = {
  Judge: judgeHost.Judge,
  GameData: {
    loadQuestions: async (lang = 'zh') => {
      const raw = JSON.parse(
        read(lang === 'ja' ? 'data/questions.ja.json' : 'data/questions.json')
      );
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

const location = { href: 'https://example.com/', search: '', hash: '' };
const navigator = { clipboard: { writeText: async () => {} } };

const app = new Function(
  'document', 'window', 'localStorage', 'setInterval', 'clearInterval', 'performance', 'alert',
  'Challenge', 'location', 'navigator', 'setTimeout', 'URLSearchParams',
  `${src}\nreturn { main, startGame, beginRun, startChallenge, nextQuestion, resolveQuestion, proceed, useHint, skipQuestion, updateBankSummary, renderVsResult, switchLanguage, state, judge, normalize };`
)(
  document, window, localStorage, setInterval, clearInterval, performance, () => {},
  Challenge, location, navigator, (fn) => fn, URLSearchParams
);

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e.message}`); }
};

const testAsync = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
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

test('年代按鈕上會標出各年代有幾首歌', () => {
  const count = (era) =>
    el(`sel:.chip[data-era="${era}"]`).querySelector('.chip-count').textContent;
  for (const era of ['classic', 'y2000s', 'y2010s', 'y2020s']) {
    assert.match(count(era), /^\d+首$/, `${era} 沒標上數量`);
    assert.notEqual(count(era), '0首', `${era} 不該是 0 首`);
  }
});

test('題庫那格會跟著勾選即時更新', () => {
  const shown = () => el('bank-size').textContent;
  checkedEras = ['y2020s'];
  app.updateBankSummary();
  const only2020s = shown();
  assert.match(only2020s, /^\d+ 首 · \d+ 題$/, `格式不對：${only2020s}`);

  checkedEras = ['classic', 'y2000s', 'y2010s', 'y2020s'];
  app.updateBankSummary();
  assert.notEqual(shown(), only2020s, '全選跟只選 2020 顯示一樣，沒有更新');

  checkedEras = [];
  app.updateBankSummary();
  assert.equal(shown(), '未選年代');

  checkedEras = ['classic', 'y2000s', 'y2010s', 'y2020s'];
  app.updateBankSummary();
});

test('只勾一個年代就只會出那個年代的歌', () => {
  checkedEras = ['y2020s'];
  app.startGame();
  assert.ok(app.state.bank.length > 0, '2020 年代沒題目');
  assert.deepEqual(
    app.state.bank.filter((q) => q.year < 2020).map((q) => q.title), [], '混進了別的年代'
  );

  checkedEras = ['classic'];
  app.startGame();
  assert.ok(app.state.bank.every((q) => q.year <= 1999), '經典組混進了 2000 年以後的歌');

  checkedEras = ['classic', 'y2000s', 'y2010s', 'y2020s'];
  app.startGame();
});

test('複選會拿到兩個年代的聯集，而且不多不少', () => {
  checkedEras = ['classic', 'y2020s'];
  app.startGame();
  const picked = app.state.bank;
  assert.ok(picked.length > 0, '沒題目');
  assert.ok(
    picked.every((q) => q.year <= 1999 || q.year >= 2020),
    '複選混進了沒勾的年代'
  );
  assert.ok(picked.some((q) => q.year <= 1999), '缺了經典那組');
  assert.ok(picked.some((q) => q.year >= 2020), '缺了 2020 那組');

  // 聯集的題數應該等於各自單獨選時的題數相加
  checkedEras = ['classic'];
  app.startGame();
  const a = app.state.bank.length;
  checkedEras = ['y2020s'];
  app.startGame();
  const b = app.state.bank.length;
  assert.equal(picked.length, a + b, `聯集 ${picked.length} 不等於 ${a}+${b}`);

  checkedEras = ['classic', 'y2000s', 'y2010s', 'y2020s'];
  app.startGame();
});

test('一個年代都沒勾就不開始', () => {
  checkedEras = [];
  const before = app.state.bank.length;
  app.startGame();
  assert.equal(app.state.bank.length, before, '沒勾年代卻還是換了題庫');
  checkedEras = ['classic', 'y2000s', 'y2010s', 'y2020s'];
  app.startGame();
});

test('年代加題型可以疊著用', () => {
  checkedEras = ['y2010s'];
  checked.mode = 'title';
  app.startGame();
  assert.ok(app.state.bank.length > 0, '沒題目');
  assert.ok(
    app.state.bank.every((q) => q.mode === 'title' && q.year >= 2010 && q.year <= 2019),
    '篩選沒同時吃到題型與年代'
  );
  checkedEras = ['classic', 'y2000s', 'y2010s', 'y2020s'];
  checked.mode = 'mixed';
  app.startGame();
});

test('猜歌詞時歌名是連結，點了會開新分頁去 YouTube', () => {
  checked.mode = 'lyric';
  app.startGame();
  const link = el('q-prompt').children.find((c) => c.href);
  assert.ok(link, 'q-prompt 裡沒有連結');
  assert.match(link.href, /^https:\/\/www\.youtube\.com\//, `網址怪怪的：${link.href}`);
  assert.equal(link.target, '_blank', '沒開新分頁的話一點就把這局玩掉了');
  assert.match(link.rel ?? '', /noopener/, '開新分頁一定要加 noopener');
  assert.ok(
    link.textContent.includes(app.state.current.title),
    `連結文字應該是歌名，實際是 ${link.textContent}`
  );
  checked.mode = 'mixed';
  app.startGame();
});

test('猜歌名時不放連結，不然等於直接把答案送出去', () => {
  checked.mode = 'title';
  app.startGame();
  const links = el('q-prompt').children.filter((c) => c.href);
  assert.deepEqual(links, [], '猜歌名的題目不該出現歌名連結');
  checked.mode = 'mixed';
  app.startGame();
});

test('沒填 youtube 欄位就退成搜尋，歌名有英文也不會壞掉', () => {
  checked.mode = 'lyric';
  app.startGame();
  for (let i = 0; i < 400; i++) {
    const link = el('q-prompt').children.find((c) => c.href);
    const q = app.state.current;
    const expected = q.youtube
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(q.youtube)}`
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q.artist} ${q.title}`)}`;
    assert.equal(link.href, expected, `${q.title} 的連結不對`);
    assert.ok(!/[ 《》]/.test(link.href), `網址沒編碼乾淨：${link.href}`);
    app.nextQuestion();
  }
  checked.mode = 'mixed';
  app.startGame();
});

/* ── 多人競賽 ── */

const allEras = ['classic', 'y2000s', 'y2010s', 'y2020s'];
const makeCode = (over = {}) =>
  Challenge.decodeChallenge(
    Challenge.encodeChallenge({
      seed: 813, mode: 'mixed', level: 'normal', eras: allEras, rounds: 5, ...over,
    })
  );

/** 照著代碼跑完一整場，回傳每一題的「題目 id ＋ 送了哪幾個字」 */
function playChallenge(settings, { useHintOnFirst = false } = {}) {
  app.startChallenge(settings);
  const seen = [];
  for (let i = 0; i < settings.rounds; i++) {
    seen.push(`${app.state.current.id}|${[...app.state.given].sort((a, b) => a - b).join(',')}`);
    if (useHintOnFirst && i === 0) { app.useHint(); app.useHint(); }
    app.resolveQuestion('correct', 'exact');
    app.proceed();
  }
  return seen;
}

test('同一組代碼，兩個人拿到的題目與送字完全一樣', () => {
  const settings = makeCode();
  const playerA = playChallenge(settings);
  const playerB = playChallenge(settings);
  assert.deepEqual(playerB, playerA, '同一組代碼卻抽到不一樣的題目，比賽就不公平了');
  assert.equal(playerA.length, 5);
});

test('有人買提示也不會害後面的題目跟別人不同步', () => {
  const settings = makeCode();
  const noHint = playChallenge(settings);
  const withHint = playChallenge(settings, { useHintOnFirst: true });
  assert.deepEqual(withHint, noHint, '買了提示之後題目就跟別人不一樣了');
});

test('換一組代碼就換一份考卷', () => {
  const a = playChallenge(makeCode({ seed: 111 }));
  const b = playChallenge(makeCode({ seed: 222 }));
  assert.notDeepEqual(b, a);
});

test('競賽是固定題數，答錯不扣愛心也不會提早結束', () => {
  const settings = makeCode({ rounds: 10 });
  app.startChallenge(settings);
  for (let i = 0; i < 9; i++) {
    app.resolveQuestion('wrong');
    assert.equal(app.state.lives, 3, `第 ${i + 1} 題被扣愛心了`);
    app.proceed();
    assert.equal(
      el('screen-over')._classes.has('is-active'), false,
      `第 ${i + 1} 題就提早結束了`
    );
  }
  app.resolveQuestion('wrong');
  app.proceed();
  assert.equal(app.state.asked, 10);
  assert.equal(el('screen-over')._classes.has('is-active'), true, '第 10 題後沒有進結算');
});

test('4 碼代碼就能開一場比賽', () => {
  const code = Challenge.encodeChallenge({
    seed: 500, mode: 'mixed', level: 'normal', eras: allEras, rounds: 5,
  });
  assert.equal(code.length, 4);
  assert.equal(app.startChallenge(Challenge.decodeChallenge(code)), true);
  assert.equal(app.state.challenge.code, code);
  assert.equal(app.state.challenge.rounds, 5);
});

test('競賽結束會產生成績碼，解回來的內容跟實際成績相符', () => {
  const settings = makeCode({ rounds: 5 });
  app.startChallenge(settings);
  for (let i = 0; i < 5; i++) { app.resolveQuestion('correct', 'exact'); app.proceed(); }

  const decoded = Challenge.decodeResult(el('vs-my-result').textContent);
  assert.ok(decoded, '沒有產生成績碼');
  assert.equal(decoded.code, settings.code);
  assert.equal(decoded.score, app.state.score);
  assert.equal(decoded.correct, 5);
  assert.equal(decoded.asked, 5);
  assert.equal(el('vs-result').hidden, false, '競賽結算區塊沒顯示');
});

test('一般模式不會跑出競賽的排行榜區塊', () => {
  app.startGame();
  app.state.lives = 1;
  app.resolveQuestion('wrong');
  app.proceed();
  assert.equal(el('vs-result').hidden, true, '單人模式不該出現競賽區塊');
});

test('競賽成績不會汙染單人模式的最高分紀錄', () => {
  store.delete('bpmf-lyrics:v1');
  const settings = makeCode({ rounds: 5 });
  app.startChallenge(settings);
  for (let i = 0; i < 5; i++) { app.resolveQuestion('correct', 'exact'); app.proceed(); }
  const best = JSON.parse(store.get('bpmf-lyrics:v1') ?? '{"score":0}');
  assert.equal(best.score ?? 0, 0, '競賽分數被寫進單人最高分了');
});

/* ── 送出後對答案 ── */

/** 模擬玩家在輸入框打字並送出 */
function submitAnswer(text) {
  el('answer-input').value = text;
  el('answer-form')._handlers.submit({ preventDefault() {} });
}

test('答錯時會把你打的跟正解並排出來', () => {
  checked.mode = 'lyric';
  app.startGame();
  const answer = app.state.current.answer;

  submitAnswer('這一定不是答案啦');
  assert.equal(el('fb-check').hidden, false, '沒有顯示對答案的區塊');
  assert.equal(
    el('fb-check-yours').children.map((c) => c.textContent).join(''),
    '這一定不是答案啦'
  );
  // 比對用的是正規化後的字串，標點與空白不算錯
  assert.equal(
    el('fb-check-answer').children.map((c) => c.textContent).join(''),
    app.normalize(answer)
  );
  app.proceed();
});

test('完全答對就不用囉嗦，不顯示對答案', () => {
  checked.mode = 'lyric';
  app.startGame();
  submitAnswer(app.state.current.answer);
  assert.equal(el('fb-check').hidden, true, '答對了還跳出對答案');
  app.proceed();
});

test('打錯的字會被標出來，對的字不會', () => {
  checked.mode = 'lyric';
  app.startGame();
  // 找一句夠長的，然後把最後一個字改掉
  for (let i = 0; i < 50 && app.state.current.answer.length < 6; i++) app.nextQuestion();
  const answer = app.state.current.answer;
  const typo = answer.slice(0, -1) + '嗎';

  submitAnswer(typo);
  const yours = el('fb-check-yours').children;
  const bad = yours.filter((c) => c._classes.has('ch-bad'));
  assert.equal(bad.length, 1, `應該只標一個字，實際標了 ${bad.length} 個`);
  assert.equal(bad[0].textContent, '嗎');
  assert.ok(
    el('fb-check-note').textContent.length > 0,
    '應該有一句說明差幾個字'
  );
  app.proceed();
  checked.mode = 'mixed';
  app.startGame();
});

test('超時沒送出就不會有對答案（你根本沒打）', () => {
  app.startGame();
  app.resolveQuestion('timeout');
  assert.equal(el('fb-check').hidden, true);
  app.proceed();
});

test('上一題打的東西不會殘留到下一題', () => {
  checked.mode = 'lyric';
  app.startGame();
  submitAnswer('亂打一通');
  assert.equal(el('fb-check').hidden, false);
  app.proceed();
  app.resolveQuestion('timeout');
  assert.equal(el('fb-check').hidden, true, '上一題的答案殘留到這一題了');
  app.proceed();
  checked.mode = 'mixed';
  app.startGame();
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

/* ── 換語言 ── */

await testAsync('切換語言會把整份題庫換掉', async () => {
  checked.lang = 'zh';
  await app.switchLanguage('zh');
  const zh = app.state.allQuestions;
  assert.ok(zh.length > 0, '中文題庫是空的');
  assert.ok(zh.every((q) => q.lang !== 'ja'), '中文題庫混進日文題');

  checked.lang = 'ja';
  await app.switchLanguage('ja');
  const ja = app.state.allQuestions;
  assert.ok(ja.length > 0, '日文題庫是空的');
  assert.ok(ja.every((q) => q.lang === 'ja'), '切成日文之後拿到的還是中文題');
  assert.notEqual(ja.length, zh.length, '兩份題庫題數一樣，八成根本沒換');

  checked.lang = 'zh';
  await app.switchLanguage('zh');
  assert.ok(app.state.allQuestions.every((q) => q.lang !== 'ja'), '切不回中文');
});

await testAsync('日文題目真的用詞磚，而且開得起來', async () => {
  checked.lang = 'ja';
  await app.switchLanguage('ja');
  app.startGame();

  const q = app.state.current;
  assert.equal(q.lang, 'ja');
  const words = q.tiles.filter((t) => t.k === 'word');
  assert.ok(words.length > 0, '日文題應該是詞磚');
  assert.ok(words.every((t) => t.w), '詞磚要帶原本的詞');

  // 送字與提示都要照「詞」來算，不能還在數漢字
  assert.ok(app.state.given.size < words.length, '不能整句送完');
  assert.ok(el('q-tiles').children.length > 0, '磚塊沒畫出來');

  checked.lang = 'zh';
  await app.switchLanguage('zh');
  app.startGame();
});

console.log(failures ? `\n✗ ${failures} 項失敗` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
