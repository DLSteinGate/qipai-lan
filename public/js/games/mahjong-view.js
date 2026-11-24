'use strict';

/** 麻将界面（广东推倒胡） */
window.MahjongView = (function () {
  const UI = window.UI;
  let root = null;
  let state = null;
  let selectedId = null;
  let chosenChi = null;
  let lastSig = '';

  const HONOR_TXT = ['东', '南', '西', '北', '中', '发', '白'];

  function mount(container) {
    root = container;
    root.innerHTML = '';
    const wrap = UI.el('div', 'mjTable');
    wrap.innerHTML = [
      '<div id="mjTop"></div>',
      '<div id="mjLeft"></div>',
      '<div id="mjRight"></div>',
      '<div class="mjCenter" id="mjCenter"></div>',
      '<div class="eventFeed" id="mjFeed"></div>',
      '<div class="mjHand" id="mjHand"></div>',
      '<div class="mjActions" id="mjActions"></div>',
    ].join('');
    root.appendChild(wrap);

    root.querySelector('#mjHand').addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t || t.dataset.id == null) return;
      if (!state || state.phase !== 'playing') return;
      if (state.turn !== mySeat() || state.claim || state.awaiting !== 'discard') return;
      const id = Number(t.dataset.id);
      selectedId = selectedId === id ? null : id;
      lastSig = '';
      render();
    });
  }

  function mySeat() {
    return window.App.mySeat();
  }

  function tileText(t) {
    if (t < 9) return (t + 1) + '万';
    if (t < 18) return (t - 8) + '条';
    if (t < 27) return (t - 17) + '筒';
    return HONOR_TXT[t - 27];
  }

  function tileClass(t) {
    if (t < 27) return '';
    const i = t - 27;
    if (i === 4) return 'honor red';
    if (i === 5) return 'honor';
    if (i === 6) return 'honor';
    return 'honor';
  }

  function tileEl(t, opts) {
    const o = opts || {};
    const d = UI.el('div', 'tile' + (o.size ? ' ' + o.size : '') + ' ' + tileClass(t));
    d.appendChild(UI.el('span', null, tileText(t)));
    if (o.sel) d.classList.add('sel');
    if (o.drawn) d.classList.add('drawn');
    if (o.dim) d.classList.add('dim');
    if (o.id != null) d.dataset.id = o.id;
    return d;
  }

  function backEl(size) {
    const d = UI.el('div', 'tile back' + (size ? ' ' + size : ''));
    d.appendChild(UI.el('span'));
    return d;
  }

  function setState(s) {
    state = s;
    render();
  }

  /** 计算每个座位在屏幕上的方位 */
  function seatPositions(n) {
    // [下(自己), 右, 上, 左]
    if (n === 2) return ['bottom', 'top'];
    if (n === 3) return ['bottom', 'right', 'left'];
    return ['bottom', 'right', 'top', 'left'];
  }

  function render() {
    if (!root || !state) return;
    const me = mySeat();
    const n = state.playerCount;
    const positions = seatPositions(n);

    // 清空对手区
    ['mjTop', 'mjLeft', 'mjRight'].forEach((id) => {
      const e = root.querySelector('#' + id);
      if (e) e.innerHTML = '';
    });

    for (let i = 0; i < n; i++) {
      if (i === me) continue;
      const rel = (i - me + n) % n;
      const pos = positions[rel];
      if (!pos || pos === 'bottom') continue;
      const host = root.querySelector('#mj' + pos.charAt(0).toUpperCase() + pos.slice(1));
      // 2 人局没有左右两侧容器，跳过即可
      if (!host) continue;
      host.appendChild(opponentBox(i, pos));
    }

    renderCenter();
    renderHand();
    renderActions();
    renderFeed();
  }

  function opponentBox(i, pos) {
    const p = state.seats[i];
    const box = UI.el('div', 'mjOpp ' + pos);
    if (state.turn === i && state.phase === 'playing') box.classList.add('active');

    const nm = UI.el('div', 'pname');
    nm.textContent = p.name + (p.isDealer ? ' · 庄' : '');
    box.appendChild(nm);
    box.appendChild(UI.el('div', 'stat', `手牌 ${p.count} · 积分 ${p.score}`));

    // 副露
    if (p.melds && p.melds.length) {
      const mw = UI.el('div', 'melds');
      for (const m of p.melds) {
        const g = UI.el('div', 'mjMeldGroup');
        const tiles = m.hidden ? m.tiles.map((_, k) => (k === 1 || k === 2 ? null : null)) : m.tiles;
        if (m.hidden) {
          for (let k = 0; k < m.tiles.length; k++) g.appendChild(backEl('xs'));
        } else {
          for (const t of m.tiles) g.appendChild(tileEl(t.t, { size: 'xs' }));
        }
        mw.appendChild(g);
      }
      box.appendChild(mw);
    }

    // 牌背示意
    const backs = UI.el('div', 'mjBacks');
    const show = Math.min(p.count, 13);
    for (let k = 0; k < show; k++) backs.appendChild(UI.el('div', 'mjBack'));
    box.appendChild(backs);

    // 弃牌区
    if (pos === 'top' || pos === 'left' || pos === 'right') {
      const dw = UI.el('div', 'mjDiscards');
      const ds = (p.discards || []).slice(-12);
      for (const t of ds) dw.appendChild(tileEl(t.t, { size: 'xs' }));
      if (ds.length) box.appendChild(dw);
    }

    return box;
  }

  function renderCenter() {
    const c = root.querySelector('#mjCenter');
    c.innerHTML = '';
    const wall = UI.el('div', 'wallInfo');
    const dealerName = state.seats[state.dealer] ? state.seats[state.dealer].name : '';
    wall.innerHTML = `<b>${state.wallCount}</b>剩余牌<br>庄家：${UI.esc(dealerName)}`;
    c.appendChild(wall);

    if (state.lastDiscard) {
      const d = state.lastDiscard;
      const row = UI.el('div', 'mjLast');
      row.appendChild(UI.el('span', null, `最新打出（${state.seats[d.seat].name}）`));
      row.appendChild(tileEl(d.tile.t));
      c.appendChild(row);
    }

    // 自己的弃牌
    if (state.seats[mySeat()] && state.seats[mySeat()].discards.length) {
      const dw = UI.el('div', 'mjDiscards');
      for (const t of state.seats[mySeat()].discards.slice(-18)) dw.appendChild(tileEl(t.t, { size: 'xs' }));
      c.appendChild(dw);
    }
  }

  function renderHand() {
    const host = root.querySelector('#mjHand');
    if (!host || !state) return;
    const hand = state.hand || [];
    const sig = hand.map((t) => t.id).join(',') + '|' + selectedId + '|' + state.turn + '|' + state.phase + '|' + (state.claim ? 1 : 0);
    if (sig === lastSig) return;
    lastSig = sig;

    host.innerHTML = '';
    const canPick = state.phase === 'playing' && state.turn === mySeat() && !state.claim && state.awaiting === 'discard';
    const drawnId = state.lastDrawn ? state.lastDrawn.id : null;

    // 副露（自己）
    const myMelds = state.seats[mySeat()] ? state.seats[mySeat()].melds : [];
    if (myMelds.length) {
      const mw = UI.el('div', 'mjMelds');
      mw.classList.add('inHand');
      for (const m of myMelds) {
        const g = UI.el('div', 'mjMeldGroup');
        if (m.hidden) {
          for (let k = 0; k < m.tiles.length; k++) g.appendChild(backEl('sm'));
        } else {
          for (const t of m.tiles) g.appendChild(tileEl(t.t, { size: 'sm' }));
        }
        mw.appendChild(g);
      }
      host.appendChild(mw);
    }

    for (const t of hand) {
      const e = tileEl(t.t, {
        sel: selectedId === t.id,
        drawn: t.id === drawnId,
        id: t.id,
      });
      if (!canPick) e.classList.add('dim');
      host.appendChild(e);
    }
  }

  function renderActions() {
    const bar = root.querySelector('#mjActions');
    if (!bar || !state) return;
    bar.innerHTML = '';
    if (state.phase !== 'playing') return;

    const me = mySeat();

    // 响应别人的牌
    if (state.claim) {
      const cl = state.claim;
      const wrap = UI.el('div', 'claimBox');

      wrap.appendChild(UI.el('span', 'claimWho', `${state.seats[cl.from].name} 打出 ${tileText(cl.tile.t)}`));

      for (const opt of cl.options) {
        if (opt.type === 'hu') {
          const b = UI.el('button', 'primary', '胡');
          b.onclick = () => act({ type: 'claim', claim: 'hu' });
          wrap.appendChild(b);
        }
        if (opt.type === 'gang') {
          const b = UI.el('button', 'ghost', '杠');
          b.onclick = () => act({ type: 'claim', claim: 'gang' });
          wrap.appendChild(b);
        }
        if (opt.type === 'peng') {
          const b = UI.el('button', 'ghost', '碰');
          b.onclick = () => act({ type: 'claim', claim: 'peng' });
          wrap.appendChild(b);
        }
        if (opt.type === 'chi') {
          for (const combo of opt.combos) {
            const label = '吃 ' + combo.map((r) => tileText(r)).join('');
            const b = UI.el('button', 'ghost', label);
            b.onclick = () => act({ type: 'claim', claim: 'chi', combo });
            wrap.appendChild(b);
          }
        }
      }
      const pass = UI.el('button', 'ghost', '过');
      pass.onclick = () => act({ type: 'claim', claim: 'pass' });
      wrap.appendChild(pass);
      bar.appendChild(wrap);
      return;
    }

    if (state.turn !== me) return;

    const acts = state.actions || [];
    const wrap = UI.el('div', 'actWrap');

    for (const a of acts) {
      if (a.type === 'zimo') {
        const b = UI.el('button', 'primary', '自摸胡！');
        b.onclick = () => act({ type: 'zimo' });
        wrap.appendChild(b);
      }
      if (a.type === 'angang') {
        const b = UI.el('button', 'ghost', '暗杠 ' + a.name);
        b.onclick = () => act({ type: 'gang', rank: a.rank });
        wrap.appendChild(b);
      }
      if (a.type === 'bugang') {
        const b = UI.el('button', 'ghost', '补杠 ' + a.name);
        b.onclick = () => act({ type: 'gang', rank: a.rank });
        wrap.appendChild(b);
      }
    }

    const btn = UI.el('button', 'primary', selectedId != null ? '打出' : '选一张牌');
    btn.disabled = selectedId == null;
    btn.onclick = () => {
      if (selectedId == null) return;
      act({ type: 'discard', tileId: selectedId });
      selectedId = null;
    };
    wrap.appendChild(btn);
    bar.appendChild(wrap);
  }

  function renderFeed() {
    if (!root) return;
    const feed = root.querySelector('#mjFeed');
    if (!feed) return;
    feed.innerHTML = '';
    for (const l of (window.App.eventsFor('mahjong') || []).slice(-6)) {
      feed.appendChild(UI.el('div', null, l.label));
    }
  }

  async function act(a) {
    const r = await window.Net.action(a);
    if (!r.ok) UI.toast(r.error || '操作失败', true);
    else { selectedId = null; lastSig = ''; }
  }

  function onEvent(ev) {
    if (ev.name === 'win' || ev.name === 'peng' || ev.name === 'gang' || ev.name === 'angang') {
      // 轻度提示，不打断
    }
    renderFeed();
  }

  function unmount() {
    root = null; state = null; selectedId = null; lastSig = '';
  }

  return { mount, setState, unmount, onEvent, tileText, tileEl };
})();
