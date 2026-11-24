'use strict';

const { shuffle, randomInt } = require('../util');
const M = require('./mahjong-rules');

const PHASE = {
  WAIT: 'waiting',
  PLAY: 'playing',
  DONE: 'finished',
};

const CLAIM_PRIORITY = { hu: 3, gang: 2, peng: 1, chi: 0 };
const CLAIM_WINDOW_MS = 15000;

class MahjongGame {
  /**
   * @param {Array<{id,name,isAI,pid}>} players 2~4 人
   * @param {(msg:object)=>void} broadcast
   * @param {(seat:number)=>number} scoreOf
   * @param {(result:object)=>void} [onFinish]
   */
  constructor(players, broadcast, scoreOf, onFinish) {
    this.players = players;
    this.broadcast = broadcast;
    this.scoreOf = scoreOf || (() => 0);
    this.onFinish = onFinish || null;
    this.n = players.length;
    this.seats = players.map((p) => ({
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      pid: p.pid,
      connected: true,
    }));
    this.phase = PHASE.WAIT;
    this.hands = this.seats.map(() => []);
    this.melds = this.seats.map(() => []);
    this.discards = this.seats.map(() => []);
    this.bonus = this.seats.map(() => 0);
    this.wall = [];
    this.dealer = 0;
    this.turn = 0;
    this.awaiting = 'discard'; // 'discard' | 'draw'
    this.lastDiscard = null;
    this.claim = null;
    this.claimTimer = null;
    this.result = null;
    this.gangCount = this.seats.map(() => 0);
    this.lastDrawn = null;
  }

  nextOf(seat) {
    return (seat + 1) % this.n;
  }

  prevOf(seat) {
    return (seat + this.n - 1) % this.n;
  }

  // ---------- 开局 ----------
  start(dealer = 0) {
    this.dealer = dealer % this.n;
    this.hands = this.seats.map(() => []);
    this.melds = this.seats.map(() => []);
    this.discards = this.seats.map(() => []);
    this.bonus = this.seats.map(() => 0);
    this.gangCount = this.seats.map(() => 0);
    this.wall = shuffle(M.newWall());
    this.result = null;
    this.claim = null;
    if (this.claimTimer) { clearTimeout(this.claimTimer); this.claimTimer = null; }

    for (let round = 0; round < 13; round++) {
      for (let i = 0; i < this.n; i++) {
        this.hands[(this.dealer + i) % this.n].push(this.wall.pop());
      }
    }
    this.hands[this.dealer].push(this.wall.pop());
    for (const h of this.hands) h.sort((a, b) => a.t - b.t);

    this.phase = PHASE.PLAY;
    this.turn = this.dealer;
    this.awaiting = 'discard';
    this.lastDiscard = null;
    this.lastDrawn = null;
    this.broadcast({ type: 'event', name: 'start', label: `${this.seats[this.dealer].name} 坐庄，开局` });
    this.emit();
    this.aiTick();
    return this;
  }

  // ---------- 查询 ----------
  countsOf(seat) {
    return M.countsOf(this.hands[seat]);
  }

  canHuWith(seat, tile) {
    const c = this.countsOf(seat);
    c[tile.t]++;
    return M.checkWin(c, this.melds[seat].length).win;
  }

  /** 别人打出 tile 时，seat 能做什么 */
  offerClaims(seat, from, tile) {
    if (seat === from) return null;
    const out = [];
    const c = this.countsOf(seat);

    if (this.canHuWith(seat, tile)) out.push({ type: 'hu' });
    if (c[tile.t] >= 3) out.push({ type: 'gang' });
    if (c[tile.t] >= 2) out.push({ type: 'peng' });

    // 只能吃上家
    if (from === this.prevOf(seat) && !M.HONORS(tile.t)) {
      const lo = M.LOCAL(tile.t);
      const combos = [];
      if (lo >= 2 && c[tile.t - 2] >= 1 && c[tile.t - 1] >= 1) combos.push([tile.t - 2, tile.t - 1]);
      if (lo >= 1 && lo <= 7 && c[tile.t - 1] >= 1 && c[tile.t + 1] >= 1) combos.push([tile.t - 1, tile.t + 1]);
      if (lo <= 6 && c[tile.t + 1] >= 1 && c[tile.t + 2] >= 1) combos.push([tile.t + 1, tile.t + 2]);
      if (combos.length) out.push({ type: 'chi', combos });
    }
    return out.length ? out : null;
  }

  // ---------- 打牌 ----------
  handleDiscard(seat, tileId) {
    if (this.phase !== PHASE.PLAY) return this.fail('现在不能打牌');
    if (this.claim) return this.fail('等其他人响应');
    if (this.turn !== seat || this.awaiting !== 'discard') return this.fail('还没轮到你');

    const idx = this.hands[seat].findIndex((t) => t.id === tileId);
    if (idx < 0) return this.fail('手里没有这张牌');

    const tile = this.hands[seat].splice(idx, 1)[0];
    this.discards[seat].push(tile);
    this.lastDiscard = { seat, tile };
    this.lastDrawn = null;

    this.broadcast({
      type: 'event', name: 'discard', seat, tile,
      label: `${this.seats[seat].name} 打出 ${M.tileName(tile.t)}`,
    });

    const responses = {};
    let anyPending = false;

    for (let i = 1; i < this.n; i++) {
      const s = (seat + i) % this.n;
      const opts = this.offerClaims(s, seat, tile);
      if (!opts) continue;
      if (this.seats[s].isAI) {
        responses[s] = this.aiClaim(s, opts, tile, seat);
      } else {
        responses[s] = { pending: true, options: opts };
        anyPending = true;
      }
    }

    this.claim = { tile, from: seat, responses, robGang: false };

    if (anyPending) {
      if (this.claimTimer) clearTimeout(this.claimTimer);
      this.claimTimer = setTimeout(() => {
        if (this.claim) this.resolveClaims();
      }, CLAIM_WINDOW_MS);
      this.emit();
    } else {
      this.resolveClaims();
    }
    return { ok: true };
  }

  /** 玩家对打出的牌 / 被抢杠的牌作响应 */
  handleClaim(seat, action, extra) {
    if (!this.claim) return this.fail('现在没有可响应的牌');
    const r = this.claim.responses[seat];
    if (!r || !r.pending) return this.fail('你没有可选操作');

    if (action === 'pass') {
      this.claim.responses[seat] = { pending: false, action: 'pass' };
    } else if (action === 'hu') {
      if (!r.options.some((o) => o.type === 'hu')) return this.fail('不能胡这张牌');
      this.claim.responses[seat] = { pending: false, action: 'hu' };
    } else if (action === 'peng') {
      if (!r.options.some((o) => o.type === 'peng')) return this.fail('不能碰');
      this.claim.responses[seat] = { pending: false, action: 'peng' };
    } else if (action === 'gang') {
      if (!r.options.some((o) => o.type === 'gang')) return this.fail('不能杠');
      this.claim.responses[seat] = { pending: false, action: 'gang' };
    } else if (action === 'chi') {
      const opt = r.options.find((o) => o.type === 'chi');
      if (!opt) return this.fail('不能吃');
      const combo = extra;
      if (!combo || !opt.combos.some((c) => c[0] === combo[0] && c[1] === combo[1])) {
        return this.fail('吃牌组合不合法');
      }
      this.claim.responses[seat] = { pending: false, action: 'chi', combo };
    } else {
      return this.fail('未知操作');
    }

    const stillPending = Object.values(this.claim.responses).some((x) => x && x.pending);
    if (!stillPending) this.resolveClaims();
    else this.emit();
    return { ok: true };
  }

  resolveClaims() {
    if (!this.claim) return;
    if (this.claimTimer) { clearTimeout(this.claimTimer); this.claimTimer = null; }

    const { tile, from, responses, robGang } = this.claim;
    this.claim = null;

    let best = null;
    for (const k in responses) {
      const r = responses[k];
      if (!r || r.pending || !r.action || r.action === 'pass') continue;
      const seat = Number(k);
      const pri = CLAIM_PRIORITY[r.action];
      const dist = (seat - from + this.n) % this.n;
      if (!best || pri > best.pri || (pri === best.pri && dist < best.dist)) {
        best = { seat, pri, dist, ...r };
      }
    }

    if (!best) {
      if (robGang) this.drawFor(from);
      else this.drawFor(this.nextOf(from));
      return;
    }

    if (best.action === 'hu') {
      this.finishWin(best.seat, tile, from, false, robGang);
      return;
    }

    // 从弃牌堆取回这张牌
    const pile = this.discards[from];
    const pi = pile.findIndex((t) => t.id === tile.id);
    if (pi >= 0) pile.splice(pi, 1);

    const hand = this.hands[best.seat];
    const take = (rank, k) => {
      const got = [];
      for (let i = 0; i < k; i++) {
        const idx = hand.findIndex((t) => t.t === rank);
        if (idx < 0) return null;
        got.push(hand.splice(idx, 1)[0]);
      }
      return got;
    };

    if (best.action === 'peng') {
      const got = take(tile.t, 2);
      if (!got) { this.drawFor(this.nextOf(from)); return; }
      this.melds[best.seat].push({ kind: 'peng', tiles: [...got, tile], from });
      this.broadcast({ type: 'event', name: 'peng', seat: best.seat, label: `${this.seats[best.seat].name} 碰 ${M.tileName(tile.t)}` });
      this.turn = best.seat;
      this.awaiting = 'discard';
      this.lastDiscard = null;
      this.lastDrawn = null;
      this.emit();
      this.aiTick();
      return;
    }

    if (best.action === 'gang') {
      const got = take(tile.t, 3);
      if (!got) { this.drawFor(this.nextOf(from)); return; }
      this.melds[best.seat].push({ kind: 'gang', tiles: [...got, tile], from, ming: true });
      this.gangCount[best.seat]++;
      this.broadcast({ type: 'event', name: 'gang', seat: best.seat, label: `${this.seats[best.seat].name} 明杠 ${M.tileName(tile.t)}` });
      this.payGang(best.seat, 1);
      this.drawFor(best.seat, true);
      return;
    }

    if (best.action === 'chi') {
      const got = [];
      for (const rank of best.combo) {
        const idx = hand.findIndex((t) => t.t === rank);
        if (idx < 0) { this.drawFor(this.nextOf(from)); return; }
        got.push(hand.splice(idx, 1)[0]);
      }
      const all = [...got, tile].sort((a, b) => a.t - b.t);
      this.melds[best.seat].push({ kind: 'chi', tiles: all, from });
      this.broadcast({ type: 'event', name: 'chi', seat: best.seat, label: `${this.seats[best.seat].name} 吃 ${M.tileName(tile.t)}` });
      this.turn = best.seat;
      this.awaiting = 'discard';
      this.lastDiscard = null;
      this.lastDrawn = null;
      this.emit();
      this.aiTick();
    }
  }

  /** 杠分：明杠 1 分/家，暗杠 2 分/家，从作出杠的人收取 */
  payGang(seat, pts) {
    for (let i = 0; i < this.n; i++) {
      if (i === seat) continue;
      this.bonus[seat] += pts;
      this.bonus[i] -= pts;
    }
    this.broadcast({
      type: 'event', name: 'gangpay',
      label: `${this.seats[seat].name} 收杠分 ${pts} × ${this.n - 1}`,
    });
  }

  drawFor(seat, afterGang = false) {
    if (!this.wall.length) { this.finishDraw(); return; }
    const tile = this.wall.pop();
    this.hands[seat].push(tile);
    this.hands[seat].sort((a, b) => a.t - b.t);
    this.turn = seat;
    this.awaiting = 'discard';
    this.lastDiscard = null;
    this.lastDrawn = tile;
    this.emit();
    this.aiTick();
  }

  /** 暗杠 / 补杠 */
  handleSelfGang(seat, rank) {
    if (this.phase !== PHASE.PLAY) return this.fail('现在不能杠');
    if (this.turn !== seat || this.awaiting !== 'discard') return this.fail('还没轮到你');
    if (this.claim) return this.fail('等其他人响应');
    if (!this.wall.length) return this.fail('牌墙已空，不能杠');

    const hand = this.hands[seat];
    const same = hand.filter((t) => t.t === rank);
    const peng = this.melds[seat].find((m) => m.kind === 'peng' && m.tiles.length && m.tiles[0].t === rank);

    // 暗杠
    if (same.length === 4) {
      for (const t of same) hand.splice(hand.indexOf(t), 1);
      this.melds[seat].push({ kind: 'gang', tiles: same.slice(), from: seat, an: true, hidden: true });
      this.gangCount[seat]++;
      this.broadcast({ type: 'event', name: 'angang', seat, label: `${this.seats[seat].name} 暗杠` });
      this.payGang(seat, 2);
      this.drawFor(seat, true);
      return { ok: true };
    }

    // 补杠（可被抢杠胡）
    if (peng && same.length >= 1) {
      const t = same[0];
      hand.splice(hand.indexOf(t), 1);
      peng.tiles.push(t);
      peng.kind = 'gang';
      this.gangCount[seat]++;
      this.broadcast({ type: 'event', name: 'bugang', seat, label: `${this.seats[seat].name} 补杠 ${M.tileName(rank)}` });

      const responses = {};
      let anyPending = false;
      for (let i = 1; i < this.n; i++) {
        const s = (seat + i) % this.n;
        if (!this.canHuWith(s, t)) continue;
        if (this.seats[s].isAI) responses[s] = { pending: false, action: 'hu' };
        else { responses[s] = { pending: true, options: [{ type: 'hu' }] }; anyPending = true; }
      }

      if (!Object.keys(responses).length) {
        this.payGang(seat, 1);
        this.drawFor(seat);
        return { ok: true };
      }

      this.claim = { tile: t, from: seat, responses, robGang: true };
      if (anyPending) {
        if (this.claimTimer) clearTimeout(this.claimTimer);
        this.claimTimer = setTimeout(() => { if (this.claim) this.resolveClaims(); }, CLAIM_WINDOW_MS);
      } else {
        this.resolveClaims();
        return { ok: true };
      }
      this.emit();
      return { ok: true };
    }

    return this.fail('没有可以杠的牌');
  }

  /** 自摸胡 */
  handleZimo(seat) {
    if (this.phase !== PHASE.PLAY) return this.fail('现在不能胡');
    if (this.claim) return this.fail('等其他人响应');
    if (this.turn !== seat || this.awaiting !== 'discard') return this.fail('还没轮到你');
    const c = this.countsOf(seat);
    if (!M.checkWin(c, this.melds[seat].length).win) return this.fail('还没胡');
    this.finishWin(seat, null, -1, true);
    return { ok: true };
  }

  // ---------- 结算 ----------
  finishWin(seat, tile, fromSeat, selfDraw, robGang = false) {
    if (this.phase !== PHASE.PLAY) return;
    this.phase = PHASE.DONE;
    if (this.claimTimer) { clearTimeout(this.claimTimer); this.claimTimer = null; }
    this.claim = null;

    const handTiles = this.hands[seat].map((t) => t.t);
    const full = tile ? [...handTiles, tile.t] : handTiles.slice();
    const check = M.checkWin(M.countsOf(full), this.melds[seat].length);

    const scored = M.scoreWin({
      handTiles: full,
      melds: this.melds[seat],
      style: check.style,
      selfDraw,
      gangFlower: false,
      robGang,
      lastTile: this.wall.length === 0,
      dealer: seat === this.dealer,
    });

    const delta = this.bonus.slice();
    delta[seat] += scored.score * (this.n - 1);
    for (let i = 0; i < this.n; i++) {
      if (i === seat) continue;
      delta[i] -= scored.score;
    }

    this.result = {
      winnerSeat: seat,
      winnerName: this.seats[seat].name,
      selfDraw,
      from: fromSeat,
      tile: tile ? { ...tile } : null,
      fans: scored.names.join(' + '),
      fan: scored.fan,
      score: scored.score,
      delta,
      hands: this.hands.map((h, i) => (i === seat ? full.map((t) => ({ t })) : h.slice())),
      melds: this.melds.map((m) => m.map((x) => ({ ...x }))),
      style: check.style,
    };
    this.broadcast({ type: 'event', name: 'win', seat, label: `${this.seats[seat].name} 胡牌！${scored.names.join(' ')}` });
    this.emit();
    if (this.onFinish) this.onFinish(this.result);
  }

  finishDraw() {
    this.phase = PHASE.DONE;
    if (this.claimTimer) { clearTimeout(this.claimTimer); this.claimTimer = null; }
    this.claim = null;
    this.result = {
      winnerSeat: -1,
      draw: true,
      fans: '流局',
      fan: 0,
      score: 0,
      delta: this.bonus.slice(),
      hands: this.hands.map((h) => h.slice()),
      melds: this.melds.map((m) => m.map((x) => ({ ...x }))),
    };
    this.broadcast({ type: 'event', name: 'drawgame', label: '牌墙摸完，流局' });
    this.emit();
    if (this.onFinish) this.onFinish(this.result);
  }

  // ---------- 广播 ----------
  fail(msg) {
    return { ok: false, error: msg };
  }

  emit() {
    for (let s = 0; s < this.n; s++) {
      this.broadcast({ type: 'state', seat: s, state: this.pub(s) });
    }
  }

  pub(viewer) {
    const actions = [];
    const myTurn = this.phase === PHASE.PLAY && this.turn === viewer &&
      this.awaiting === 'discard' && !this.claim;

    if (myTurn) {
      const c = this.countsOf(viewer);
      if (M.checkWin(c, this.melds[viewer].length).win) actions.push({ type: 'zimo' });
      for (let t = 0; t < 34; t++) {
        if (c[t] === 4 && this.wall.length > 0) actions.push({ type: 'angang', rank: t, name: M.tileName(t) });
      }
      for (const m of this.melds[viewer]) {
        if (m.kind === 'peng' && m.tiles.length && c[m.tiles[0].t] >= 1 && this.wall.length > 0) {
          actions.push({ type: 'bugang', rank: m.tiles[0].t, name: M.tileName(m.tiles[0].t) });
        }
      }
      actions.push({ type: 'discard' });
    }

    let claim = null;
    if (this.claim && this.claim.responses[viewer] && this.claim.responses[viewer].pending) {
      claim = {
        tile: this.claim.tile,
        from: this.claim.from,
        robGang: !!this.claim.robGang,
        options: this.claim.responses[viewer].options,
      };
    }

    return {
      game: 'mahjong',
      phase: this.phase,
      playerCount: this.n,
      dealer: this.dealer,
      turn: this.turn,
      awaiting: this.awaiting,
      wallCount: this.wall.length,
      seats: this.seats.map((s, i) => ({
        name: s.name,
        isAI: s.isAI,
        count: this.hands[i].length,
        score: this.scoreOf(i),
        melds: this.melds[i].map((m) => (m.hidden && i !== viewer
          ? { kind: m.kind, tiles: m.tiles.map((t) => ({ t: -1 })), hidden: true }
          : m)),
        discards: this.discards[i],
        isDealer: i === this.dealer,
        connected: s.connected !== false,
      })),
      hand: this.hands[viewer].slice(),
      lastDrawn: this.lastDrawn,
      lastDiscard: this.lastDiscard,
      actions,
      claim,
      result: this.result,
    };
  }

  // ---------- AI ----------
  aiTick() {
    if (this.phase !== PHASE.PLAY) return;
    if (this.claim) return;
    const seat = this.turn;
    if (!this.seats[seat] || !this.seats[seat].isAI) return;
    if (this.awaiting !== 'discard') return;

    setTimeout(() => {
      if (this.phase !== PHASE.PLAY || this.claim) return;
      if (this.turn !== seat || this.awaiting !== 'discard') return;

      const c = this.countsOf(seat);

      if (M.checkWin(c, this.melds[seat].length).win) {
        this.finishWin(seat, null, -1, true);
        return;
      }
      for (let t = 0; t < 34; t++) {
        if (c[t] === 4 && this.wall.length > 0) { this.handleSelfGang(seat, t); return; }
      }
      for (const m of this.melds[seat]) {
        if (m.kind === 'peng' && m.tiles.length && c[m.tiles[0].t] >= 1 && this.wall.length > 0) {
          this.handleSelfGang(seat, m.tiles[0].t);
          return;
        }
      }
      const tile = this.aiPickDiscard(seat);
      if (tile) this.handleDiscard(seat, tile.id);
      else this.finishDraw();
    }, 400 + randomInt(300));
  }

  aiPickDiscard(seat) {
    const hand = this.hands[seat];
    if (!hand.length) return null;
    const seen = new Set();
    let best = null;
    let bestScore = -Infinity;

    for (const t of hand) {
      if (seen.has(t.t)) continue;
      seen.add(t.t);
      const c = this.countsOf(seat);
      c[t.t]--;
      let sc = M.evaluate(c);
      // 孤张字牌优先打掉
      if (M.HONORS(t.t) && c[t.t] === 0) sc -= 2;
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    return best;
  }

  aiClaim(seat, options, tile, from) {
    const c = this.countsOf(seat);
    const before = M.evaluate(c);

    for (const o of options) if (o.type === 'hu') return { pending: false, action: 'hu' };

    const gangOpt = options.find((o) => o.type === 'gang');
    if (gangOpt && this.wall.length > 4) {
      const cc = c.slice();
      cc[tile.t] -= 3;
      if (M.evaluate(cc) >= before - 20) return { pending: false, action: 'gang' };
    }

    const pengOpt = options.find((o) => o.type === 'peng');
    if (pengOpt) {
      const cc = c.slice();
      cc[tile.t] -= 2;
      if (M.evaluate(cc) > before) return { pending: false, action: 'peng' };
    }

    const chiOpt = options.find((o) => o.type === 'chi');
    if (chiOpt) {
      let bestCombo = null;
      let bestAfter = before;
      for (const combo of chiOpt.combos) {
        const cc = c.slice();
        for (const r of combo) cc[r]--;
        const after = M.evaluate(cc);
        if (after > bestAfter) { bestAfter = after; bestCombo = combo; }
      }
      if (bestCombo) return { pending: false, action: 'chi', combo: bestCombo };
    }

    return { pending: false, action: 'pass' };
  }
}

module.exports = { MahjongGame, PHASE };
