# 贡献指南

感谢你看这个项目。它是个人项目，节奏不快，但改动都欢迎。

## 环境

- **Node.js ≥ 22**（`node --version` 确认）。开发用 26.x，SEA 打包用 Node 自带的 `--build-sea`，不需要额外安装打包工具。
- Windows 是主要目标平台（单文件 exe 按 Windows 走的）。服务端与前端本身是跨平台的，Linux/macOS 下 `node server/index.js` 可以正常跑。
- 跑 `test/ui.test.js` 和 `tools/shot-home.js` 需要本机 Chrome 或 Edge，以及 `npm install`（会装 `playwright-core`）。**不装也不影响跑其它测试。**

## 本地跑起来

```bash
npm start                 # 源码方式启动，默认端口 11451
# 或
node server/index.js
```

改 `server/` 下的文件需要**重启服务**（没有热重载）；改 `public/` 下的文件浏览器刷新即可。

## 提交前

至少跑一遍不依赖浏览器的测试：

```bash
node test/rules.test.js    # 牌型与胡牌规则
node test/sim.test.js      # AI 对 AI 跑完整局（较慢，约 6~9 分钟）
```

改到接口或前端时，再补跑：

```bash
node server/index.js &            # 另开一个终端
node test/http.test.js            # 接口 + SSE
node test/ui.test.js              # 真实浏览器打完整局
```

## 代码约定

- **零运行时依赖**。`package.json` 里没有 `dependencies`，服务端只用 Node 内置模块。加第三方包之前请先说明理由。
- **服务端权威**。牌面和判定都在服务端，客户端只发动作、收状态。不要在客户端做规则判断或提前下发别人的手牌。
- 缩进 2 空格，CommonJS（`require` / `module.exports`），单引号，语句结尾带分号。
- 中文注释和中文界面文案是这个项目的既定风格，保持一致即可。
- 新建 `.js` 文件后跑一下 `node --check <file>`。

## 改界面

- 所有颜色、间距、字号都在 `public/css/style.css` 顶部的 `:root` 里，改一处即可整体换肤。
- 字号请取 **12 的倍数**（12 / 24 / 36），这是像素字体的设计网格；离开倍数笔画会发虚。
- 牌面纹理来自 `joker/` 里的素材，纸面贴片是 `public/img/paper-tile.png`（128×128）平铺。改纹理请从素材重新采样，不要凭空画渐变。
- `:root` 末尾有一组旧变量名别名（`--gold` / `--gold2` / `--ink2` / `--card` / `--radius`），视图脚本里有内联样式在用，不要删。
- 首页的矮屏收紧靠 `max-height: 880px / 740px / 640px` 三档断点，加内容后请复测 1366×768 是否还能一屏装下。

## 提交信息

用一句话说清改了什么，中文英文都行：

```
修复出牌区首张牌负边距导致整排左偏
日志补上打出的具体牌面
feat: 叫分面板四按钮等宽
```

## 报告问题

开 issue 时带上这些会快很多：

- 操作系统与浏览器版本
- 是源码运行还是单文件 exe
- 复现步骤（哪个游戏、几个人、第几轮）
- 服务端窗口打印的日志，浏览器 F12 控制台的报错
- 如果涉及界面，附一张截图
