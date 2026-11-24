'use strict';

/**
 * 静态资源读取层
 *
 * 两种运行形态共用同一套代码：
 *   1) 源码运行（node server/index.js）  → 读项目里的 public/
 *   2) 单文件 exe（Node SEA）            → 读内嵌进 exe 的资源
 *
 * exe 形态下支持「逐文件覆盖」：exe 旁边的 public/ 里存在同名文件就用磁盘的，
 * 没有就回落到内嵌资源。所以只放一个改过的 style.css 也能生效，其余照常走内嵌。
 */

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/** SEA 运行时对象；false 表示当前不是 exe 形态 */
let seaApi;
function sea() {
  if (seaApi !== undefined) return seaApi;
  try {
    const m = require('node:sea');
    seaApi = m && typeof m.isSea === 'function' && m.isSea() ? m : false;
  } catch (e) {
    seaApi = false;
  }
  return seaApi;
}

/** exe 旁边的 public/ 目录（只有存在于磁盘时才算数）；源码形态直接用项目 public/ */
function diskDir() {
  const s = sea();
  if (!s) return PUBLIC_DIR;
  const beside = path.join(path.dirname(process.execPath), 'public');
  try {
    if (fs.statSync(beside).isDirectory()) return beside;
  } catch (e) { /* 没有就用内嵌资源 */ }
  return null;
}

/** 磁盘路径安全检查：必须落在 root 之内 */
function diskFile(dir, rel) {
  const file = path.join(dir, rel);
  const root = path.resolve(dir);
  const abs = path.resolve(file);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/**
 * 把请求路径规整成相对 public/ 的安全相对路径。
 * 反斜杠统一成正斜杠，去掉开头的 /、盘符与所有 ../ 片段。
 */
function normalize(relPath) {
  let rel = String(relPath == null ? '' : relPath).replace(/\\/g, '/');
  rel = rel.split('?')[0].split('#')[0];
  rel = rel.replace(/^[a-zA-Z]:/, '');
  rel = rel.replace(/^\/+/, '');
  rel = path.posix.normalize(rel);
  rel = rel.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
  if (!rel || rel === '.' || rel === '/') rel = 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  return rel;
}

function forbidden(rel) {
  const e = new Error('forbidden');
  e.code = 'FORBIDDEN';
  return e;
}

/** 是否越出根目录 */
function escapes(rel) {
  if (path.posix.isAbsolute(rel)) return true;
  if (rel.startsWith('..')) return true;
  return false;
}

/** 从内嵌资产取；不存在时返回 null */
function fromAsset(rel) {
  const s = sea();
  if (!s) return null;
  try {
    return Buffer.from(s.getAsset('public/' + rel));
  } catch (e) {
    return null;
  }
}

function notFound() {
  const e = new Error('not found');
  e.code = 'ENOENT';
  return e;
}

/**
 * 读取一个静态文件：磁盘优先（若存在 public/），缺失时回落内嵌资产。
 * @param {string} relPath 相对 public/ 的路径，如 'index.html' / 'js/app.js'
 * @param {(err: Error|null, buf?: Buffer) => void} cb
 */
function read(relPath, cb) {
  const rel = normalize(relPath);
  if (escapes(rel)) { cb(forbidden(rel)); return; }

  const dir = diskDir();
  if (!dir) {
    const buf = fromAsset(rel);
    if (buf) cb(null, buf); else cb(notFound());
    return;
  }

  const abs = diskFile(dir, rel);
  if (!abs) { cb(forbidden(rel)); return; }

  fs.readFile(abs, (err, buf) => {
    if (!err) { cb(null, buf); return; }
    if (err.code !== 'ENOENT' && err.code !== 'EISDIR' && err.code !== 'ENOTDIR') { cb(err); return; }
    const fallback = fromAsset(rel);
    if (fallback) cb(null, fallback); else cb(notFound());
  });
}

/** 同步读取，返回 Buffer；不存在时抛错 */
function readSync(relPath) {
  const rel = normalize(relPath);
  if (escapes(rel)) throw forbidden(rel);
  const dir = diskDir();
  if (dir) {
    const abs = diskFile(dir, rel);
    if (!abs) throw forbidden(rel);
    try {
      return fs.readFileSync(abs);
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'EISDIR' && e.code !== 'ENOTDIR') throw e;
    }
  }
  const buf = fromAsset(rel);
  if (buf) return buf;
  throw notFound();
}

function mimeFor(relPath) {
  return MIME[path.extname(String(relPath || '')).toLowerCase()] || 'application/octet-stream';
}

module.exports = { read, readSync, mimeFor, normalize, MIME, PUBLIC_DIR };
