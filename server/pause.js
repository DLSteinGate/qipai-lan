'use strict';

/**
 * 双击运行单文件 exe 时，进程一结束 Windows 就会把控制台窗口关掉，
 * 报错信息一闪而过。这里在退出前阻塞等待回车，把信息留在屏幕上。
 *
 * 只有 exe 形态才这么做：源码运行时窗口本来就是用户自己开的终端，
 * 启动失败直接退出反而更符合预期（脚本、CI 也不会被卡住）。
 */

const fs = require('fs');

let packaged;
/** 当前是不是被打包成单文件 exe 在跑 */
function isPackaged() {
  if (packaged !== undefined) return packaged;
  try {
    packaged = require('node:sea').isSea();
  } catch (e) {
    packaged = false;
  }
  return packaged;
}

let waiting = false;

/**
 * 退出前暂停，等用户按回车。
 * @param {string} [reason] 补一句说明，通常为空（具体错误前面已经打印过）
 */
function holdConsole(reason) {
  if (!isPackaged() || waiting) return;
  waiting = true;

  if (reason) {
    console.log('');
    console.log('  ' + reason);
  }
  console.log('');
  console.log('  按回车键关闭窗口…');

  try {
    // 同步读一个字节即可：回车算一行，足够让窗口停住
    fs.readSync(0, Buffer.alloc(1), 0, 1, null);
  } catch (e) {
    // stdin 不可读（被重定向成管道、没有控制台）：不阻塞，直接返回
  }
  waiting = false;
}

module.exports = { isPackaged, holdConsole };
