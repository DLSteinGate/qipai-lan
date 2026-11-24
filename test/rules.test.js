'use strict';

/** 规则自测：node test/rules.test.js */
const R = require('../server/games/ddz-rules');
const M = require('../server/games/mahjong-rules');

let pass = 0, fail = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fail++;
  failures.push(`${label}\n   期望: ${b}\n   实际: ${a}`);
}

function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(label);
}

/** 用点数数组构造牌对象 */
function cards(...ranks) {
  const pool = R.newDeck();
  const used = new Set();
  return ranks.map((r) => {
    const c = pool.find((x) => x.rank === r && !used.has(x.id));
    if (!c) throw new Error('没有足够的 ' + r);
    used.add(c.id);
    return c;
  });
}

function id(...ranks) {
  const info = R.identify(cards(...ranks));
  return info ? info.type : null;
}

console.log('=== 斗地主牌型 ===');
eq(id(3), 'single', '单张');
eq(id(15, 15), 'pair', '对2');
eq(id(7, 7, 7), 'triple', '三张');
eq(id(7, 7, 7, 4), 'triple1', '三带一');
eq(id(7, 7, 7, 4, 4), 'triple2', '三带二');
eq(id(3, 4, 5, 6, 7), 'straight', '顺子 34567');
eq(id(3, 4, 5, 6), null, '四张不是顺子');
eq(id(11, 12, 13, 14, 15), null, '含2不是顺子');
eq(id(10, 11, 12, 13, 14), 'straight', '10JQKA 顺子');
eq(id(3, 3, 4, 4, 5, 5), 'doubleStraight', '连对 334455');
eq(id(3, 3, 4, 4), null, '两对不是连对');
eq(id(3, 3, 3, 4, 4, 4), 'plane', '飞机 333444');
eq(id(3, 3, 3, 4, 4, 4, 5, 6), 'plane1', '飞机带两单');
eq(id(3, 3, 3, 4, 4, 4, 5, 5, 6, 6), 'plane2', '飞机带两对');
eq(id(9, 9, 9, 9), 'bomb', '炸弹');
eq(id(16, 17), 'rocket', '王炸');
eq(id(9, 9, 9, 9, 3, 4), 'four2single', '四带二单');
eq(id(9, 9, 9, 9, 3, 3, 4, 4), 'four2pair', '四带两对');
eq(id(9, 9, 9, 9, 3, 3, 3, 3), null, '四带两对不能是炸弹对');
eq(id(15, 15, 15, 3), 'triple1', '三个2带3');
eq(id(15, 15, 15, 16, 17), null, '大小王不算一对，非法三带二');
ok(R.identify([{ id: -1, rank: 2, suit: 0 }]) === null, '不存在的点数 2 应返回 null');

console.log('=== 斗地主大小 ===');
const B = (a, b) => R.beats(R.identify(a), R.identify(b));
ok(B(cards(4), cards(3)), '4 > 3');
ok(B(cards(15), cards(14)), '2 > A');
ok(B(cards(17), cards(15)), '大王 > 2');
ok(!B(cards(3), cards(4)), '3 不能压 4');
ok(B(cards(3, 3), cards(3)) === false, '对子不能压单张');
ok(B(cards(9, 9, 9, 9), cards(15)), '炸弹压单张');
ok(B(cards(16, 17), cards(9, 9, 9, 9)), '王炸压炸弹');
ok(!B(cards(9, 9, 9, 9), cards(16, 17)), '炸弹压不了王炸');
ok(B(cards(10, 10), cards(9, 9)), '对10 > 对9');
ok(!B(cards(10, 10, 10, 3, 3), cards(9, 9, 9, 4, 4)) === false, '三带二比三张部分');
ok(B(cards(10, 10, 10, 3, 3), cards(9, 9, 9, 14, 14)), '三带二比三张部分而非带牌');
ok(B(cards(4, 5, 6, 7, 8), cards(3, 4, 5, 6, 7)), '顺子比最大');
ok(!B(cards(4, 5, 6, 7, 8, 9), cards(3, 4, 5, 6, 7)), '顺子长度不同不能压');

console.log('=== 斗地主枚举 ===');
const hand = cards(3, 3, 4, 5, 6, 7, 8, 9, 9, 9, 15, 16, 17, 13, 13, 13, 13);
const all = R.genAll(hand);
ok(all.length > 10, `枚举出 ${all.length} 种，应 > 10`);
ok(all.every((m) => R.identify(m.cards)), '枚举出来的都能被识别');
ok(all.some((m) => m.info.type === 'rocket'), '枚举含王炸');
ok(all.some((m) => m.info.type === 'bomb'), '枚举含炸弹');
ok(!all.some((m) => m.info.type === 'plane'), '手牌只有一组三张，不应有飞机');

console.log('=== 麻将：标准胡 ===');
function cnt(...tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) c[t]++;
  return c;
}
// 111 234 567 789 + 99 万（t=0 为 1万）
const WIN1 = [0, 0, 0, 1, 2, 3, 4, 5, 6, 6, 7, 8, 8, 8];
const h1 = cnt(...WIN1);
eq(M.checkWin(h1, 0).win, true, '111 234 567 789 + 99 应该胡');
eq(M.checkWin(h1, 0).style, 'standard', '标准型');

// 七对
const h2 = cnt(0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6);
eq(M.checkWin(h2, 0).style, 'sevenPairs', '七小对');

// 十三幺
const h3 = cnt(0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33, 0);
eq(M.checkWin(h3, 0).style, 'thirteen', '十三幺');

// 差一张不胡：111 234 568 999 + 12（不成立）
const h4 = cnt(0, 0, 0, 1, 2, 4, 4, 7, 7, 7, 10, 12, 4, 7);
eq(M.checkWin(h4, 0).win, false, '111234568999+4 应为不胡');

// 已碰 2 组，剩 8 张
const h5 = cnt(0, 1, 2, 3, 4, 5, 9, 9);
eq(M.checkWin(h5, 2).win, true, '2 副露 + 012345 + 99 应胡');

console.log('=== 麻将：听牌 ===');
const h6 = cnt(0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4);
const wait = M.waitingTiles(h6, 0);
ok(wait.includes(4), `13 张应听 5 万，实际听 ${wait.map(M.tileName).join('')}`);

console.log('=== 麻将：算番 ===');
const sc1 = M.scoreWin({ handTiles: [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 1], melds: [], style: 'standard', selfDraw: false, dealer: false });
ok(sc1.fan >= 1, `平胡 ${sc1.fan} 番`);
eq(sc1.names.length >= 1, true, '有番名');

const sc2 = M.scoreWin({ handTiles: [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 1], melds: [], style: 'standard', selfDraw: true, dealer: false });
eq(sc2.fan, sc1.fan + 1, '自摸 +1 番');

const sc3 = M.scoreWin({ handTiles: [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 3], melds: [], style: 'standard', selfDraw: false, dealer: false });
ok(sc3.names.includes('清一色'), '全万子应为清一色');

const sc4 = M.scoreWin({ handTiles: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4], melds: [], style: 'standard', selfDraw: false, dealer: false });
ok(sc4.names.includes('清碰'), `全刻子+清一色应为清碰，实际 ${sc4.names.join(',')}`);

console.log('=== 麻将：AI 评估 ===');
const good = M.evaluate(cnt(0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 1));
const bad = M.evaluate(cnt(0, 3, 7, 10, 14, 20, 27, 31, 2, 9, 16, 22, 29, 33));
ok(good > bad, `好牌(${good}) 应优于烂牌(${bad})`);

console.log('');
if (fail) {
  console.log(`❌ ${fail} 个失败 / ${pass + fail} 个用例`);
  for (const f of failures) console.log('  • ' + f);
  process.exit(1);
} else {
  console.log(`✅ 全部通过：${pass} 个用例`);
}
