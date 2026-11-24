'use strict';

/** Fisher-Yates 洗牌，原地打乱并返回 */
function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function randomInt(n) {
  return Math.floor(Math.random() * n);
}

const ALPHABET = 'ACDEFGHJKLMNPQRSTUVWXY3456789';

function shortId(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** 稳定排序比较器 */
function cmpNum(a, b) {
  return a - b;
}

/** 从数组里按条件移除并返回被移除元素 */
function removeWhere(arr, fn) {
  const out = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (fn(arr[i], i)) out.push(arr.splice(i, 1)[0]);
  }
  return out.reverse();
}

module.exports = { shuffle, randomInt, shortId, cmpNum, removeWhere };
