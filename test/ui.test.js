'use strict';
/**
 * 完整对局 UI 测试：真人（脚本代打）+ 2 个 AI，从开局打到大结局，验证结算界面。
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

/** 找本机 Chrome：CHROME_PATH 优先，其次常见安装位置，最后交给 Playwright 自动探测 */
function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Bin\\chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return undefined; // 交给 playwright-core 自己找
}
const CH = findChrome();
const BASE = process.env.BASE || 'http://127.0.0.1:11451';

/** 截图一律写到 docs/screens/，别把 PNG 撒在项目根 */
const SHOT_DIR = path.join(__dirname, '..', 'docs', 'screens');
const SHOT = (name) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, name);
};

async function createAndStart(page, game) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('#inputName', '真人');
  await page.click(`[data-create=${game}]`);
  await page.waitForSelector('#screen-lobby:not([hidden])', { timeout: 10000 });
}

async function fillAI(page, count) {
  for (let i = 0; i < count; i++) {
    await page.click('#btnAddAI');
    await page.waitForTimeout(250);
  }
}

/** 点“出牌”按钮（精确前缀匹配，避免匹配到工具栏其它按钮） */
async function clickAction(page, texts) {
  return page.evaluate((list) => {
    const btns = [...document.querySelectorAll('#ddzActions button, #mjActions button')];
    for (const t of list) {
      const b = btns.find((x) => x.textContent.trim().startsWith(t) && !x.disabled);
      if (b) { b.click(); return b.textContent.trim(); }
    }
    return null;
  }, texts);
}

async function playDdz(page) {
  let plays = 0, passes = 0, bids = 0;
  for (let i = 0; i < 2000; i++) {
    const s = await page.evaluate(() => ({
      overlay: !document.getElementById('overlay').hidden,
      lobby: !document.getElementById('screen-lobby').hidden,
      bidPanel: !!document.querySelector('.bidPanel'),
      bidVals: [...document.querySelectorAll('.bidPanel .row button')].map((x) => x.textContent.trim()),
      sel: document.querySelectorAll('#ddzHand .card.sel').length,
      actBtns: [...document.querySelectorAll('#ddzActions button')].map((x) => ({
        t: x.textContent.trim(), d: x.disabled,
      })),
    }));
    if (s.overlay || s.lobby) return { plays, passes, bids, ended: s.overlay };

    if (s.bidPanel) {
      const pick = s.bidVals.includes('3 分') ? '3 分'
        : s.bidVals.includes('2 分') ? '2 分'
        : s.bidVals.includes('1 分') ? '1 分' : '不叫';
      await page.evaluate((txt) => {
        const b = [...document.querySelectorAll('.bidPanel button')].find((x) => x.textContent.trim() === txt);
        if (b) b.click();
      }, pick);
      bids++;
      await page.waitForTimeout(450);
      continue;
    }

    // 判断是否真的轮到自己：提示按钮可用 + 手牌没变灰
    const myTurn = s.actBtns.some((x) => x.t === '提示' && !x.d);
    if (myTurn) {
      if (s.sel === 0) {
        await clickAction(page, ['提示']);
        await page.waitForTimeout(220);
      }
      const selNow = await page.evaluate(() => document.querySelectorAll('#ddzHand .card.sel').length);
      if (selNow > 0) {
        const r = await clickAction(page, ['出牌']);
        if (r) plays++;
        else {
          // 提示给的牌打不出去（理论上不该发生），退化为不要
          const r2 = await clickAction(page, ['不要']);
          if (r2) passes++;
        }
      } else {
        const r2 = await clickAction(page, ['不要']);
        if (r2) passes++;
      }
      await page.waitForTimeout(330);
      continue;
    }
    await page.waitForTimeout(250);
  }
  return { plays, passes, bids, ended: false, timeout: true };
}

async function playMahjong(page) {
  let discards = 0, claims = 0;
  let lastProg = 0, idle = 0;
  for (let i = 0; i < 3000; i++) {
    if (discards + claims === lastProg) idle++; else { idle = 0; lastProg = discards + claims; }
    if (idle > 150) {
      console.log('麻将卡住：连续 150 轮（约 60s）无动作');
      return { discards, claims, ended: false, stuck: true };
    }
    const s = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#mjActions button')].map((x) => ({ t: x.textContent.trim(), d: x.disabled }));
      return {
        overlay: !document.getElementById('overlay').hidden,
        lobby: !document.getElementById('screen-lobby').hidden,
        claimBtns: btns,
        // 响应面板一定带「过」按钮；自己回合的操作条只有「打出/选一张牌」等
        hasClaim: btns.some((x) => x.t === '过'),
        canDiscard: btns.some((x) => /^(打出|选一张牌)$/.test(x.t)),
        tiles: document.querySelectorAll('#mjHand .tile[data-id]').length,
        picked: document.querySelectorAll('#mjHand .tile.sel').length,
        done: document.querySelectorAll('#mjHand .tile.dim').length,
      };
    });
    if (s.overlay || s.lobby) return { discards, claims, ended: s.overlay };

    // 响应面板（胡/碰/杠/吃/过）
    if (s.hasClaim) {
      // 有胡就胡，否则过
      const hu = s.claimBtns.find((x) => x.t === '胡' && !x.d);
      const target = hu ? '胡' : '过';
      const ok = await page.evaluate((t) => {
        const b = [...document.querySelectorAll('#mjActions button')].find((x) => x.textContent.trim().startsWith(t) && !x.disabled);
        if (b) { b.click(); return true; }
        return false;
      }, target);
      if (ok) claims++;
      await page.waitForTimeout(450);
      continue;
    }

    // 打牌
    if (s.canDiscard && s.tiles > 0) {
      // 选一张牌
      await page.evaluate(() => {
        const list = [...document.querySelectorAll('#mjHand .tile[data-id]')];
        if (list.length) list[list.length - 1].click();
      });
      await page.waitForTimeout(180);
      const ok = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#mjActions button')].find((x) => x.textContent.trim() === '打出' && !x.disabled);
        if (b) { b.click(); return true; }
        return false;
      });
      if (ok) discards++;
      await page.waitForTimeout(420);
      continue;
    }
    await page.waitForTimeout(320);
  }
  return { discards, claims, ended: false, timeout: true };
}

(async () => {
  const b = await chromium.launch({ executablePath: CH });  const errors = [];

  // ---------- 斗地主 ----------
  if (process.env.SKIP_DDZ !== '1') {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    p.on('pageerror', (e) => errors.push('[ddz] PAGEERROR: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('[ddz] ' + m.text()); });

    await createAndStart(p, 'ddz');
    await p.screenshot({ path: SHOT('shot-lobby.png') });
    await fillAI(p, 2);
    await p.screenshot({ path: SHOT('shot-lobby-ai.png') });
    await p.click('#btnStart');
    await p.waitForTimeout(1500);
    await p.screenshot({ path: SHOT('shot-ddz-bid.png') });

    const r = await playDdz(p);
    await p.waitForTimeout(600);
    await p.screenshot({ path: SHOT('shot-ddz-end.png') });

    const fin = await p.evaluate(() => ({
      overlay: !document.getElementById('overlay').hidden,
      title: document.querySelector('#overlayCard h2')?.textContent || null,
      rows: [...document.querySelectorAll('.scoreTable tbody tr')].map((x) => [...x.children].map((c) => c.textContent).join(' | ')),
      reveals: document.querySelectorAll('.revealRow').length,
      sub: document.querySelector('#overlayCard .sub')?.textContent || null,
    }));
    console.log('斗地主：', JSON.stringify(r), '→', JSON.stringify(fin));
    if (!r.ended) errors.push('[ddz] 对局没有结束（超时）');
    if (fin.reveals !== 3) errors.push('[ddz] 结算应展示 3 家手牌，实际 ' + fin.reveals);
    if (!fin.rows.length) errors.push('[ddz] 结算缺少分数表');
    await p.close();
  }

  // ---------- 麻将 ----------
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    p.on('pageerror', (e) => errors.push('[mj] PAGEERROR: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('[mj] ' + m.text()); });

    await createAndStart(p, 'mahjong');
    await fillAI(p, 3);
    await p.screenshot({ path: SHOT('shot-mj-lobby.png') });
    await p.click('#btnStart');
    await p.waitForTimeout(1800);
    await p.screenshot({ path: SHOT('shot-mj-play.png') });

    const r = await playMahjong(p);
    await p.waitForTimeout(600);
    await p.screenshot({ path: SHOT('shot-mj-end.png') });

    const fin = await p.evaluate(() => ({
      overlay: !document.getElementById('overlay').hidden,
      title: document.querySelector('#overlayCard h2')?.textContent || null,
      rows: [...document.querySelectorAll('.scoreTable tbody tr')].map((x) => [...x.children].map((c) => c.textContent).join(' | ')),
      fans: [...document.querySelectorAll('.fanList span')].map((x) => x.textContent),
      reveals: document.querySelectorAll('.revealRow').length,
      sub: document.querySelector('#overlayCard .sub')?.textContent || null,
    }));
    console.log('麻将：', JSON.stringify(r), '→', JSON.stringify(fin));
    if (!r.ended) errors.push('[mj] 对局没有结束（超时）');
    if (fin.reveals !== 4) errors.push('[mj] 结算应展示 4 家手牌，实际 ' + fin.reveals);
    await p.close();
  }

  await b.close();
  console.log('');
  if (errors.length) {
    console.log('❌ 问题：');
    for (const e of errors) console.log('  • ' + e);
    process.exit(1);
  }
  console.log('✅ UI 全流程通过');
})();
