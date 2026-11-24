'use strict';

/**
 * 局域网棋牌服务端（零依赖）
 * - 静态页 + SSE 推送 + POST 动作
 * - 服务端权威判定，客户端无法作弊
 */

const http = require('http');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const { shortId, randomInt } = require('./util');
const { DdzGame } = require('./games/ddz');
const { MahjongGame } = require('./games/mahjong');
const assets = require('./static');

const DEFAULT_PORT = 11451;
/** 端口占用时自动往后顺延，最多试这么多个 */
const MAX_PORT_TRIES = 30;
let PORT = Number(process.env.PORT || DEFAULT_PORT);
let portTries = 0;
const MAX_SEATS = { ddz: 3, mahjong: 4 };
const MIN_SEATS = { ddz: 3, mahjong: 2 };

/** @type {Map<string, Room>} */
const rooms = new Map();
/** token -> {roomId, seat} */
const sessions = new Map();

class Room {
  constructor(game, hostName) {
    this.id = shortId(4).toUpperCase();
    this.game = game;
    this.players = []; // {pid,name,isAI,token,connected,score,lastSeen}
    this.broadcastSeq = 0;
    this.log = [];
    this.state = 'lobby';
    this.instance = null;
    this.createdAt = Date.now();
    this.dealer = 0;
  }

  seatOf(pid) {
    return this.players.findIndex((p) => p.pid === pid);
  }

  scoreOf(seatIdx) {
    const p = this.players[seatIdx];
    return p ? p.score : 0;
  }

  humanCount() {
    return this.players.filter((p) => !p.isAI && p.connected).length;
  }

  capacity() {
    return MAX_SEATS[this.game];
  }

  canStart() {
    if (this.state !== 'lobby') return false;
    const total = this.players.length;
    return total >= MIN_SEATS[this.game] && total <= this.capacity();
  }

  broadcast(msg) {
    this.broadcastSeq++;
    const payload = `data: ${JSON.stringify(msg)}\n\n`;
    // state 是"某个座位视角"的私有快照，只能发给该座位，绝不能广播给所有人
    if (msg.type === 'state' && typeof msg.seat === 'number') {
      const target = this.players[msg.seat];
      if (target && target.res) {
        try { target.res.write(payload); } catch (e) { /* 忽略断线 */ }
      }
      return;
    }
    for (const p of this.players) {
      if (p.res) {
        try { p.res.write(payload); } catch (e) { /* 忽略断线 */ }
      }
    }
  }

  event(name, label, extra) {
    const ev = { type: 'event', name, label, at: Date.now(), ...(extra || {}) };
    this.log.push(ev);
    if (this.log.length > 60) this.log.shift();
    this.broadcast(ev);
  }

  pushLobby() {
    const view = {
      type: 'lobby',
      roomId: this.id,
      game: this.game,
      state: this.state,
      capacity: this.capacity(),
      minSeats: MIN_SEATS[this.game],
      canStart: this.canStart(),
      players: this.players.map((p, i) => ({
        seat: i, name: p.name, isAI: p.isAI, connected: p.connected, score: p.score,
      })),
      log: this.log.slice(-12),
    };
    this.broadcast(view);
  }

  addPlayer(name, isAI = false, token = null) {
    if (this.players.length >= this.capacity()) return null;
    const p = {
      pid: isAI ? 'ai-' + shortId(5) : 'p-' + shortId(6),
      name: name || (isAI ? aiName(this.players) : '玩家'),
      isAI,
      token: token || (isAI ? null : shortId(10)),
      connected: true,
      score: 0,
      lastSeen: Date.now(),
      res: null,
    };
    this.players.push(p);
    return p;
  }

  removePlayer(pid) {
    const i = this.seatOf(pid);
    if (i < 0) return false;
    this.players.splice(i, 1);
    return true;
  }

  startGame() {
    if (!this.canStart()) return false;
    this.state = 'playing';
    const bcast = (m) => this.broadcast(m);
    const scoreOf = (s) => this.scoreOf(s);

    if (this.game === 'ddz') {
      this.instance = new DdzGame(
        this.players.map((p) => ({ id: p.pid, name: p.name, isAI: p.isAI, pid: p.pid })),
        bcast, scoreOf,
        (result) => this.applyResultScores(result),
      );
      this.state = 'playing';
      this.instance.deal();
    } else {
      this.instance = new MahjongGame(
        this.players.map((p) => ({ id: p.pid, name: p.name, isAI: p.isAI, pid: p.pid })),
        bcast, scoreOf,
        (result) => this.applyResultScores(result),
      );
      this.state = 'playing';
      this.instance.start(this.dealer % this.players.length);
    }
    return true;
  }

  /** 每局结束时结算：保证同一局只结算一次 */
  applyResultScores(result) {
    const r = result || (this.instance && this.instance.result);
    if (!r || !r.delta) return;
    if (this._scoredResult === r) return;
    this._scoredResult = r;
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].score += r.delta[i] || 0;
    }
    // 重新推一次状态，让客户端拿到更新后的总分
    if (this.instance && this.instance.emit) this.instance.emit();
    this.pushLobby();
  }
}

function aiName(existing) {
  const pool = ['阿福', '小翠', '老王', '阿珍', '大熊', '阿明', '小花', '老李'];
  const used = new Set(existing.map((p) => p.name));
  for (const n of pool) if (!used.has(n)) return n;
  return '机器人' + randomInt(100);
}

// ---------------- HTTP ----------------

const MIME = assets.MIME;

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname;
  assets.read(rel, (err, buf) => {
    if (err) {
      if (err.code === 'FORBIDDEN') { res.writeHead(403); res.end('forbidden'); return; }
      if (pathname !== '/' && !path.extname(pathname)) {
        // 单页应用回退
        assets.read('index.html', (e2, b2) => {
          if (e2) { res.writeHead(404); res.end('not found'); }
          else { res.writeHead(200, { 'Content-Type': assets.MIME['.html'] }); res.end(b2); }
        });
        return;
      }
      res.writeHead(404); res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': assets.mimeFor(rel),
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name in nets) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push({ name, address: ni.address });
    }
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    if (p === '/api/info') {
      return sendJson(res, 200, { ok: true, addresses: lanAddresses(), port: PORT, rooms: [...rooms.values()].map((r) => ({ id: r.id, game: r.game, players: r.players.length, state: r.state })) });
    }

    // 创建房间
    if (p === '/api/create' && req.method === 'POST') {
      const body = await readBody(req);
      const game = body.game === 'mahjong' ? 'mahjong' : 'ddz';
      const room = new Room(game, body.name);
      rooms.set(room.id, room);
      const pl = room.addPlayer(body.name || '房主');
      sessions.set(pl.token, { roomId: room.id, seat: 0 });
      room.pushLobby();
      return sendJson(res, 200, { ok: true, roomId: room.id, token: pl.token, pid: pl.pid, seat: 0, game });
    }

    // 加入房间
    if (p === '/api/join' && req.method === 'POST') {
      const body = await readBody(req);
      const room = rooms.get(String(body.roomId || '').toUpperCase());
      if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在' });
      if (room.state !== 'lobby') return sendJson(res, 400, { ok: false, error: '这局已经开始了' });
      if (room.players.length >= room.capacity()) return sendJson(res, 400, { ok: false, error: '房间满了' });
      const pl = room.addPlayer(body.name || '玩家');
      sessions.set(pl.token, { roomId: room.id, seat: room.players.length - 1 });
      room.pushLobby();
      return sendJson(res, 200, { ok: true, roomId: room.id, token: pl.token, pid: pl.pid, seat: room.players.length - 1, game: room.game });
    }

    // 房间信息
    if (p === '/api/room') {
      const room = rooms.get(String(u.searchParams.get('roomId') || '').toUpperCase());
      if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在' });
      return sendJson(res, 200, {
        ok: true, roomId: room.id, game: room.game, state: room.state,
        capacity: room.capacity(), minSeats: MIN_SEATS[room.game],
        players: room.players.map((x, i) => ({ seat: i, name: x.name, isAI: x.isAI, connected: x.connected, score: x.score })),
      });
    }

    // SSE 订阅
    if (p === '/api/stream') {
      const token = u.searchParams.get('token');
      const sess = sessions.get(token);
      if (!sess) { res.writeHead(401); res.end(); return; }
      const room = rooms.get(sess.roomId);
      if (!room) { res.writeHead(404); res.end(); return; }
      const seat = room.seatOf(sess.pid || '');
      const me = room.players.find((x) => x.token === token);
      if (!me) { res.writeHead(401); res.end(); return; }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      me.res = res;
      me.connected = true;
      me.lastSeen = Date.now();

      // 推送初始状态
      room.pushLobby();
      if (room.instance) {
        const idx = room.seatOf(me.pid);
        res.write(`data: ${JSON.stringify({ type: 'state', seat: idx, state: room.instance.pub(idx) })}\n\n`);
      }

      const keep = setInterval(() => {
        try { res.write(': ping\n\n'); } catch (e) {}
        me.lastSeen = Date.now();
      }, 15000);

      req.on('close', () => {
        clearInterval(keep);
        me.res = null;
        me.connected = false;
        // 人类离开且游戏未开始就移除
        if (room.state === 'lobby') {
          room.removePlayer(me.pid);
          room.pushLobby();
          if (!room.players.filter((x) => !x.isAI).length) rooms.delete(room.id);
        } else {
          room.pushLobby();
        }
      });
      return;
    }

    // 统一动作入口
    if (p === '/api/action' && req.method === 'POST') {
      const body = await readBody(req);
      const sess = sessions.get(body.token);
      if (!sess) return sendJson(res, 401, { ok: false, error: '登录已失效，请重新进入' });
      const room = rooms.get(sess.roomId);
      if (!room) return sendJson(res, 401, { ok: false, error: '房间已关闭' });
      const me = room.players.find((x) => x.token === body.token);
      if (!me) return sendJson(res, 401, { ok: false, error: '你不在这个房间' });
      const seat = room.seatOf(me.pid);

      const act = body.action || {};

      // 大厅操作
      if (act.type === 'addAI') {
        if (room.state !== 'lobby') return sendJson(res, 400, { ok: false, error: '已经开始' });
        if (room.players.length >= room.capacity()) return sendJson(res, 400, { ok: false, error: '位置满了' });
        room.addPlayer(null, true);
        room.pushLobby();
        return sendJson(res, 200, { ok: true });
      }
      if (act.type === 'removeAI') {
        if (room.state !== 'lobby') return sendJson(res, 400, { ok: false, error: '已经开始' });
        const idx = room.players.findIndex((x) => x.isAI);
        if (idx >= 0) { room.players.splice(idx, 1); room.pushLobby(); }
        return sendJson(res, 200, { ok: true });
      }
      if (act.type === 'start') {
        if (!room.canStart()) return sendJson(res, 400, { ok: false, error: `至少要 ${MIN_SEATS[room.game]} 人（含 AI）` });
        if (!room.startGame()) return sendJson(res, 400, { ok: false, error: '开局失败' });
        return sendJson(res, 200, { ok: true });
      }
      if (act.type === 'restart' || act.type === 'nextRound') {
        // 分数已在每局结束时结算，这里只回到大厅
        this._scoredResult = null;
        this.state = 'lobby';
        this.instance = null;
        this.dealer = (this.dealer + 1) % Math.max(1, this.players.length);
        this.pushLobby();
        return sendJson(res, 200, { ok: true });
      }
      if (act.type === 'leave') {
        room.removePlayer(me.pid);
        sessions.delete(me.token);
        room.pushLobby();
        if (!room.players.length) rooms.delete(room.id);
        return sendJson(res, 200, { ok: true, left: true });
      }

      // 游戏内操作
      if (!room.instance) return sendJson(res, 400, { ok: false, error: '还没开局' });
      const g = room.instance;
      let r = { ok: false, error: '未知操作' };

      if (room.game === 'ddz') {
        if (act.type === 'bid') r = g.handleBid(seat, Number(act.value));
        else if (act.type === 'play') r = g.handlePlay(seat, act.cards || []);
        else if (act.type === 'pass') r = g.handlePass(seat);
      } else {
        if (act.type === 'discard') r = g.handleDiscard(seat, act.tileId);
        else if (act.type === 'claim') r = g.handleClaim(seat, act.claim, act.combo);
        else if (act.type === 'zimo') r = g.handleZimo(seat);
        else if (act.type === 'gang') r = g.handleSelfGang(seat, Number(act.rank));
      }

      if (!r.ok) return sendJson(res, 400, r);
      return sendJson(res, 200, { ok: true });
    }

    if (p.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'no such api' });

    return serveStatic(req, res, p);
  } catch (err) {
    console.error('[error]', err);
    return sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
  }
});

// 清理空房间 / 断线超时
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.state === 'lobby' && room.players.filter((x) => !x.isAI).length === 0) {
      rooms.delete(id);
      continue;
    }
    for (const p of room.players) {
      if (!p.isAI && !p.connected && now - p.lastSeen > 10 * 60 * 1000 && room.state === 'lobby') {
        room.removePlayer(p.pid);
      }
    }
  }
}, 60000);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // 端口被别的程序（或本程序前一次没退干净的实例）占了：往后顺延一个，别让用户看到别人的页面
    if (portTries < MAX_PORT_TRIES) {
      portTries++;
      const next = PORT + 1;
      console.log(`  [!] 端口 ${PORT} 已被占用，改用 ${next}`);
      PORT = next;
      setTimeout(() => server.listen(PORT, '0.0.0.0'), 120);
      return;
    }
    console.log('');
    console.log(`  [!] ${MAX_PORT_TRIES} 个端口都被占用了，启动失败。`);
    console.log('      先用 set PORT=20000 指定一个空闲端口，再启动。');
    console.log('');
  } else {
    console.error('  服务启动失败：' + e.message);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   局域网棋牌室  已启动                       ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  本机打开：  http://localhost:${PORT}`);
  if (addrs.length) {
    console.log('  同一 WiFi/局域网的其他电脑或手机，打开：');
    for (const a of addrs) console.log(`     http://${a.address}:${PORT}   (${a.name})`);
  } else {
    console.log('  ⚠ 没检测到局域网 IPv4 地址');
  }
  console.log('');
  console.log('  让别人连不上？检查防火墙是否放行本程序，或临时执行：');
  console.log(`     netsh advfirewall firewall add rule name="qipai-lan" dir=in action=allow protocol=TCP localport=${PORT}`);
  console.log('');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');

  if (process.env.OPEN_BROWSER === '1') {
    try {
      require('child_process').exec(`start "" "http://localhost:${PORT}"`);
    } catch (e) { /* 忽略：打不开浏览器不影响服务 */ }
  }
});
