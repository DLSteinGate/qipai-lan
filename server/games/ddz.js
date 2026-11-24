'use strict';

const { shuffle, randomInt } = require('../util');
const R = require('./ddz-rules');

const PHASE = {
  WAIT: 'waiting',
  BID: 'bidding',
  PLAY: 'playing',
  DONE: 'finished',
};

class DdzGame {
  /**
   * @param {Array<{id:string,name:string,isAI:boolean}>} players
   * @param {(msg:object)=>void} broadcast
   * @param {(seat:number)=>number} scoreOf
   */
  constructor(players, broadcast, scoreOf, onFinish) {
    this.players = players;
    this.broadcast = broadcast;
    this.scoreOf = scoreOf || (() => 0);
    this.onFinish = onFinish || null;
    this.phase = PHASE.WAIT;
    this.seats = players.map((p) => ({
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      pid: p.pid,
    }));
    this.hands = [[], [], []];
    this.bottom = [];
    this.landlord = -1;
    this.base = 0;
    this.mult = 1;
    this.turn = 0;
    this.lastPlay = null;
    this.passCount = 0;
    this.bid = { turn: 0, best: 0, bestSeat: -1, acted: 0, history: [] };
    this.winner = null;
    this.result = null;
    this.playedCount = [0, 0, 0];
    this.bombCount = 0;
    this.lastWinCards = null;
  }

  // ---------- 发牌 ----------
  deal() {
    const deck = shuffle(R.newDeck());
    for (let s = 0; s < 3; s++) this.hands[s] = [];
    for (let i = 0; i < 51; i++) this.hands[i % 3].push(deck[i]);
    this.bottom = deck.slice(51);
    for (const h of this.hands) h.sort((a, b) => a.rank - b.rank || a.suit - b.suit);
    this.phase = PHASE.BID;
    this.landlord = -1;
    this.base = 0;
    this.mult = 1;
    this.lastPlay = null;
    this.passCount = 0;
    this.winner = null;
    this.result = null;
    this.playedCount = [0, 0, 0];
    this.bombCount = 0;
    this.lastWinCards = null;
    const first = randomInt(3);
    this.bid = { turn: first, best: 0, bestSeat: -1, acted: 0, history: [] };
    this.turn = first;
    this.emit();
    this.aiTick();
    return this;
  }

  // ---------- 叫分 ----------
  handleBid(seat, value) {
    if (this.phase !== PHASE.BID || this.bid.turn !== seat) return this.fail('还没轮到你叫分');
    if (value !== 0 && (value < 1 || value > 3)) return this.fail('叫分只能是 0/1/2/3');
    if (value !== 0 && value <= this.bid.best) return this.fail('只能叫比当前更高的分');

    this.bid.history.push({ seat, value });
    this.bid.acted++;
    if (value > this.bid.best) {
      this.bid.best = value;
      this.bid.bestSeat = seat;
    }
    this.broadcast({ type: 'event', name: 'bid', seat, value, label: `${this.seats[seat].name} ${value ? '叫' + value + '分' : '不叫'}` });

    if (this.bid.best === 3 || this.bid.acted >= 3) {
      if (this.bid.bestSeat < 0) {
        this.broadcast({ type: 'event', name: 'redeal', label: '三家都不叫，重新发牌' });
        this.deal();
        return { ok: true };
      }
      this.startPlay(this.bid.bestSeat, this.bid.best);
      return { ok: true };
    }
    this.bid.turn = (this.bid.turn + 1) % 3;
    this.turn = this.bid.turn;
    this.emit();
    this.aiTick();
    return { ok: true };
  }

  startPlay(landlord, base) {
    this.landlord = landlord;
    this.base = base;
    this.mult = 1;
    this.phase = PHASE.PLAY;
    this.hands[landlord] = this.hands[landlord].concat(this.bottom);
    this.hands[landlord].sort((a, b) => a.rank - b.rank || a.suit - b.suit);
    this.bottom = [];
    this.turn = landlord;
    this.lastPlay = null;
    this.passCount = 0;
    this.broadcast({ type: 'event', name: 'landlord', seat: landlord, label: `${this.seats[landlord].name} 成为地主（${base}分）` });
    this.emit();
    this.aiTick();
  }

  // ---------- 出牌 ----------
  handlePlay(seat, cardIds) {
    if (this.phase !== PHASE.PLAY) return this.fail('现在不能出牌');
    if (this.turn !== seat) return this.fail('还没轮到你');
    if (!Array.isArray(cardIds) || !cardIds.length) return this.fail('请选择要出的牌');

    const hand = this.hands[seat];
    const cards = [];
    const used = new Set();
    for (const id of cardIds) {
      const c = hand.find((x) => x.id === id && !used.has(x.id));
      if (!c) return this.fail('手牌里没有这张牌');
      used.add(c.id);
      cards.push(c);
    }
    const info = R.identify(cards);
    if (!info) return this.fail('牌型不合法');

    const active = this.lastPlay && this.lastPlay.seat !== seat ? this.lastPlay.info : null;
    const last = this.passCount >= 2 ? null : (this.lastPlay ? this.lastPlay.info : null);
    if (last && !R.beats(info, last)) return this.fail('管不上上家的牌');

    // 从手牌移除
    const ids = new Set(cards.map((c) => c.id));
    this.hands[seat] = hand.filter((c) => !ids.has(c.id));
    this.playedCount[seat]++;

    this.lastWinCards = cards;
    this.lastPlay = { seat, cards, info };
    this.passCount = 0;

    const bomb = R.isBomb(info);
    if (bomb) {
      this.bombCount++;
      this.mult *= 2;
    }

    // 对局日志要能看出谁出了什么牌，所以这里把牌面一起广播出去
    const txt = R.cardsText(cards, info);
    const typeTxt = R.typeName(info.type);
    this.broadcast({
      type: 'event',
      name: bomb ? 'bomb' : 'play',
      seat,
      cards: txt,
      combo: info.type,
      mult: this.mult,
      label: bomb
        ? `${this.seats[seat].name} 出了${typeTxt} ${txt}，倍数 ×2`
        : `${this.seats[seat].name} 出了${typeTxt} ${txt}`,
    });

    if (this.hands[seat].length === 0) {
      this.finish(seat);
      return { ok: true };
    }

    this.turn = (seat + 1) % 3;
    this.emit();
    this.aiTick();
    return { ok: true };
  }

  handlePass(seat) {
    if (this.phase !== PHASE.PLAY) return this.fail('现在不能过牌');
    if (this.turn !== seat) return this.fail('还没轮到你');
    if (!this.lastPlay) return this.fail('你是领出方，必须出牌');

    this.passCount++;
    this.broadcast({ type: 'event', name: 'pass', seat, label: `${this.seats[seat].name} 不要` });

    if (this.passCount >= 2) {
      const lead = this.lastPlay.seat;
      this.lastPlay = null;
      this.passCount = 0;
      this.turn = lead;
      this.emit();
      this.aiTick();
      return { ok: true };
    }
    this.turn = (seat + 1) % 3;
    this.emit();
    this.aiTick();
    return { ok: true };
  }

  // ---------- 结算 ----------
  finish(seat) {
    this.phase = PHASE.DONE;
    const isLandlord = seat === this.landlord;
    this.winner = isLandlord ? 'landlord' : 'farmer';

    // 春天 / 反春
    if (isLandlord) {
      const farmers = [0, 1, 2].filter((s) => s !== this.landlord);
      if (farmers.every((s) => this.playedCount[s] === 0)) {
        this.mult *= 2;
        this.broadcast({ type: 'event', name: 'spring', label: '春天！倍数 ×2' });
      }
    } else if (this.playedCount[this.landlord] <= 1) {
      this.mult *= 2;
      this.broadcast({ type: 'event', name: 'spring', label: '反春！倍数 ×2' });
    }

    const unit = this.base * this.mult;
    const delta = [0, 0, 0];
    if (isLandlord) {
      delta[this.landlord] = unit * 2;
      for (let s = 0; s < 3; s++) if (s !== this.landlord) delta[s] = -unit;
    } else {
      delta[this.landlord] = -unit * 2;
      for (let s = 0; s < 3; s++) if (s !== this.landlord) delta[s] = unit;
    }

    this.result = {
      winner: this.winner,
      winnerSeat: seat,
      landLord: this.landlord,
      base: this.base,
      mult: this.mult,
      unit,
      delta,
      bombs: this.bombCount,
      hands: this.hands.map((h) => h.slice()),
    };
    this.emit();
    if (this.onFinish) this.onFinish(this.result);
    return { ok: true };
  }

  // ---------- 工具 ----------
  fail(msg) {
    return { ok: false, error: msg };
  }

  emit() {
    for (let s = 0; s < 3; s++) this.broadcast({ type: 'state', seat: s, state: this.pub(s) });
  }

  pub(viewer) {
    const active = this.lastPlay && this.passCount < 2 ? this.lastPlay.info : null;
    const actions = [];
    if (this.phase === PHASE.BID && this.bid.turn === viewer) {
      for (let v = 1; v <= 3; v++) if (v > this.bid.best) actions.push({ type: 'bid', value: v });
      actions.push({ type: 'bid', value: 0 });
    }
    if (this.phase === PHASE.PLAY && this.turn === viewer) {
      if (this.lastPlay && this.passCount < 2) actions.push({ type: 'pass' });
      actions.push({ type: 'play' });
    }

    // 我的回合才算提示，避免白算
    let suggest = null;
    let canBeatAny = null;
    if (this.phase === PHASE.PLAY && this.turn === viewer) {
      const moves = R.genAll(this.hands[viewer]);
      if (active) {
        const beatable = moves.filter((m) => R.beats(m.info, active));
        canBeatAny = beatable.length > 0;
        if (beatable.length) {
          beatable.sort((a, b) => {
            const ab = R.isBomb(a.info), bb = R.isBomb(b.info);
            if (ab !== bb) return ab ? 1 : -1;
            return a.info.value - b.info.value || a.cards.length - b.cards.length;
          });
          suggest = beatable[0].cards.map((c) => c.id);
        }
      } else {
        // 领出：优先能一次走完，否则出「张数多且点数低」的一手
        const finisher = moves.find((m) => m.cards.length === this.hands[viewer].length);
        const pool = moves.filter((m) => !R.isBomb(m.info));
        const list = finisher ? [finisher] : (pool.length ? pool : moves);
        list.sort((a, b) => (a.info.value - a.cards.length * 3) - (b.info.value - b.cards.length * 3));
        if (list.length) suggest = list[0].cards.map((c) => c.id);
      }
    }

    return {
      game: 'ddz',
      phase: this.phase,
      turn: this.turn,
      landlord: this.landlord,
      base: this.base,
      mult: this.mult,
      bombCount: this.bombCount,
      bid: {
        best: this.bid.best,
        bestSeat: this.bid.bestSeat,
        turn: this.bid.turn,
        history: this.bid.history,
      },
      seats: this.seats.map((s, i) => ({
        name: s.name,
        isAI: s.isAI,
        count: this.hands[i].length,
        isLandlord: i === this.landlord,
        score: this.scoreOf(i),
        connected: s.connected !== false,
      })),
      hand: this.hands[viewer].slice(),
      bottom: this.landlord >= 0 ? this.bottom : null,
      lastPlay: this.lastPlay
        ? { seat: this.lastPlay.seat, cards: this.lastPlay.cards, typeName: R.typeName(this.lastPlay.info.type) }
        : null,
      lastWinCards: this.lastWinCards,
      actions,
      canBeatAny,
      suggest,
      result: this.result,
    };
  }

  // ---------- AI ----------
  aiTick() {
    if (this.phase === PHASE.BID) {
      const seat = this.bid.turn;
      if (!this.seats[seat].isAI) return;
      setTimeout(() => {
        if (this.phase !== PHASE.BID || this.bid.turn !== seat) return;
        const v = this.aiBidValue(seat);
        const r = this.handleBid(seat, v);
        // 兜底：万一 AI 给出非法值，强制不叫，避免卡死
        if (!r.ok && this.phase === PHASE.BID && this.bid.turn === seat) {
          this.handleBid(seat, 0);
        }
      }, 350 + randomInt(250));
      return;
    }
    if (this.phase === PHASE.PLAY) {
      const seat = this.turn;
      if (!this.seats[seat].isAI) return;
      setTimeout(() => {
        if (this.phase !== PHASE.PLAY || this.turn !== seat) return;
        const move = this.aiChoose(seat);
        if (!move) {
          this.handlePass(seat);
          return;
        }
        const r = this.handlePlay(seat, move.cards.map((c) => c.id));
        // 兜底：AI 给出的牌被拒时改为过牌或出最小单张，避免卡死
        if (!r.ok && this.phase === PHASE.PLAY && this.turn === seat) {
          if (this.lastPlay && this.passCount < 2) {
            this.handlePass(seat);
          } else {
            const h = this.hands[seat];
            const low = h.slice().sort((a, b) => a.rank - b.rank)[0];
            if (low) this.handlePlay(seat, [low.id]);
          }
        }
      }, 400 + randomInt(300));
    }
  }

  aiBidValue(seat) {
    const hand = this.hands[seat];
    let score = 0;
    const cnt = {};
    for (const c of hand) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
    if (cnt[17]) score += 4;
    if (cnt[16]) score += 3;
    score += (cnt[15] || 0) * 2;
    score += (cnt[14] || 0) * 1;
    for (const r in cnt) if (cnt[r] === 4) score += 4;

    // 必须严格高于当前最高分，否则只能不叫
    const next = this.bid.best + 1;
    if (next > 3) return 0;
    if (score >= 9) return next;
    if (score >= 6) return next <= 2 ? next : 0;
    if (score >= 4 && this.bid.best === 0) return 1;
    return 0;
  }

  aiChoose(seat) {
    const hand = this.hands[seat];
    const all = R.genAll(hand);
    if (!all.length) return null;

    const last = this.lastPlay && this.passCount < 2 ? this.lastPlay.info : null;
    const lastSeat = this.lastPlay ? this.lastPlay.seat : -1;
    const meLandlord = seat === this.landlord;

    // 队友判断：农民之间是队友
    const isTeammate = (s) => s >= 0 && s !== seat && !meLandlord && s !== this.landlord;

    if (last) {
      let cands = all.filter((m) => R.beats(m.info, last));
      if (!cands.length) return null;

      // 能直接走完就走完
      const finisher = cands.find((m) => m.cards.length === hand.length);
      if (finisher) return finisher;

      // 队友出的牌不压（除非我马上就要出完）
      if (isTeammate(lastSeat) && this.hands[lastSeat].length > 0) {
        return null;
      }

      const nonBomb = cands.filter((m) => !R.isBomb(m.info));
      const useBomb = this.shouldBomb(seat, lastSeat);
      if (nonBomb.length) {
        nonBomb.sort((a, b) => a.info.value - b.info.value || a.cards.length - b.cards.length);
        return nonBomb[0];
      }
      if (useBomb) {
        cands.sort((a, b) => a.info.value - b.info.value);
        return cands[0];
      }
      return null;
    }

    // 领出：优先尽快出完，兼顾不拆炸弹
    const nonBomb = all.filter((m) => !R.isBomb(m.info));
    const pool = nonBomb.length ? nonBomb : all;

    // 一手走完
    const finisher = pool.find((m) => m.cards.length === hand.length);
    if (finisher) return finisher;

    // 剩两手时尝试打出能留下的最小牌
    pool.sort((a, b) => {
      const scoreA = a.info.value * 1.0 - a.cards.length * 3.2;
      const scoreB = b.info.value * 1.0 - b.cards.length * 3.2;
      return scoreA - scoreB;
    });
    return pool[0];
  }

  shouldBomb(seat, lastSeat) {
    if (lastSeat < 0) return false;
    const meLandlord = seat === this.landlord;
    const enemy = meLandlord ? lastSeat !== this.landlord : lastSeat === this.landlord;
    const enemyLeft = this.hands[lastSeat].length;
    const myLeft = this.hands[seat].length;
    if (!enemy) return false;
    if (enemyLeft <= 2) return true;
    if (myLeft <= 4) return true;
    if (this.mult >= 4) return true;
    return false;
  }
}

module.exports = { DdzGame, PHASE };
