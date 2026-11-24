'use strict';

/**
 * 斗地主规则核心：牌组、牌型识别、大小比较、合法出牌枚举。
 * 牌点：3..15 表示 3..2（15=2），16=小王，17=大王。
 */

const RANK_LABEL = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};

const TYPE_NAME = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  triple1: '三带一',
  triple2: '三带二',
  straight: '顺子',
  doubleStraight: '连对',
  plane: '飞机',
  plane1: '飞机带单',
  plane2: '飞机带对',
  four2single: '四带二',
  four2pair: '四带两对',
  bomb: '炸弹',
  rocket: '王炸',
};

function rankLabel(r) {
  return RANK_LABEL[r] || String(r);
}

function typeName(t) {
  return TYPE_NAME[t] || t;
}

/** 花色符号，顺序与 newDeck() 的 suit 编号一致 */
const SUIT_TXT = ['♠', '♥', '♣', '♦'];

/** 单张牌的文本：3♠ / 小王 */
function cardLabel(card) {
  if (!card) return '?';
  if (card.rank >= 16) return rankLabel(card.rank);
  return rankLabel(card.rank) + (SUIT_TXT[card.suit] || '');
}

/**
 * 把一组牌渲染成可读文本，用于对局日志。
 * 顺子 / 连对 / 飞机这种长牌型只写首尾，避免日志被一串牌名撑爆。
 */
function cardsText(cards, info) {
  const list = (cards || []).slice().sort((a, b) => a.rank - b.rank || a.suit - b.suit);
  if (!list.length) return '';
  const t = info && info.type;
  if (t === 'rocket') return '小王 大王';
  if ((t === 'straight' || t === 'doubleStraight' || t === 'plane') && list.length >= 4) {
    const body = list.filter((c) => c.rank < 16);
    const tail = list.filter((c) => c.rank >= 16);
    let txt = `${rankLabel(body[0].rank)}-${rankLabel(body[body.length - 1].rank)}`;
    if (tail.length) txt += ' ' + tail.map(cardLabel).join(' ');
    return txt;
  }
  // 带牌型把主牌放在最前，读起来是「三张 J + 带一张 3」而不是点数排序
  if (info && info.value != null && /^(triple[12]|four2single|four2pair|plane[12])$/.test(t)) {
    const main = list.filter((c) => c.rank === info.value);
    const rest = list.filter((c) => c.rank !== info.value);
    return main.concat(rest).map(cardLabel).join(' ');
  }
  return list.map(cardLabel).join(' ');
}

/** 生成一副 54 张牌 */
function newDeck() {
  const cards = [];
  let id = 0;
  for (let r = 3; r <= 15; r++) {
    for (let s = 0; s < 4; s++) cards.push({ id: id++, rank: r, suit: s });
  }
  cards.push({ id: id++, rank: 16, suit: 4 });
  cards.push({ id: id++, rank: 17, suit: 4 });
  return cards;
}

function isConsecutive(ranks) {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

/** 在计数表上找飞机（带单/带对） */
function findPlane(cnt, n) {
  const tripleRanks = [];
  for (let r = 3; r <= 14; r++) if (cnt[r] >= 3) tripleRanks.push(r);
  if (tripleRanks.length < 2) return null;

  const runs = [];
  let cur = [];
  for (const r of tripleRanks) {
    if (cur.length && r === cur[cur.length - 1] + 1) cur.push(r);
    else {
      if (cur.length) runs.push(cur);
      cur = [r];
    }
  }
  if (cur.length) runs.push(cur);

  for (const run of runs) {
    for (let k = Math.min(run.length, Math.floor(n / 3)); k >= 2; k--) {
      for (let s = 0; s + k <= run.length; s++) {
        const body = run.slice(s, s + k);
        const restCards = n - 3 * k;
        if (restCards !== k && restCards !== 2 * k) continue;
        const left = cnt.slice();
        for (const r of body) left[r] -= 3;
        let bad = false;
        for (let r = 0; r < left.length; r++) if (left[r] < 0) bad = true;
        if (bad) continue;
        let total = 0;
        for (let r = 3; r <= 17; r++) total += left[r];
        if (total !== restCards) continue;

        if (restCards === k) {
          // 带单：每个余牌点数最多 2 张（3 张及以上应视为顺子三张，不合法）
          let ok = true;
          for (let r = 3; r <= 17; r++) if (left[r] >= 3) ok = false;
          if (!ok) continue;
          return { type: 'plane1', value: body[body.length - 1], len: n };
        }
        // 带对：余牌必须全是成对的
        let ok = true;
        for (let r = 3; r <= 17; r++) if (left[r] !== 0 && left[r] !== 2) ok = false;
        if (!ok) continue;
        return { type: 'plane2', value: body[body.length - 1], len: n };
      }
    }
  }
  return null;
}

/**
 * 识别一组牌的牌型。
 * @returns {{type:string,value:number,len:number}|null}
 */
function identify(cards) {
  const n = cards.length;
  if (!n) return null;
  const cnt = new Array(18).fill(0);
  for (const c of cards) {
    if (c.rank < 3 || c.rank > 17) return null;
    cnt[c.rank]++;
  }
  const ranks = [];
  for (let r = 3; r <= 17; r++) if (cnt[r]) ranks.push(r);
  const maxRank = ranks[ranks.length - 1];

  // 王炸
  if (n === 2 && cnt[16] === 1 && cnt[17] === 1) return { type: 'rocket', value: 100, len: 2 };
  // 炸弹
  if (n === 4 && ranks.length === 1) return { type: 'bomb', value: maxRank, len: 4 };

  if (n === 1) return { type: 'single', value: maxRank, len: 1 };
  if (n === 2 && ranks.length === 1) return { type: 'pair', value: maxRank, len: 2 };
  if (n === 3 && ranks.length === 1) return { type: 'triple', value: maxRank, len: 3 };

  // 顺子
  if (n >= 5 && ranks.length === n && maxRank <= 14 && isConsecutive(ranks)) {
    return { type: 'straight', value: maxRank, len: n };
  }
  // 连对
  if (n >= 6 && n % 2 === 0 && ranks.length === n / 2 && ranks.length >= 3 &&
      maxRank <= 14 && isConsecutive(ranks) && ranks.every((r) => cnt[r] === 2)) {
    return { type: 'doubleStraight', value: maxRank, len: n };
  }
  // 纯飞机
  if (n >= 6 && n % 3 === 0 && ranks.length === n / 3 && ranks.length >= 2 &&
      maxRank <= 14 && isConsecutive(ranks) && ranks.every((r) => cnt[r] === 3)) {
    return { type: 'plane', value: maxRank, len: n };
  }

  // 三带一 / 三带二
  if (n === 4) {
    const t = ranks.filter((r) => cnt[r] === 3);
    if (t.length === 1) return { type: 'triple1', value: t[0], len: 4 };
  }
  if (n === 5) {
    const t = ranks.filter((r) => cnt[r] === 3);
    const p = ranks.filter((r) => cnt[r] === 2);
    if (t.length === 1 && p.length === 1) return { type: 'triple2', value: t[0], len: 5 };
  }
  // 四带二 / 四带两对
  if (n === 6) {
    const f = ranks.filter((r) => cnt[r] === 4);
    if (f.length === 1) return { type: 'four2single', value: f[0], len: 6 };
  }
  if (n === 8) {
    const f = ranks.filter((r) => cnt[r] === 4);
    if (f.length === 1) {
      const rest = ranks.filter((r) => r !== f[0]);
      if (rest.length === 2 && rest.every((r) => cnt[r] === 2)) {
        return { type: 'four2pair', value: f[0], len: 8 };
      }
    }
  }

  return findPlane(cnt, n);
}

/** a 能否压过 b（b 为 null 表示领出） */
function beats(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.type === 'rocket') return true;
  if (b.type === 'rocket') return false;
  if (a.type === 'bomb') return b.type !== 'bomb' || a.value > b.value;
  if (b.type === 'bomb') return false;
  return a.type === b.type && a.len === b.len && a.value > b.value;
}

function isBomb(info) {
  return !!info && (info.type === 'bomb' || info.type === 'rocket');
}

/** 从手牌里按点数取出具体牌（点数可重复），失败返回 null */
function pickCards(hand, ranks) {
  const pool = hand.slice();
  const out = [];
  for (const r of ranks) {
    let idx = -1;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].rank === r) { idx = i; break; }
    }
    if (idx < 0) return null;
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

/** 挑选飞机/三带/四带的带牌：从低到高挑 k 张（size=1）或 k 对（size=2） */
function pickWings(cnt, bodySet, k, size) {
  const need = k * size;
  const out = [];
  for (let r = 3; r <= 17 && out.length < need; r++) {
    if (bodySet.has(r)) continue;
    if (cnt[r] < size) continue;
    for (let i = 0; i < size; i++) out.push(r);
  }
  if (out.length !== need) return null;
  return out;
}

/** 枚举手牌所有合法出牌 */
function genAll(hand) {
  const cnt = new Array(18).fill(0);
  for (const c of hand) cnt[c.rank]++;

  const out = [];
  const seen = new Set();
  const push = (ranks) => {
    const cards = pickCards(hand, ranks);
    if (!cards) return;
    const info = identify(cards);
    if (!info) return;
    const key = cards.map((c) => c.id).sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ cards, info });
  };

  // 单/对/三/炸弹/王炸
  for (let r = 3; r <= 15; r++) {
    if (cnt[r] >= 1) push([r]);
    if (cnt[r] >= 2) push([r, r]);
    if (cnt[r] >= 3) push([r, r, r]);
    if (cnt[r] === 4) push([r, r, r, r]);
  }
  if (cnt[16] === 1) push([16]);
  if (cnt[17] === 1) push([17]);
  if (cnt[16] && cnt[17]) push([16, 17]);

  // 三带一 / 三带二
  for (let r = 3; r <= 15; r++) {
    if (cnt[r] >= 3) {
      const w1 = pickWings(cnt, new Set([r]), 1, 1);
      if (w1) push([r, r, r, w1[0]]);
      const w2 = pickWings(cnt, new Set([r]), 1, 2);
      if (w2) push([r, r, r, w2[0], w2[1]]);
    }
  }

  // 四带二 / 四带两对
  for (let r = 3; r <= 15; r++) {
    if (cnt[r] === 4) {
      const w1 = pickWings(cnt, new Set([r]), 2, 1);
      if (w1) push([r, r, r, r, ...w1]);
      const w2 = pickWings(cnt, new Set([r]), 2, 2);
      if (w2) push([r, r, r, r, ...w2]);
    }
  }

  // 顺子
  for (let s = 3; s <= 14; s++) {
    for (let len = 5; s + len - 1 <= 14; len++) {
      let ok = true;
      for (let i = 0; i < len; i++) if (cnt[s + i] < 1) ok = false;
      if (!ok) break;
      const ranks = [];
      for (let i = 0; i < len; i++) ranks.push(s + i);
      push(ranks);
    }
  }

  // 连对
  for (let s = 3; s <= 14; s++) {
    for (let k = 3; s + k - 1 <= 14; k++) {
      let ok = true;
      for (let i = 0; i < k; i++) if (cnt[s + i] < 2) ok = false;
      if (!ok) break;
      const ranks = [];
      for (let i = 0; i < k; i++) ranks.push(s + i, s + i);
      push(ranks);
    }
  }

  // 飞机（纯/带单/带对）
  for (let s = 3; s <= 14; s++) {
    for (let k = 2; s + k - 1 <= 14; k++) {
      let ok = true;
      for (let i = 0; i < k; i++) if (cnt[s + i] < 3) ok = false;
      if (!ok) break;
      const body = [];
      for (let i = 0; i < k; i++) body.push(s + i);
      const bodyRanks = [];
      for (const r of body) bodyRanks.push(r, r, r);
      push(bodyRanks);
      const w1 = pickWings(cnt, new Set(body), k, 1);
      if (w1) push([...bodyRanks, ...w1]);
      const w2 = pickWings(cnt, new Set(body), k, 2);
      if (w2) push([...bodyRanks, ...w2]);
    }
  }

  return out;
}

module.exports = {
  RANK_LABEL,
  TYPE_NAME,
  SUIT_TXT,
  rankLabel,
  typeName,
  cardLabel,
  cardsText,
  newDeck,
  identify,
  beats,
  isBomb,
  genAll,
  pickCards,
};
