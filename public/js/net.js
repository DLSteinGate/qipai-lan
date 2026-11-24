'use strict';

/** 极简网络层：POST 动作 + SSE 接收推送 */
window.Net = (function () {
  let token = null;
  let roomId = null;
  let game = null;
  let seat = -1;
  let es = null;
  let handlers = {};
  let onOpen = null;
  let onClose = null;
  let retryTimer = null;
  let closedByUs = false;

  function on(evt, fn) {
    handlers[evt] = fn;
  }

  function emit(evt, data) {
    if (handlers[evt]) handlers[evt](data);
  }

  async function post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let j = null;
    try { j = await r.json(); } catch (e) { j = { ok: false, error: '服务端返回异常' }; }
    return j;
  }

  function connect() {
    if (es) { try { es.close(); } catch (e) {} }
    closedByUs = false;
    es = new EventSource('/api/stream?token=' + encodeURIComponent(token));
    es.onopen = () => { emit('open'); if (onOpen) onOpen(); };
    es.onmessage = (e) => {
      let msg = null;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type) emit(msg.type, msg);
    };
    es.onerror = () => {
      emit('neterr');
      if (closedByUs) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (!closedByUs && token) connect();
      }, 1500);
    };
  }

  async function create(gameType, name) {
    const r = await post('/api/create', { game: gameType, name });
    if (r.ok) {
      token = r.token; roomId = r.roomId; game = r.game; seat = r.seat;
      connect();
    }
    return r;
  }

  async function join(id, name) {
    const r = await post('/api/join', { roomId: id, name });
    if (r.ok) {
      token = r.token; roomId = r.roomId; game = r.game; seat = r.seat;
      connect();
    }
    return r;
  }

  async function action(a) {
    if (!token) return { ok: false, error: '未登录' };
    return post('/api/action', { token, action: a });
  }

  function leave() {
    closedByUs = true;
    if (es) { try { es.close(); } catch (e) {} es = null; }
    if (retryTimer) clearTimeout(retryTimer);
    const t = token;
    token = null; roomId = null; game = null; seat = -1;
    if (t) {
      fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t, action: { type: 'leave' } }),
      }).catch(() => {});
    }
  }

  return {
    on, create, join, action, leave,
    get token() { return token; },
    get roomId() { return roomId; },
    get game() { return game; },
    get seat() { return seat; },
    get connected() { return !!es && es.readyState === 1; },
  };
})();
