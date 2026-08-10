/**
 * 即時競賽的前端：連上房間的 WebSocket，把伺服器送來的狀態畫出來。
 *
 * 這裡刻意什麼都不判斷——誰先答對、拿幾分，全部由伺服器決定，
 * 前端只負責顯示與送出。答案在搶答期間根本不會傳到瀏覽器。
 */
(function (global) {
'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  ws: null,
  room: null,
  ticker: null,
  tickerRound: null,
  answered: false,
  composing: false,
};

/* ─────────── 連線 ─────────── */

function wsUrl(code, name, rounds) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ name, rounds: String(rounds) });
  return `${proto}//${location.host}/api/room/${encodeURIComponent(code)}/ws?${params}`;
}

function connect(code, name, rounds) {
  disconnect();
  setStatus('連線中…');

  let ws;
  try {
    ws = new WebSocket(wsUrl(code, name, rounds));
  } catch (err) {
    setStatus(`連不上：${err.message}`);
    return;
  }
  state.ws = ws;

  ws.addEventListener('open', () => setStatus(''));
  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    onServerMessage(msg);
  });
  ws.addEventListener('close', () => {
    stopTicker();
    setStatus('連線中斷了。重新整理或再開一次房間。');
  });
  ws.addEventListener('error', () => {
    setStatus('連線出錯。即時競賽需要部署 Worker，見 README。');
  });
}

function disconnect() {
  stopTicker();
  if (state.ws) {
    try { state.ws.close(); } catch { /* 已經關了 */ }
  }
  state.ws = null;
}

const send = (payload) => {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(payload));
};

function setStatus(text) {
  $('#live-status').textContent = text;
  $('#live-status').hidden = !text;
}

/* ─────────── 收訊息 ─────────── */

function onServerMessage(msg) {
  if (msg.type === 'state') {
    const before = state.room;
    state.room = msg.state;
    // 換新題目就把「我答過了」清掉
    if (!before || before.round !== msg.state.round || before.phase !== msg.state.phase) {
      if (msg.state.phase === 'question') state.answered = false;
    }
    render();
    return;
  }

  if (msg.type === 'judged') {
    if (msg.correct) {
      showJudged(`✅ 搶到了！＋${msg.gained} 分`, 'good');
    } else {
      showJudged('❌ 不對，再試一次', 'bad');
      state.answered = false;
      $('#live-answer').disabled = false;
      $('#live-answer').focus();
    }
    return;
  }

  if (msg.type === 'rejected') {
    showJudged(msg.error, 'bad');
    state.answered = true;
    $('#live-answer').disabled = true;
    return;
  }

  if (msg.type === 'error') setStatus(msg.error);
}

function showJudged(text, kind) {
  const el = $('#live-judged');
  el.textContent = text;
  el.className = `live-judged ${kind}`;
  el.hidden = false;
}

/* ─────────── 畫面 ─────────── */

function render() {
  const room = state.room;
  if (!room) return;

  showScreen('screen-live');
  $('#live-code').textContent = room.code;
  $('#live-round').textContent = room.round ? `第 ${room.round} / ${room.rounds} 題` : '尚未開始';

  renderPlayers(room);

  const playing = room.phase === 'question';
  const revealing = room.phase === 'reveal' || room.phase === 'over';

  $('#live-waiting').hidden = room.phase !== 'lobby';
  $('#live-question').hidden = !(playing || revealing);
  $('#live-over').hidden = room.phase !== 'over';

  // 只有主持人看得到開始鍵，而且只在可以出題的時候
  const canStart = room.isHost && (room.phase === 'lobby') && room.round < room.rounds;
  $('#btn-live-start').hidden = !canStart;
  $('#btn-live-start').textContent = room.round === 0 ? '開始比賽' : '下一題';

  $('#live-host-hint').hidden = room.isHost || room.phase !== 'lobby';

  if (room.question) renderQuestion(room, playing, revealing);
  if (playing) startTicker(room); else stopTicker();
}

function renderPlayers(room) {
  const list = $('#live-players');
  list.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    li.className = 'live-player';
    if (!p.connected) li.classList.add('is-off');
    if (room.winner && room.winner.id === p.id) li.classList.add('is-winner');

    const name = document.createElement('span');
    name.className = 'live-player-name';
    name.textContent = p.id === room.you ? `${p.name}（你）` : p.name;

    const score = document.createElement('span');
    score.className = 'live-player-score';
    score.textContent = p.score;

    li.append(name, score);
    list.appendChild(li);
  }
}

function renderQuestion(room, playing, revealing) {
  const q = room.question;

  $('#live-prompt').textContent =
    q.mode === 'title' ? '這句歌詞出自哪首歌？' : `《${q.title}》的這句歌詞是什麼？`;

  const row = $('#live-tiles');
  row.innerHTML = '';
  for (const tile of q.tiles) {
    const el = document.createElement('span');
    el.className = 'tile';
    if (tile.k === 'space') el.classList.add('is-space');
    else if (tile.k === 'latin') { el.classList.add('is-latin'); el.textContent = tile.t; }
    else if (tile.k === 'han') el.textContent = tile.t;
    else { el.classList.add('is-punct'); el.textContent = tile.t ?? ''; }
    row.appendChild(el);
  }

  $('#live-answer-form').hidden = !playing;
  $('#live-answer').disabled = !playing || state.answered;
  if (playing && !state.answered) $('#live-answer').focus();

  const reveal = $('#live-reveal');
  reveal.hidden = !revealing;
  if (revealing) {
    $('#live-answer-text').textContent =
      q.mode === 'title' ? `《${q.answer}》` : q.answer;
    $('#live-song').textContent = q.artist
      ? `${q.artist}《${q.songTitle}》${q.year ? `（${q.year}）` : ''}`
      : '';
    $('#live-winner').textContent = room.winner
      ? `🏆 ${room.winner.name} 搶到這題`
      : '⏰ 沒有人答對';
  }

  if (!playing) {
    $('#live-judged').hidden = true;
  }
}

/* ─────────── 倒數 ─────────── */

function startTicker(room) {
  const q = room.question;
  const total = q.seconds * 1000;
  // 伺服器說還剩多久就剩多久：中途加入的人不會從頭倒數，
  // 各人時鐘不準也不影響。本機只負責把這段時間畫完。
  const startedAt = Date.now();
  const remaining = q.remainingMs;

  // 同一題重複收到狀態時不要重新開始跑，不然進度條會一直跳回去
  if (state.ticker && state.tickerRound === room.round) return;
  stopTicker();
  state.tickerRound = room.round;

  const fill = $('#live-timer-fill');
  state.ticker = setInterval(() => {
    const left = Math.max(0, remaining - (Date.now() - startedAt));
    const ratio = total ? left / total : 0;
    fill.style.transform = `scaleX(${ratio})`;
    fill.classList.toggle('is-low', ratio <= 0.25);
    if (left <= 0) stopTicker();
  }, 100);
}

function stopTicker() {
  if (state.ticker) clearInterval(state.ticker);
  state.ticker = null;
  state.tickerRound = null;
}

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) {
    el.classList.toggle('is-active', el.id === id);
  }
}

/* ─────────── 綁事件 ─────────── */

function bind() {
  const nameOf = () => ($('#live-name').value || '').trim().slice(0, 12) || '玩家';

  $('#btn-live-host').addEventListener('click', () => {
    const rounds = Number(document.querySelector('input[name="live-rounds"]:checked').value);
    const code = randomRoomCode();
    connect(code, nameOf(), rounds);
  });

  $('#btn-live-join').addEventListener('click', () => {
    const code = ($('#live-code-input').value || '').trim().toUpperCase();
    if (!/^[0-9A-Z]{4}$/.test(code)) {
      setStatus('房號是 4 個字，再確認一次');
      return;
    }
    connect(code, nameOf(), 10);
  });

  $('#btn-live-start').addEventListener('click', () => send({ type: 'start' }));

  $('#live-answer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.composing || state.answered) return;
    const text = $('#live-answer').value.trim();
    if (!text) return;
    state.answered = true;
    $('#live-answer').disabled = true;
    $('#live-answer').value = '';
    send({ type: 'answer', text });
  });

  const input = $('#live-answer');
  input.addEventListener('compositionstart', () => { state.composing = true; });
  input.addEventListener('compositionend', () => { state.composing = false; });

  $('#btn-live-leave').addEventListener('click', () => {
    disconnect();
    state.room = null;
    showScreen('screen-start');
  });
}

/** 房號用跟比賽代碼一樣的字母表，避免 I L O U */
function randomRoomCode() {
  const alphabet = global.Challenge ? global.Challenge.ALPHABET : '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

global.Live = { bind, connect, disconnect, randomRoomCode, _state: state };

})(typeof window !== 'undefined' ? window : globalThis);
