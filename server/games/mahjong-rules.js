'use strict';

/**
 * 广东推倒胡规则核心。
 * 牌型编码：0..8 = 万1..9，9..17 = 条1..9，18..26 = 筒1..9，
 * 27..30 = 东南西北，31..33 = 中发白。每种 4 张，共 136 张。
 */

const TILE_NAMES = [];
for (let i = 0; i < 34; i++) {
  if (i < 9) TILE_NAMES.push((i + 1) + '万');
  else if (i < 18) TILE_NAMES.push((i - 8) + '条');
  else if (i < 27) TILE_NAMES.push((i - 17) + '筒');
  else TILE_NAMES.push(['东', '南', '西', '北', '中', '发', '白'][i - 27]);
}

const HONORS = (t) => t >= 27;
const SUIT_OF = (t) => (t < 9 ? 0 : t < 18 ? 1 : t < 27 ? 2 : 3);
/** 花色内序号 0..8，字牌返回 -1 */
const LOCAL = (t) => (t < 27 ? t % 9 : -1);

function tileName(t) {
  return TILE_NAMES[t] || '?';
}

function newWall() {
  const wall = [];
  let id = 0;
  for (let t = 0; t < 34; t++) {
    for (let k = 0; k < 4; k++) wall.push({ id: id++, t });
  }
  return wall;
}

function countsOf(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) c[typeof t === 'number' ? t : t.t]++;
  return c;
}

/**
 * 判断 3n+2 张牌是否胡牌（不含已亮出的副露）。
 * @param {number[]} counts 34 长度计数表
 * @param {number} needSets 还需要几组面子
 */
function canFormSets(counts, needSets) {
  if (needSets === 0) return true;
  // 找第一张有牌的
  let i = 0;
  while (i < 34 && counts[i] === 0) i++;
  if (i === 34) return false;

  // 刻子
  if (counts[i] >= 3) {
    counts[i] -= 3;
    if (canFormSets(counts, needSets - 1)) {
      counts[i] += 3;
      return true;
    }
    counts[i] += 3;
  }
  // 顺子
  const lo = LOCAL(i);
  if (lo >= 0 && lo <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    const ok = canFormSets(counts, needSets - 1);
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** 标准型胡牌：需要 4 组面子 + 1 对将（needSets 组） */
function isStandardWin(counts, needSets) {
  for (let p = 0; p < 34; p++) {
    if (counts[p] >= 2) {
      counts[p] -= 2;
      const ok = canFormSets(counts, needSets);
      counts[p] += 2;
      if (ok) return true;
    }
  }
  return false;
}

function isSevenPairs(counts) {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    total += counts[i];
    if (counts[i] % 2 !== 0) return false;
    if (counts[i] > 0) pairs += counts[i] / 2;
  }
  return total === 14 && pairs === 7;
}

function hasQuadInSevenPairs(counts) {
  for (let i = 0; i < 34; i++) if (counts[i] === 4) return true;
  return false;
}

const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

function isThirteenOrphans(counts) {
  let total = 0;
  let hasPair = false;
  for (let i = 0; i < 34; i++) total += counts[i];
  if (total !== 14) return false;
  for (const t of ORPHANS) {
    if (counts[t] === 0) return false;
    if (counts[t] >= 2) hasPair = true;
    if (counts[t] > 2) return false;
  }
  for (let i = 0; i < 34; i++) {
    if (!ORPHANS.includes(i) && counts[i] > 0) return false;
  }
  return hasPair;
}

/**
 * 综合胡牌判定。
 * @param {number[]} counts 手牌计数表（不含副露）
 * @param {number} meldCount 已副露面子数
 * @returns {{win:boolean, style:string}}
 */
function checkWin(counts, meldCount) {
  const total = counts.reduce((a, b) => a + b, 0);
  const needSets = 4 - meldCount;
  if (total !== needSets * 3 + 2) return { win: false, style: '' };

  if (meldCount === 0 && isThirteenOrphans(counts)) return { win: true, style: 'thirteen' };
  if (meldCount === 0 && isSevenPairs(counts)) return { win: true, style: 'sevenPairs' };
  if (isStandardWin(counts, needSets)) return { win: true, style: 'standard' };
  return { win: false, style: '' };
}

/** 是否听牌（返回可胡的牌张列表） */
function waitingTiles(counts, meldCount) {
  const res = [];
  for (let t = 0; t < 34; t++) {
    if (counts[t] >= 4) continue;
    counts[t]++;
    if (checkWin(counts, meldCount).win) res.push(t);
    counts[t]--;
  }
  return res;
}

/** 把一副副露转成 counts 之外的信息（用于算番的全体牌） */
function meldTilesOf(meld) {
  // meld: {kind:'chi'|'peng'|'gang', tiles:[...]}
  return meld.tiles.slice();
}

/**
 * 算番。返回 {fan:number, names:string[], score:number}
 */
function scoreWin(ctx) {
  // ctx: {handTiles:number[], melds:[], style, selfDraw, gangFlower, robGang, lastTile, dealer}
  const names = [];
  let fan = 0;

  if (ctx.style === 'thirteen') {
    names.push('十三幺');
    fan += 8;
  } else if (ctx.style === 'sevenPairs') {
    const counts = countsOf(ctx.handTiles);
    if (hasQuadInSevenPairs(counts)) {
      names.push('豪华七小对');
      fan += 4;
    } else {
      names.push('七小对');
      fan += 3;
    }
  } else {
    names.push('平胡');
    fan += 1;
  }

  // 合集判断清一色 / 混一色 / 碰碰胡
  const all = ctx.handTiles.slice();
  for (const m of ctx.melds) all.push(...meldTilesOf(m));

  const suits = new Set(all.filter((t) => !HONORS(t)).map(SUIT_OF));
  const hasHonor = all.some(HONORS);
  const pureSuit = suits.size === 1 && !hasHonor;
  const mixedSuit = suits.size === 1 && hasHonor;

  if (pureSuit) { names.push('清一色'); fan += 4; }
  else if (mixedSuit) { names.push('混一色'); fan += 2; }

  // 碰碰胡：所有副露和手牌都能拆成刻子
  if (ctx.style === 'standard' && isAllTriplets(ctx.handTiles, ctx.melds)) {
    if (pureSuit) { names.push('清碰'); fan += 1; }
    else { names.push('碰碰胡'); fan += 2; }
  }

  if (ctx.selfDraw) { names.push('自摸'); fan += 1; }
  if (ctx.gangFlower) { names.push('杠上开花'); fan += 1; }
  if (ctx.robGang) { names.push('抢杠胡'); fan += 1; }
  if (ctx.lastTile) { names.push('海底捞月'); fan += 1; }
  if (ctx.dealer) { names.push('庄家'); fan += 1; }

  if (fan < 1) fan = 1;
  const score = Math.min(64, Math.pow(2, fan - 1));
  return { fan, names, score };
}

function isAllTriplets(handTiles, melds) {
  for (const m of melds) if (m.kind === 'chi') return false;
  const counts = countsOf(handTiles);
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 0) continue;
    if (counts[i] === 2) { pairs++; continue; }
    if (counts[i] !== 3) return false;
  }
  return pairs === 1;
}

/**
 * 手牌价值评估：面子数 * 100 + 对子/搭子 * 10。
 * 用于 AI 选弃牌。不做最优求解，但足够实用。
 */
function evaluate(counts) {
  const memo = new Map();
  const key = (c, idx) => idx + ':' + c.join(',');

  function dfs(c, i, sets, partials) {
    if (i >= 34) return sets * 100 + partials * 10;
    if (c[i] === 0) return dfs(c, i + 1, sets, partials);
    const k = key(c, i);
    if (memo.has(k)) return memo.get(k);

    let best = -1;
    // 刻子
    if (c[i] >= 3) {
      c[i] -= 3;
      best = Math.max(best, dfs(c, i, sets + 1, partials));
      c[i] += 3;
    }
    // 顺子
    const lo = LOCAL(i);
    if (lo >= 0 && lo <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      best = Math.max(best, dfs(c, i, sets + 1, partials));
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    // 对子（作将/搭子）
    if (c[i] >= 2) {
      c[i] -= 2;
      best = Math.max(best, dfs(c, i, sets, partials + 1));
      c[i] += 2;
    }
    // 两面/嵌张搭子
    if (lo >= 0 && lo <= 7 && c[i + 1] > 0) {
      c[i]--; c[i + 1]--;
      best = Math.max(best, dfs(c, i, sets, partials + 0.5));
      c[i]++; c[i + 1]++;
    }
    if (lo >= 0 && lo <= 6 && c[i + 2] > 0) {
      c[i]--; c[i + 2]--;
      best = Math.max(best, dfs(c, i, sets, partials + 0.5));
      c[i]++; c[i + 2]++;
    }
    // 单张弃掉
    best = Math.max(best, dfs(c, i + 1, sets, partials));

    memo.set(k, best);
    return best;
  }

  return dfs(counts.slice(), 0, 0, 0);
}

module.exports = {
  TILE_NAMES,
  tileName,
  newWall,
  countsOf,
  checkWin,
  waitingTiles,
  scoreWin,
  evaluate,
  HONORS,
  SUIT_OF,
  LOCAL,
};
