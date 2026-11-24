'use strict';

/**
 * SEA 引导层：单文件 exe 的真入口。
 *
 * Node 的单文件应用（SEA）只把入口脚本编进 exe，内嵌的其它文件只能当「资产」
 * 取出来。这里给 require 打一个补丁，把资产当成模块加载，于是 server/ 下那套
 * 源码一行都不用改就能跑。
 *
 * 资产命名约定（见 tools/build-sea.js）：
 *   app/server/xxx.js  →  模块 "sea:app/server/xxx.js"
 *   public/xxx         →  静态资源，由 server/static.js 直接读取
 */

const Module = require('module');
const path = require('path');

const sea = require('node:sea');

if (!sea.isSea()) {
  // 直接 node tools/sea-bootstrap.js 跑的时候就退回源码模式
  require(path.join(__dirname, '..', 'server', 'index.js'));
  return;
}

const KEY_PREFIX = 'sea:';
const keys = new Set(sea.getAssetKeys());

/** 把 "app/server/util" 这类相对名解析成真实资产 key，找不到返回 null */
function findKey(rel) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  const cands = [clean, clean + '.js', clean + '/index.js'];
  for (const c of cands) {
    if (keys.has(c)) return c;
  }
  return null;
}

function notFound(request, parent) {
  const e = new Error("Cannot find module '" + request + "'" +
    (parent && parent.id ? '\nRequire stack:\n- ' + parent.id : ''));
  e.code = 'MODULE_NOT_FOUND';
  return e;
}

const isSeaSpec = (r) => typeof r === 'string' && r.startsWith(KEY_PREFIX);

function isBuiltin(r) {
  if (typeof Module.isBuiltin === 'function') return Module.isBuiltin(r);
  return typeof r === 'string' && (r.startsWith('node:') || require('module').builtinModules.includes(r));
}

function resolveSea(request, parent) {
  if (isSeaSpec(request)) {
    const key = findKey(request.slice(KEY_PREFIX.length));
    if (!key) throw notFound(request, parent);
    return KEY_PREFIX + key;
  }
  // 内置模块（http/path/fs…）交回 Node 自己处理
  if (isBuiltin(request)) return null;
  if (parent && isSeaSpec(parent.id || '')) {
    const base = path.posix.dirname(parent.id.slice(KEY_PREFIX.length));
    const joined = path.posix.normalize(path.posix.join(base, request));
    const key = findKey(joined);
    if (key) return KEY_PREFIX + key;
    throw notFound(request, parent);
  }
  return null;
}

// ---- 1. 解析阶段 ----
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  const hit = resolveSea(request, parent);
  if (hit) return hit;
  return origResolve.call(this, request, parent, isMain, options);
};

// ---- 2. 加载阶段 ----
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (isSeaSpec(request)) {
    const key = request.slice(KEY_PREFIX.length);
    const cached = Module._cache[request];
    if (cached) return cached.exports;
    if (!keys.has(key)) throw notFound(request, parent);

    const m = new Module(request, parent);
    m.filename = request;
    m.paths = [];
    Module._cache[request] = m;

    const src = sea.getAsset(key, 'utf8');
    m._compile(src, request);
    m.loaded = true;
    return m.exports;
  }

  // 资产模块里 require 相对路径 → 先尝试当成资产
  if (parent && isSeaSpec(parent.id || '')) {
    const hit = resolveSea(request, parent);
    if (hit) return Module._load(hit, parent, isMain);
  }

  return origLoad.call(this, request, parent, isMain);
};

// ---- 3. 跑真正的服务端 ----
Module._load(KEY_PREFIX + 'app/server/index.js', null, true);
