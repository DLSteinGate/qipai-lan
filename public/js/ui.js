'use strict';

/** 通用 UI 工具 */
window.UI = (function () {
  const SUITS = ['♠', '♥', '♣', '♦'];
  const RANK_TXT = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: 'w', 17: 'W',
  };

  let toastTimer = null;

  function toast(msg, isErr) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = 'toast' + (isErr ? ' err' : '');
    }, 2200);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /** 生成一张扑克牌 DOM */
  function cardEl(card, opts) {
    const o = opts || {};
    const d = el('div', 'card');
    const red = card.suit === 1 || card.suit === 3;
    d.classList.add(red ? 'red' : 'black');
    if (o.small) d.classList.add('small');
    if (o.sel) d.classList.add('sel');
    if (o.dim) d.classList.add('dim');
    if (o.playable) d.classList.add('playable');
    if (o.scored) d.classList.add('scored');

    if (card.rank === 16 || card.rank === 17) {
      const big = card.rank === 17;
      d.classList.add('joker', big ? 'big' : 'sml');
      d.appendChild(el('div', 'jkpic'));
      if (big) { d.classList.remove('black'); d.classList.add('red'); }
      return d;
    }

    d.appendChild(el('div', 'r', RANK_TXT[card.rank] || '?'));
    d.appendChild(el('div', 's', SUITS[card.suit] || ''));
    return d;
  }

  function backCard(extra) {
    const d = el('div', 'card back');
    if (extra) d.classList.add(extra);
    return d;
  }

  function confirmBox(text) {
    return window.confirm(text);
  }

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
      return ok;
    }
  }

  return { toast, el, esc, cardEl, backCard, confirmBox, copyText, SUITS };
})();
