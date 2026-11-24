'use strict';

/**
 * 全自动对局模拟：让 AI 打完整局，检查流程不卡死、数据不崩。
 * node test/sim.test.js
 */

const { DdzGame } = require('../server/games/ddz');
const { MahjongGame } = require('../server/games/mahjong');

let fail = 0;
const errs = [];

function assert(cond, msg) {
  if (!cond) { fail++; errs.push(msg); }
}

// ---------- 斗地主 ----------
async function simDdz(games) {
  let finished = 0;
  let bombs = 0;
  let redeals = 0;

  for (let g = 0; g < games; g++) {
    let states = 0;
    let events = 0;
    let bombSeen = 0;
    let redealSeen = 0;

    const players = [0, 1, 2].map((i) => ({ id: 'p' + i, name: 'AI' + i, isAI: true, pid: 'p' + i }));
    const game = new DdzGame(players, (msg) => {
      if (msg.type === 'state') states++;
      if (msg.type === 'event') {
        events++;
        if (msg.name === 'bomb') bombSeen++;
        if (msg.name === 'redeal') redealSeen++;
        if (msg.name === 'landlord') assert(msg.seat >= 0 && msg.seat <= 2, '地主座位越界');
      }
    }, () => 0);

    game.deal();

    // 等待 AI 把整局打完（AI 有 setTimeout 延时）
    const deadline = Date.now() + 90000;
    while (game.phase !== 'finished' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 30));
      // 死锁检测：状态长时间不推进
    }

    if (game.phase !== 'finished') {
      assert(false, `第 ${g + 1} 局斗地主没有在 90 秒内结束（phase=${game.phase}, turn=${game.turn}）`);
      break;
    }

    assert(!!game.result, `第 ${g + 1} 局没有结算结果`);
    if (game.result) {
      const d = game.result.delta;
      assert(d.length === 3, 'delta 长度应为 3');
      const sum = d.reduce((a, b) => a + b, 0);
      assert(sum === 0, `第 ${g + 1} 局分数不守恒：${sum}`);
      assert(d.some((x) => x > 0) && d.some((x) => x < 0), '应有正负分');
      // 手牌总数检查
      const totalLeft = game.result.hands.reduce((a, h) => a + h.length, 0);
      assert(totalLeft >= 0 && totalLeft <= 54, '剩余手牌数异常');
    }

    finished++;
    bombs += bombSeen;
    redeals += redealSeen;
    assert(states > 5, '状态推送过少');
  }

  console.log(`  斗地主：${finished}/${games} 局完成，炸弹 ${bombs} 次，重发 ${redeals} 次`);
  return finished;
}

// ---------- 麻将 ----------
async function simMahjong(games, playerCount) {
  let finished = 0;
  let wins = 0;
  let draws = 0;

  for (let g = 0; g < games; g++) {
    const players = [];
    for (let i = 0; i < playerCount; i++) players.push({ id: 'm' + i, name: 'AI' + i, isAI: true, pid: 'm' + i });

    const game = new MahjongGame(players, (msg) => {
      if (msg.type === 'state') assert(msg.state.hand.length >= 0, '手牌数异常');
    }, () => 0);

    game.start(g % playerCount);

    // 初始手牌数量检查
    assert(game.hands[game.dealer].length === 14, `庄家应 14 张，实际 ${game.hands[game.dealer].length}`);
    for (let i = 0; i < playerCount; i++) {
      if (i === game.dealer) continue;
      assert(game.hands[i].length === 13, `闲家应 13 张，实际 ${game.hands[i].length}`);
    }
    assert(game.wall.length === 136 - 13 * playerCount - 1, `牌墙数量应为 ${136 - 13 * playerCount - 1}，实际 ${game.wall.length}`);

    const deadline = Date.now() + 180000;
    while (game.phase !== 'finished' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 30));
    }

    if (game.phase !== 'finished') {
      assert(false, `第 ${g + 1} 局麻将(${playerCount}人)超时：phase=${game.phase} turn=${game.turn} wall=${game.wall.length} claim=${!!game.claim}`);
      break;
    }

    assert(!!game.result, '麻将没有结算结果');
    if (game.result) {
      const d = game.result.delta;
      assert(d.length === playerCount, 'delta 长度应对应人数');
      const sum = d.reduce((a, b) => a + b, 0);
      assert(sum === 0, `麻将第 ${g + 1} 局分数不守恒：${sum}`);
      if (game.result.draw) draws++;
      else {
        wins++;
        assert(game.result.fan >= 1, '胡牌番数应 >= 1');
        assert(game.result.score >= 1, '胡牌得分应 >= 1');
      }
    }
    finished++;
  }

  console.log(`  麻将 ${playerCount} 人：${finished}/${games} 局完成（胡 ${wins} / 流局 ${draws}）`);
  return finished;
}

(async () => {
  console.log('=== 对局模拟 ===');
  process.env.NODE_NO_TIMEOUT = '1';

  const ddzDone = await simDdz(6);
  assert(ddzDone === 6, `斗地主只完成 ${ddzDone}/6 局`);

  const mj3 = await simMahjong(4, 3);
  assert(mj3 === 4, `3 人麻将只完成 ${mj3}/4 局`);

  const mj4 = await simMahjong(3, 4);
  assert(mj4 === 3, `4 人麻将只完成 ${mj4}/3 局`);

  const mj2 = await simMahjong(3, 2);
  assert(mj2 === 3, `2 人麻将只完成 ${mj2}/3 局`);

  console.log('');
  if (fail) {
    console.log(`❌ ${fail} 个问题`);
    for (const e of errs.slice(0, 20)) console.log('  • ' + e);
    process.exit(1);
  } else {
    console.log('✅ 对局模拟全部通过');
    process.exit(0);
  }
})();
