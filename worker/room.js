/**
 * 一間即時競賽房。狀態機在 room-logic.js（純函式、有測試），
 * 這個檔案只負責 WebSocket 的收送、計時、以及從題庫挑題。
 */
import '../assets/judge.js';   // 掛上 globalThis.Judge，跟前端共用同一份判定
import {
  PHASE, createRoom, join, disconnect, isDeserted,
  startRound, submitAnswer, timeUp, afterReveal, publicState,
} from './room-logic.js';

const { judge } = globalThis.Judge;

const DEFAULT_SECONDS = 30;
const REVEAL_MS = 6000;        // 公布答案停留多久

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map();  // playerId → WebSocket
    this.room = null;
    this.bank = null;
    this.deadline = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const url = new URL(request.url);
    const code = url.pathname.split('/')[3].toUpperCase();
    const rounds = Math.min(40, Math.max(5, Number(url.searchParams.get('rounds')) || 10));
    const name = url.searchParams.get('name') || '玩家';
    const playerId = crypto.randomUUID();

    if (!this.room) {
      this.room = createRoom({ code, rounds, hostId: playerId, now: Date.now() });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    join(this.room, { id: playerId, name, now: Date.now() });
    this.sockets.set(playerId, server);

    server.addEventListener('message', (event) => {
      this.onMessage(playerId, event.data).catch((err) => {
        this.send(playerId, { type: 'error', error: String(err && err.message) });
      });
    });

    const bye = () => {
      disconnect(this.room, playerId);
      this.sockets.delete(playerId);
      if (isDeserted(this.room)) {
        this.room = null;             // 沒人了就重置，房號可以再用
        this.clearTimer();
      } else {
        this.broadcastState();
      }
    };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);

    this.broadcastState();
    return new Response(null, { status: 101, webSocket: client });
  }

  async onMessage(playerId, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!this.room) return;

    if (msg.type === 'start') {
      await this.startNextRound(playerId);
      return;
    }

    if (msg.type === 'answer') {
      const q = this.room.question;
      if (!q || this.room.phase !== PHASE.QUESTION) return;

      const verdict = judge(msg.text ?? '', q.accept);
      const result = submitAnswer(this.room, {
        id: playerId,
        text: String(msg.text ?? '').slice(0, 60),
        now: Date.now(),
        verdict,
      });

      if (!result.ok) {
        this.send(playerId, { type: 'rejected', error: result.error });
        return;
      }

      // 答錯只有自己看得到，不然等於幫別人刪去法
      if (!result.correct) {
        this.send(playerId, { type: 'judged', verdict, correct: false });
        return;
      }

      this.send(playerId, { type: 'judged', verdict, correct: true, gained: result.gained });
      this.clearTimer();
      this.broadcastState();
      this.scheduleReveal();
      return;
    }
  }

  async startNextRound(playerId) {
    const bank = await this.loadBank();
    const question = bank[Math.floor(Math.random() * bank.length)];
    const seconds = Number(this.room.question?.seconds) || DEFAULT_SECONDS;

    const result = startRound(this.room, {
      question,
      seconds: seconds || DEFAULT_SECONDS,
      now: Date.now(),
      byId: playerId,
    });
    if (!result.ok) {
      this.send(playerId, { type: 'rejected', error: result.error });
      return;
    }

    this.broadcastState();
    this.armTimer(this.room.question.seconds * 1000, () => {
      timeUp(this.room);
      this.broadcastState();
      this.scheduleReveal();
    });
  }

  scheduleReveal() {
    this.armTimer(REVEAL_MS, () => {
      afterReveal(this.room);
      this.broadcastState();
    });
  }

  armTimer(ms, fn) {
    this.clearTimer();
    this.deadline = setTimeout(() => {
      this.deadline = null;
      if (this.room) fn();
    }, ms);
  }

  clearTimer() {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
  }

  /** 題庫直接跟自己的靜態資源拿，不用另外維護一份 */
  async loadBank() {
    if (this.bank) return this.bank;
    const res = await this.env.ASSETS.fetch('https://internal/data/questions.json');
    const data = await res.json();
    this.bank = data.questions;
    return this.bank;
  }

  send(playerId, payload) {
    const ws = this.sockets.get(playerId);
    if (!ws) return;
    try { ws.send(JSON.stringify(payload)); } catch { /* 已經斷了 */ }
  }

  broadcastState() {
    if (!this.room) return;
    for (const [id] of this.sockets) {
      this.send(id, { type: 'state', state: publicState(this.room, id, Date.now()) });
    }
  }
}
