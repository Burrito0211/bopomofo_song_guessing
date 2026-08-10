/**
 * 即時競賽房間的狀態機 —— 純資料進出，不碰 WebSocket，方便單獨測試。
 *
 * 規則：主持人開房 → 大家加入 → 主持人按開始 → 每題只有「第一個答對的人」拿分。
 * 誰是第一個由伺服器認定，因為只有伺服器看得到所有人的送出順序。
 * 錯字容忍沿用 assets/judge.js 那份（六字以上差一個字仍算對）。
 */

export const PHASE = {
  LOBBY: 'lobby',       // 等人進來
  QUESTION: 'question', // 題目出著，等人搶答
  REVEAL: 'reveal',     // 這題結束，公布答案
  OVER: 'over',         // 整場結束
};

const BASE_POINTS = 100;
const SPEED_BONUS = 60;      // 一題內最多再拿這麼多，答越快越多
const CLOSE_PENALTY = 0.8;   // 差一個字算對，但拿八折

/** 開一間新房 */
export function createRoom({ code, rounds, hostId, now }) {
  return {
    code,
    hostId,
    rounds,
    phase: PHASE.LOBBY,
    round: 0,
    players: [],          // { id, name, score, connected, joinedAt }
    question: null,       // { id, tiles, title, artist, year, mode, prompt, answer, accept, seconds }
    askedAt: 0,
    winnerId: null,
    attempts: [],         // 這一題誰試過什麼，公布時一起顯示
    createdAt: now,
  };
}

const findPlayer = (room, id) => room.players.find((p) => p.id === id);

/** 名字重複就自動加編號，不然排行榜看不出誰是誰 */
function uniqueName(room, wanted) {
  const base = (String(wanted || '').trim() || '玩家').slice(0, 12);
  const taken = new Set(room.players.map((p) => p.name));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}${Date.now() % 1000}`;
}

/** 加入房間。已經開打之後才進來的人也能加，只是前面幾題沒分。 */
export function join(room, { id, name, now }) {
  const existing = findPlayer(room, id);
  if (existing) {
    existing.connected = true;
    return { ok: true, player: existing };
  }
  const player = {
    id,
    name: uniqueName(room, name),
    score: 0,
    connected: true,
    joinedAt: now,
  };
  room.players.push(player);
  // 房主離線又回來時要拿回主持權
  if (!room.hostId) room.hostId = id;
  return { ok: true, player };
}

export function disconnect(room, id) {
  const player = findPlayer(room, id);
  if (player) player.connected = false;
  return room;
}

/** 全部離線之後房間就可以回收了 */
export const isDeserted = (room) => room.players.every((p) => !p.connected);

/**
 * 主持人開始下一題。
 * @param {object} question 伺服器挑好的題目（含答案，答案不會送給玩家）
 */
export function startRound(room, { question, seconds, now, byId }) {
  if (byId !== room.hostId) return { ok: false, error: '只有主持人可以出題' };
  if (room.phase === PHASE.QUESTION) return { ok: false, error: '這題還沒結束' };
  if (room.round >= room.rounds) return { ok: false, error: '這場已經結束了' };
  if (!room.players.some((p) => p.connected)) return { ok: false, error: '沒有人在線上' };

  room.round += 1;
  room.phase = PHASE.QUESTION;
  room.question = { ...question, seconds };
  room.askedAt = now;
  room.winnerId = null;
  room.attempts = [];
  return { ok: true };
}

/**
 * 有人送出答案。第一個答對的人拿分，之後再答對的沒分。
 * 答錯不扣分也不會被鎖住，可以繼續猜到時間結束。
 */
export function submitAnswer(room, { id, text, now, verdict }) {
  // 有人搶到之後 phase 會馬上變成 REVEAL，所以這個檢查要排在 phase 前面，
  // 不然慢一步的人只會看到「現在不是搶答時間」，不知道是被搶走了。
  if (room.winnerId) return { ok: false, error: '已經有人搶先答對了', tooLate: true };
  if (room.phase !== PHASE.QUESTION) return { ok: false, error: '現在不是搶答時間' };
  const player = findPlayer(room, id);
  if (!player) return { ok: false, error: '你不在這個房間裡' };

  const correct = verdict === 'exact' || verdict === 'close';
  room.attempts.push({ id, name: player.name, text, correct, at: now });

  if (!correct) return { ok: true, correct: false, verdict };

  // 第一個答對的：算分並結束這一題
  const elapsed = Math.max(0, now - room.askedAt);
  const total = room.question.seconds * 1000;
  const speed = Math.max(0, 1 - elapsed / total);
  const raw = BASE_POINTS + Math.round(SPEED_BONUS * speed);
  const gained = Math.round(raw * (verdict === 'close' ? CLOSE_PENALTY : 1));

  player.score += gained;
  room.winnerId = id;
  room.phase = PHASE.REVEAL;

  return { ok: true, correct: true, verdict, gained, winner: player };
}

/** 時間到都沒人答對 */
export function timeUp(room) {
  if (room.phase !== PHASE.QUESTION) return { ok: false };
  room.phase = PHASE.REVEAL;
  room.winnerId = null;
  return { ok: true };
}

/** 公布完之後：還有題目就回到可以出題的狀態，沒有就結束 */
export function afterReveal(room) {
  if (room.round >= room.rounds) {
    room.phase = PHASE.OVER;
  } else {
    room.phase = PHASE.LOBBY;
  }
  return room;
}

export const scoreboard = (room) =>
  room.players
    .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-Hant'));

/**
 * 要送給玩家看的房間狀態。
 * 關鍵：題目在進行中時**不含答案**，不然開 devtools 就贏了。
 */
export function publicState(room, viewerId, now = Date.now()) {
  const q = room.question;
  const revealing = room.phase === PHASE.REVEAL || room.phase === PHASE.OVER;

  // 剩餘時間由伺服器算。中途才加入的人不能從零開始倒數，
  // 而且各人時鐘不一定準，不能讓瀏覽器自己推。
  const remainingMs = q && room.phase === PHASE.QUESTION
    ? Math.max(0, q.seconds * 1000 - (now - room.askedAt))
    : 0;

  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    rounds: room.rounds,
    isHost: viewerId === room.hostId,
    you: viewerId,
    players: scoreboard(room),
    question: q
      ? {
          round: room.round,
          mode: q.mode,
          tiles: q.tiles,
          title: q.mode === 'lyric' ? q.title : null,
          seconds: q.seconds,
          remainingMs,
          // 只有公布階段才給答案
          answer: revealing ? q.answer : null,
          line: revealing ? q.line : null,
          artist: revealing ? q.artist : null,
          songTitle: revealing ? q.title : null,
          year: revealing ? q.year : null,
        }
      : null,
    winner: room.winnerId
      ? scoreboard(room).find((p) => p.id === room.winnerId) ?? null
      : null,
    attempts: revealing ? room.attempts : room.attempts.map((a) => ({
      name: a.name,
      correct: false,          // 進行中不透露誰答對了（反正答對就結束了）
      at: a.at,
    })),
  };
}
