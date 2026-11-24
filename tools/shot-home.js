'use strict';
/**
 * 重截首页截图：把「局域网地址」列表替换成中性示例，避免把真实内网 IP 留在文档配图里。
 * node tools/shot-home.js
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const cands = [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Bin\\chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return undefined;
}

const BASE = process.env.BASE || 'http://127.0.0.1:11451';
const OUT = path.join(__dirname, '..', 'docs', 'screens', 'shot-home.png');

(async () => {
  const b = await chromium.launch({ executablePath: findChrome() });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  // 用示例地址覆盖真实地址
  await p.evaluate(() => {
    const list = document.getElementById('addrList');
    if (!list) return;
    list.innerHTML = '';
    for (const s of ['http://127.0.0.1:11451', 'http://192.168.1.10:11451', 'http://10.0.0.5:11451']) {
      const c = document.createElement('code');
      c.textContent = s;
      list.appendChild(c);
    }
  });
  await p.waitForTimeout(200);
  await p.screenshot({ path: OUT });
  await b.close();
  console.log('saved', OUT, fs.statSync(OUT).size, 'bytes');
})();
