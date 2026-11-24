'use strict';

/**
 * 端到端接口测试：node test/http.test.js
 * 需要服务已在 11451 运行。
 */

const BASE = process.env.BASE || 'http://127.0.0.1:11451';

let pass = 0, fail = 0;
const errs = [];

function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  errs.push(label);
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  return { status: r.status, body: j };
}

async function get(path) {
  const r = await fetch(BASE + path);
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  return { status: r.status, body: j, text: j ? null : await r.text() };
}

/** 订阅 SSE 并收集消息 */
function subscribe(token) {
  const ctrl = new AbortController();
  const msgs = [];
  const waiters = new Set();

  (async () => {
    try {
      const r = await fetch(BASE + '/api/stream?token=' + encodeURIComponent(token), {
        signal: ctrl.signal,
        headers: { Accept: 'text/event-stream' },
      });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            msgs.push(JSON.parse(line.slice(6)));
            for (const w of [...waiters]) w();
          } catch (e) { /* 忽略 */ }
        }
      }
    } catch (e) { /* abort */ }
  })();

  return {
    msgs,
    close: () => ctrl.abort(),
    waitFor(fn, timeout = 20000) {
      return new Promise((resolve) => {
        const hit = msgs.find(fn);
        if (hit) return resolve(hit);
        let done = false;
        const check = () => {
          if (done) return;
          const f = msgs.find(fn);
          if (f) finish(f);
        };
        const finish = (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(v);
        };
        const timer = setTimeout(() => finish(null), timeout);
        waiters.add(check);
      });
    },
    latest(fn) {
      const arr = msgs.filter(fn);
      return arr.length ? arr[arr.length - 1] : null;
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function testStatic() {
  const r = await fetch(BASE + '/');
  const html = await r.text();
  ok(r.status === 200, '首页应返回 200');
  ok(html.includes('局域网棋牌室'), '首页应含标题');
  ok(html.includes('net.js'), '首页应引用 net.js');

  const css = await fetch(BASE + '/css/style.css');
  ok(css.status === 200, 'CSS 应可访问');

  for (const js of ['/js/net.js', '/js/ui.js', '/js/app.js', '/js/games/ddz-view.js', '/js/games/mahjong-view.js']) {
    const rr = await fetch(BASE + js);
    ok(rr.status === 200, `${js} 应可访问`);
  }

  const info = await get('/api/info');
  ok(info.status === 200 && info.body.ok, '/api/info 正常');
  ok(Array.isArray(info.body.addresses), '/api/info 应含地址列表');
}

async function testDdzFlow() {
  // 创建房间
  const c = await post('/api/create', { game: 'ddz', name: '测试房主' });
  ok(c.status === 200 && c.body.ok, '创建斗地主房间');
  const token = c.body.token;
  const roomId = c.body.roomId;
  ok(/^[A-Z0-9]{4}$/.test(roomId), `房间号格式 ${roomId}`);

  const sub = subscribe(token);
  await sleep(400);

  // 补 2 个 AI
  let r = await post('/api/action', { token, action: { type: 'addAI' } });
  ok(r.body.ok, '加第一个 AI');
  r = await post('/api/action', { token, action: { type: 'addAI' } });
  ok(r.body.ok, '加第二个 AI');
  r = await post('/api/action', { token, action: { type: 'addAI' } });
  ok(r.body.ok === false, '第 3 个 AI 应被拒（位置满了）');

  const lobby = await sub.waitFor((m) => m.type === 'lobby' && m.players.length === 3);
  ok(!!lobby, '应收到 3 人大厅状态');
  ok(lobby && lobby.canStart === true, '3 人应可开局');

  // 开局
  r = await post('/api/action', { token, action: { type: 'start' } });
  ok(r.body.ok, '开局成功');

  const st = await sub.waitFor((m) => m.type === 'state');
  ok(!!st, '应收到游戏状态');
  ok(st && st.state.game === 'ddz', '游戏类型为 ddz');
  ok(st && st.state.hand.length === 17, `我的起手牌应为 17 张，实际 ${st && st.state.hand.length}`);
  ok(st && st.state.phase === 'bidding', '应进入叫分阶段');
  ok(st && st.state.bottom === null, '叫分阶段是否应隐藏底牌');

  // 找到一个自己叫分的时机（如果先手是 AI，可能要等）
  let bidDone = false;
  for (let i = 0; i < 40 && !bidDone; i++) {
    const s = sub.latest((m) => m.type === 'state');
    if (!s) { await sleep(250); continue; }
    if (s.state.phase === 'bidding' && s.state.bid.turn === 0) {
      const rr = await post('/api/action', { token, action: { type: 'bid', value: 3 } });
      ok(rr.body.ok, '叫 3 分');
      bidDone = true;
      break;
    }
    if (s.state.phase !== 'bidding') { bidDone = true; break; }
    await sleep(250);
  }
  ok(bidDone, '完成叫分');

  const playing = await sub.waitFor((m) => m.type === 'state' && m.state.phase === 'playing', 20000);
  ok(!!playing, '应进入出牌阶段');
  ok(playing && playing.state.landlord >= 0, '应有地主');
  ok(playing && playing.state.bottom !== null, '出牌阶段应能看到底牌');

  const mySeat = 0;
  const isLandlord = playing && playing.state.seats[mySeat].isLandlord;
  const expect = isLandlord ? 20 : 17;
  ok(playing && playing.state.hand.length === expect, `地主应 ${expect} 张，实际 ${playing && playing.state.hand.length}`);

  // 非法操作：不是自己回合出牌
  r = await post('/api/action', { token, action: { type: 'play', cards: [] } });
  ok(r.body.ok === false, '空牌应被拒');

  // 等轮到自己，出最小单张
  let playedOk = false;
  for (let i = 0; i < 200 && !playedOk; i++) {
    const s = sub.latest((m) => m.type === 'state');
    if (!s) { await sleep(200); continue; }
    if (s.state.phase === 'finished') break;
    if (s.state.turn === mySeat && s.state.phase === 'playing') {
      const hand = s.state.hand.slice().sort((a, b) => a.rank - b.rank);
      const card = hand[0];
      // 如果是领出，出单张一定合法
      const lead = !s.state.lastPlay;
      if (lead) {
        const rr = await post('/api/action', { token, action: { type: 'play', cards: [card.id] } });
        if (rr.body.ok) playedOk = true;
        else ok(false, '领出单张应成功：' + rr.body.error);
      } else {
        const rr = await post('/api/action', { token, action: { type: 'pass' } });
        if (rr.body.ok) playedOk = true;
      }
      break;
    }
    await sleep(200);
  }
  ok(playedOk, '完成一次出牌/过牌');

  sub.close();
  return { token, roomId };
}

async function testMahjongFlow() {
  const c = await post('/api/create', { game: 'mahjong', name: '麻测' });
  ok(c.status === 200 && c.body.ok, '创建麻将房间');
  const token = c.body.token;
  const roomId = c.body.roomId;

  const sub = subscribe(token);
  await sleep(400);

  // 补 2 个 AI 凑 3 人
  await post('/api/action', { token, action: { type: 'addAI' } });
  await post('/api/action', { token, action: { type: 'addAI' } });
  await sub.waitFor((m) => m.type === 'lobby' && m.players.length === 3);

  const r = await post('/api/action', { token, action: { type: 'start' } });
  ok(r.body.ok, '麻将开局');

  const st = await sub.waitFor((m) => m.type === 'state', 10000);
  ok(!!st, '麻将应收到状态');
  ok(st && st.state.game === 'mahjong', '游戏类型为 mahjong');
  ok(st && st.state.playerCount === 3, '3 人麻将');
  ok(st && st.state.wallCount === 136 - 13 * 3 - 1, `牌墙应为 ${136 - 13 * 3 - 1}，实际 ${st && st.state.wallCount}`);

  const isDealer = st && st.state.dealer === 0;
  const handLen = st && st.state.hand.length;
  ok(handLen === (isDealer ? 14 : 13), `庄 ${isDealer ? 14 : 13} 张，实际 ${handLen}`);
  ok(st && st.state.seats.length === 3, '应含 3 个座位信息');
  ok(st && st.state.seats.every((s) => Array.isArray(s.melds)), '座位应含副露数组');
  ok(st && st.state.seats.every((s) => Array.isArray(s.discards)), '座位应含弃牌数组');

  // 尝试打一张牌
  let discarded = false;
  for (let i = 0; i < 120 && !discarded; i++) {
    const s = sub.latest((m) => m.type === 'state');
    if (!s) { await sleep(200); continue; }
    if (s.state.phase === 'finished') break;
    if (s.state.turn === 0 && s.state.awaiting === 'discard' && !s.state.claim) {
      const t = s.state.hand[s.state.hand.length - 1];
      const rr = await post('/api/action', { token, action: { type: 'discard', tileId: t.id } });
      if (rr.body.ok) discarded = true;
      else ok(false, '打牌应成功：' + rr.body.error);
      break;
    }
    await sleep(200);
  }
  ok(discarded, '完成一次打牌');

  // 非法：打不存在的牌
  const bad = await post('/api/action', { token, action: { type: 'discard', tileId: 999999 } });
  ok(bad.body.ok === false, '不存在的牌应被拒');

  sub.close();
  return { token, roomId };
}

async function testJoinAndAuth() {
  const c = await post('/api/create', { game: 'ddz', name: '甲' });
  const hostToken = c.body.token;
  const roomId = c.body.roomId;

  const j = await post('/api/join', { roomId, name: '乙' });
  ok(j.status === 200 && j.body.ok, '第二人加入');
  ok(j.body.token !== hostToken, '两人 token 不同');

  const j2 = await post('/api/join', { roomId, name: '丙' });
  ok(j2.body.ok, '第三人加入');

  const j3 = await post('/api/join', { roomId, name: '丁' });
  ok(j3.body.ok === false, '第四人应被拒（斗地主 3 人）');

  const bad = await post('/api/join', { roomId: 'ZZZZ', name: 'x' });
  ok(bad.status === 404, '不存在的房间返回 404');

  const noAuth = await post('/api/action', { token: 'bad-token', action: { type: 'start' } });
  ok(noAuth.status === 401, '无效 token 返回 401');

  const info = await get('/api/room?roomId=' + roomId);
  ok(info.body.ok && info.body.players.length === 3, '房间信息应有 3 人');

  // 开局后不许再加入
  await post('/api/action', { token: hostToken, action: { type: 'start' } });
  const j4 = await post('/api/join', { roomId, name: '戊' });
  ok(j4.body.ok === false, '已开局不应能加入');

  // 清理
  await post('/api/action', { token: hostToken, action: { type: 'leave' } });
}

(async () => {
  console.log('=== 端到端接口测试 ===');

  try {
    await testStatic();
    await testDdzFlow();
    await testMahjongFlow();
    await testJoinAndAuth();
  } catch (e) {
    fail++;
    errs.push('异常：' + (e && e.stack || e));
  }

  console.log('');
  if (fail) {
    console.log(`❌ ${fail} 个失败 / ${pass + fail}`);
    for (const e of errs) console.log('  • ' + e);
    process.exit(1);
  } else {
    console.log(`✅ 全部通过：${pass} 项`);
    process.exit(0);
  }
})();
