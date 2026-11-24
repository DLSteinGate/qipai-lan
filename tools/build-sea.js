'use strict';

/**
 * 把整个项目打包成单文件 exe（Node 内置 SEA，不需要 npm / postject）。
 *
 *   用法：  node tools/build-sea.js  [输出名]
 *   产物：  局域网棋牌室.exe          （项目根目录）
 *
 * 打进 exe 的内容：
 *   - server/ 下所有 .js  → 资产 key "app/server/..."
 *   - public/ 下所有文件  → 资产 key "public/..."
 *
 * 运行期由 tools/sea-bootstrap.js 提供的模块加载器接管 require，
 * 所以 exe 里跑的还是原来那套源码，不用改任何业务代码。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_NAME = process.argv[2] || '局域网棋牌室.exe';
const TMP = path.join(ROOT, '.sea-build');

function walk(dir, filter, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(full, filter, base, out);
    } else if (filter(full)) {
      out.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

function main() {
  const nodeExe = process.execPath;
  console.log('  打包器：' + nodeExe);

  // ---- 收集要内嵌的文件 ----
  const serverFiles = walk(path.join(ROOT, 'server'), (f) => f.endsWith('.js'));
  const publicFiles = walk(path.join(ROOT, 'public'), () => true);
  if (!serverFiles.length) throw new Error('server/ 下没找到 .js');
  if (!publicFiles.length) throw new Error('public/ 下没找到文件');

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const assets = {};
  for (const rel of serverFiles) {
    assets['app/server/' + rel] = path.join(ROOT, 'server', rel);
  }
  for (const rel of publicFiles) {
    assets['public/' + rel] = path.join(ROOT, 'public', rel);
  }

  // ---- bootstrap（exe 的真入口）----
  const entry = path.join(TMP, 'sea-entry.js');
  fs.copyFileSync(path.join(__dirname, 'sea-bootstrap.js'), entry);

  // ---- sea 配置 ----
  const outAbs = path.join(ROOT, OUT_NAME);
  const cfgPath = path.join(TMP, 'sea-config.json');
  const cfg = {
    main: entry,
    output: outAbs,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets,
  };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

  console.log('  内嵌：server ' + serverFiles.length + ' 个，public ' + publicFiles.length + ' 个');

  // ---- 生成 ----
  const r = spawnSync(nodeExe, ['--build-sea=' + cfgPath], { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error('--build-sea 失败，退出码 ' + r.status);
  }
  if (!fs.existsSync(outAbs)) throw new Error('没生成出 ' + outAbs);

  const mb = (fs.statSync(outAbs).size / 1048576).toFixed(1);
  console.log('');
  console.log('  完成：' + outAbs + '  (' + mb + ' MB)');
  console.log('');

  fs.rmSync(TMP, { recursive: true, force: true });
}

try {
  main();
} catch (e) {
  console.error('  打包失败：' + (e && e.message));
  process.exit(1);
}
