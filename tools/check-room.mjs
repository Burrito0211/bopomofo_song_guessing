// 即時競賽房間狀態機的測試：npm run check:room
// 重點在「第一個答對的人才拿分」與「進行中不能把答案送給前端」。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join as pathJoin } from 'node:path';
import assert from 'node:assert/strict';
import {
  PHASE, createRoom, join, disconnect, isDeserted,
  startRound, submitAnswer, timeUp, afterReveal, publicState, scoreboard,
} from '../worker/room-logic.js';

const ROOT = pathJoin(dirname(fileURLToPath(import.meta.url)), '..');
const judgeHost = {};
new Function('window', readFileSync(pathJoin(ROOT, 'assets', 'judge.js'), 'utf8'))(judgeHost);
const { judge } = judgeHost.Judge;

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e.message}`); }
};

const QUESTION = {
  id: 'q1',
  mode: 'lyric',
  title: '青花瓷',
  artist: '周杰倫',
  year: 2007,
  line: '天青色等煙雨',
  tiles: [{ k: 'han', t: 'ㄊ' }],
  answer: '天青色等煙雨',
  accept: ['天青色等煙雨'],
};

/** 開一間已經有人、而且題目出著的房 */
function roomInPlay(names = ['host', 'a', 'b'], rounds = 3) {
  const room = createRoom({ code: '7K2P', rounds, hostId: 'host', now: 0 });
  for (const id of names) join(room, { id, name: id, now: 0 });
  startRound(room, { question: QUESTION, seconds: 30, now: 1000, byId: 'host' });
  return room;
}

const answer = (room, id, text, now) =>
  submitAnswer(room, { id, text, now, verdict: judge(text, room.question.accept) });

console.log('房間與加入');

test('開房的人就是主持人', () => {
  const room = createRoom({ code: '7K2P', rounds: 5, hostId: 'host', now: 0 });
  join(room, { id: 'host', name: '小明', now: 0 });
  assert.equal(publicState(room, 'host').isHost, true);
  assert.equal(room.phase, PHASE.LOBBY);
});

test('同名的人會自動加編號，排行榜才分得出誰是誰', () => {
  const room = createRoom({ code: '7K2P', rounds: 5, hostId: 'a', now: 0 });
  join(room, { id: 'a', name: '阿明', now: 0 });
  join(room, { id: 'b', name: '阿明', now: 0 });
  join(room, { id: 'c', name: '阿明', now: 0 });
  assert.deepEqual(room.players.map((p) => p.name), ['阿明', '阿明2', '阿明3']);
});

test('只有主持人能開始出題', () => {
  const room = createRoom({ code: '7K2P', rounds: 3, hostId: 'host', now: 0 });
  join(room, { id: 'host', name: 'host', now: 0 });
  join(room, { id: 'a', name: 'a', now: 0 });
  assert.equal(startRound(room, { question: QUESTION, seconds: 30, now: 1, byId: 'a' }).ok, false);
  assert.equal(startRound(room, { question: QUESTION, seconds: 30, now: 1, byId: 'host' }).ok, true);
});

test('全部離線之後房間算空了', () => {
  const room = roomInPlay();
  ['host', 'a', 'b'].forEach((id) => disconnect(room, id));
  assert.equal(isDeserted(room), true);
});

console.log('\n搶答：只有第一個答對的人拿分');

test('第一個答對的人拿分，第二個答對的沒分', () => {
  const room = roomInPlay();
  const first = answer(room, 'a', '天青色等煙雨', 3000);
  assert.equal(first.correct, true);
  assert.ok(first.gained > 0);

  const second = answer(room, 'b', '天青色等煙雨', 3500);
  assert.equal(second.ok, false);
  assert.equal(second.tooLate, true);

  const board = scoreboard(room);
  assert.equal(board.find((p) => p.id === 'a').score, first.gained);
  assert.equal(board.find((p) => p.id === 'b').score, 0);
});

test('搶到之後這題就結束，進入公布階段', () => {
  const room = roomInPlay();
  answer(room, 'a', '天青色等煙雨', 3000);
  assert.equal(room.phase, PHASE.REVEAL);
  assert.equal(room.winnerId, 'a');
});

test('答錯不扣分，也還能繼續猜', () => {
  const room = roomInPlay();
  const miss = answer(room, 'a', '完全不對', 2000);
  assert.equal(miss.correct, false);
  assert.equal(room.phase, PHASE.QUESTION, '答錯不該結束這一題');
  assert.equal(scoreboard(room).find((p) => p.id === 'a').score, 0);

  const hit = answer(room, 'a', '天青色等煙雨', 4000);
  assert.equal(hit.correct, true, '答錯之後應該還能再猜');
});

test('答得越快分數越高', () => {
  const fast = roomInPlay();
  const slow = roomInPlay();
  const quick = answer(fast, 'a', '天青色等煙雨', 1000 + 1000);
  const late = answer(slow, 'a', '天青色等煙雨', 1000 + 29000);
  assert.ok(quick.gained > late.gained, `快的 ${quick.gained} 應該多於慢的 ${late.gained}`);
});

test('沒開始搶答就送答案會被擋掉', () => {
  const room = createRoom({ code: '7K2P', rounds: 3, hostId: 'host', now: 0 });
  join(room, { id: 'host', name: 'host', now: 0 });
  const r = submitAnswer(room, { id: 'host', text: '天青色等煙雨', now: 1, verdict: 'exact' });
  assert.equal(r.ok, false);
});

test('不在房間裡的人不能送答案', () => {
  const room = roomInPlay();
  const r = submitAnswer(room, { id: '路人', text: '天青色等煙雨', now: 2000, verdict: 'exact' });
  assert.equal(r.ok, false);
});

console.log('\n錯字容忍照舊');

test('六字以上差一個字仍算對，但拿八折', () => {
  const exact = roomInPlay();
  const close = roomInPlay();
  const full = answer(exact, 'a', '天青色等煙雨', 2000);
  const typo = answer(close, 'a', '天青色等煙雲', 2000);

  assert.equal(typo.correct, true, '差一個字應該還是算對');
  assert.equal(typo.verdict, 'close');
  assert.ok(typo.gained < full.gained, '差一個字應該少拿一點');
  assert.equal(typo.gained, Math.round(full.gained * 0.8));
});

test('短答案不做模糊比對，免得亂猜也中', () => {
  const room = createRoom({ code: '7K2P', rounds: 3, hostId: 'host', now: 0 });
  join(room, { id: 'host', name: 'host', now: 0 });
  join(room, { id: 'a', name: 'a', now: 0 });
  startRound(room, {
    question: { ...QUESTION, mode: 'title', answer: '晴天', accept: ['晴天'] },
    seconds: 30, now: 1000, byId: 'host',
  });
  const r = answer(room, 'a', '晴大', 2000);
  assert.equal(r.correct, false);
});

test('同音字在即時搶答一樣算對', () => {
  const room = createRoom({ code: '7K2P', rounds: 3, hostId: 'host', now: 0 });
  join(room, { id: 'host', name: 'host', now: 0 });
  join(room, { id: 'a', name: 'a', now: 0 });
  startRound(room, {
    question: { ...QUESTION, line: '他說了所有的謊', answer: '他說了所有的謊', accept: ['他說了所有的謊'] },
    seconds: 30, now: 1000, byId: 'host',
  });
  const r = answer(room, 'a', '她說了所有的謊', 2000);
  assert.equal(r.correct, true, '伺服器端也要吃同音字容忍');
  assert.equal(r.verdict, 'exact', '同音字應該算完全正確，不是差一個字');
});

test('標點與空白不算錯', () => {
  const room = roomInPlay();
  const r = answer(room, 'a', '　天青色，等煙雨！', 2000);
  assert.equal(r.correct, true);
  assert.equal(r.verdict, 'exact');
});

console.log('\n流程與資訊外洩');

test('進行中的題目不會把答案送給前端', () => {
  const room = roomInPlay();
  const view = publicState(room, 'a');
  assert.equal(view.question.answer, null, '搶答中就把答案送出去，開 devtools 就贏了');
  assert.equal(view.question.line, null);
  assert.ok(view.question.tiles, '磚塊還是要給');
});

test('公布階段才看得到答案', () => {
  const room = roomInPlay();
  answer(room, 'a', '天青色等煙雨', 2000);
  const view = publicState(room, 'b');
  assert.equal(view.phase, PHASE.REVEAL);
  assert.equal(view.question.answer, '天青色等煙雨');
  assert.equal(view.winner.id, 'a');
});

test('猜歌詞時給歌名，猜歌名時不給', () => {
  const room = roomInPlay();
  assert.equal(publicState(room, 'a').question.title, '青花瓷');

  const titleRoom = createRoom({ code: '7K2P', rounds: 3, hostId: 'host', now: 0 });
  join(titleRoom, { id: 'host', name: 'host', now: 0 });
  startRound(titleRoom, {
    question: { ...QUESTION, mode: 'title', answer: '青花瓷' },
    seconds: 30, now: 1, byId: 'host',
  });
  assert.equal(publicState(titleRoom, 'host').question.title, null, '猜歌名不能先給歌名');
});

test('進行中不會透露別人答對了沒', () => {
  const room = roomInPlay();
  answer(room, 'a', '亂猜一通', 2000);
  const view = publicState(room, 'b');
  assert.ok(view.attempts.every((x) => x.correct === false));
  assert.equal(view.attempts[0].text, undefined, '別人打了什麼不該送出去');
});

test('剩餘時間由伺服器算，中途加入的人不會從頭倒數', () => {
  const room = roomInPlay();               // askedAt = 1000, seconds = 30
  const early = publicState(room, 'a', 1000 + 5000);
  assert.equal(early.question.remainingMs, 25000);

  const late = publicState(room, 'b', 1000 + 29000);
  assert.equal(late.question.remainingMs, 1000, '晚進來的人要接著倒數，不能重來');

  const past = publicState(room, 'b', 1000 + 999999);
  assert.equal(past.question.remainingMs, 0, '不能變成負數');
});

test('不在搶答階段就沒有倒數', () => {
  const room = roomInPlay();
  answer(room, 'a', '天青色等煙雨', 2000);
  assert.equal(publicState(room, 'a', 3000).question.remainingMs, 0);
});

test('時間到沒人答對就直接公布，沒有人加分', () => {
  const room = roomInPlay();
  timeUp(room);
  assert.equal(room.phase, PHASE.REVEAL);
  assert.equal(room.winnerId, null);
  assert.ok(scoreboard(room).every((p) => p.score === 0));
});

test('跑滿題數就結束', () => {
  const room = roomInPlay(['host', 'a'], 2);
  answer(room, 'a', '天青色等煙雨', 2000);
  afterReveal(room);
  assert.equal(room.phase, PHASE.LOBBY, '還有第二題，應該回到可以出題的狀態');

  startRound(room, { question: QUESTION, seconds: 30, now: 5000, byId: 'host' });
  answer(room, 'a', '天青色等煙雨', 6000);
  afterReveal(room);
  assert.equal(room.phase, PHASE.OVER);
  assert.equal(room.round, 2);

  const again = startRound(room, { question: QUESTION, seconds: 30, now: 9000, byId: 'host' });
  assert.equal(again.ok, false, '結束了還能出題');
});

test('同一題不能重複開始', () => {
  const room = roomInPlay();
  const again = startRound(room, { question: QUESTION, seconds: 30, now: 2000, byId: 'host' });
  assert.equal(again.ok, false);
});

test('沒有人在線上就不能開始', () => {
  const room = createRoom({ code: '7K2P', rounds: 3, hostId: 'host', now: 0 });
  join(room, { id: 'host', name: 'host', now: 0 });
  disconnect(room, 'host');
  assert.equal(
    startRound(room, { question: QUESTION, seconds: 30, now: 1, byId: 'host' }).ok,
    false
  );
});

test('排行榜依分數排序', () => {
  const room = roomInPlay(['host', 'a', 'b'], 3);
  answer(room, 'b', '天青色等煙雨', 2000);
  afterReveal(room);
  startRound(room, { question: QUESTION, seconds: 30, now: 5000, byId: 'host' });
  answer(room, 'b', '天青色等煙雨', 5500);
  assert.equal(scoreboard(room)[0].id, 'b');
  assert.equal(scoreboard(room)[0].score > 0, true);
});

console.log(failures ? `\n✗ ${failures} 項失敗` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
