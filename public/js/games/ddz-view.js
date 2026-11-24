'use strict';

/** 斗地主界面 */
window.DdzView = (function () {
  const UI = window.UI;
  let root = null;
  let state = null;
  let selected = new Set();
  let lastHandSig = '';

  function mount(container) {
    root = container;
    root.innerHTML = '';
    const wrap = UI.el('div', 'tableWrap');
    wrap.innerHTML = [
      '<div class="opponents">',
      '  <div class="pbox" data-seat="1"></div>',
      '  <div class="pbox" data-seat="2"></div>',
      '</div>',
      '<div class="bottomCards" id="ddzBottom"></div>',
      '<div class="multBar" id="ddzMult"></div>',
      '<div class="centerZone"><div class="playArea" id="ddzCenter"></div></div>',
      '<div class="eventFeed" id="ddzFeed"></div>',
      '<div class="myArea">',
      '  <div class="myInfo">',
      '    <span class="mineName" id="ddzMyName"></span>',
      '    <span id="ddzMyBadge"></span>',
      '    <span id="ddzMyScore"></span>',
      '  </div>',
      '  <div class="handScroll"><div class="handRow" id="ddzHand"></div></div>',
      '  <div class="actionBar" id="ddzActions"></div>',
      '</div>',
    ].join('');
    root.appendChild(wrap);

    // 点击手牌
    root.querySelector('#ddzHand').addEventListener('click', (e) => {
      const c = e.target.closest('.card');
      if (!c || c.dataset.id == null) return;
      if (!state || state.phase !== 'playing' || state.turn !== mySeat()) return;
      const id = Number(c.dataset.id);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      renderHand();
      updateActions();
    });
  }

  function mySeat() {
    return window.App.mySeat();
  }

  function seatBox(i) {
    return root && root.querySelector(`.pbox[data-seat="${i}"]`);
  }

  function setState(s) {
    const prevTurn = state ? state.turn : -1;
    state = s;
    if (s.phase !== 'playing' || s.turn !== mySeat()) {
      // 保留选牌，但不允许操作
    }
    if (prevTurn !== s.turn || s.phase !== 'bidding') {
      selected.clear();
    }
    render();
  }

  function render() {
    if (!root || !state) return;
    const me = mySeat();
    const seats = state.seats;

    // 对手（3 人局：其他两家）
    const opps = [1, 2].map((k) => (me + k) % 3);
    for (let k = 0; k < 2; k++) {
      const idx = opps[k];
      const box = seatBox(k + 1);
      if (!box) continue;
      const p = seats[idx];
      box.classList.toggle('active', state.turn === idx && state.phase !== 'finished');
      box.innerHTML = '';
      const nm = UI.el('div', 'pname');
      nm.appendChild(UI.el('span', null, p.name));
      if (p.isLandlord) nm.appendChild(UI.el('span', 'badge', '地主'));
      else if (state.landlord >= 0) nm.appendChild(UI.el('span', 'badge farmer', '农民'));
      box.appendChild(nm);
      box.appendChild(UI.el('div', 'pcount', String(p.count)));
      box.appendChild(UI.el('div', 'pscore', `积分 ${p.score}`));
      if (state.turn === idx && state.phase === 'playing') {
        box.appendChild(UI.el('div', 'think', '思考中…'));
      }
    }

    // 底牌
    const b = root.querySelector('#ddzBottom');
    b.innerHTML = '';
    if (state.bottom && state.bottom.length) {
      b.appendChild(UI.el('span', 'lbl', '底牌'));
      for (const c of state.bottom) b.appendChild(UI.cardEl(c, { small: true }));
    }

    // 倍数
    const mult = root.querySelector('#ddzMult');
    if (state.phase === 'playing' || state.phase === 'finished') {
      mult.textContent = `底分 ${state.base} · 倍数 ×${state.mult}`;
      mult.hidden = false;
    } else {
      mult.hidden = true;
    }

    // 中央出牌
    const center = root.querySelector('#ddzCenter');
    center.innerHTML = '';
    if (state.lastPlay && state.lastPlay.cards && state.lastPlay.cards.length) {
      const who = seats[state.lastPlay.seat] ? seats[state.lastPlay.seat].name : '';
      center.appendChild(UI.el('div', 'who', `${who} 出 · ${state.lastPlay.typeName}`));
      const row = UI.el('div', 'playedCards');
      for (const c of state.lastPlay.cards) row.appendChild(UI.cardEl(c, { small: true }));
      center.appendChild(row);
    } else if (state.phase === 'playing') {
      const tip = state.turn === me ? '轮到你出牌' : '等待出牌…';
      center.appendChild(UI.el('div', 'emptytable', tip));
    }

    // 我的信息
    const p0 = seats[me];
    root.querySelector('#ddzMyName').textContent = p0 ? p0.name : '';
    const badge = root.querySelector('#ddzMyBadge');
    badge.innerHTML = '';
    if (state.landlord >= 0) {
      badge.appendChild(UI.el('span', 'badge' + (p0 && p0.isLandlord ? '' : ' farmer'), p0 && p0.isLandlord ? '地主' : '农民'));
    }
    root.querySelector('#ddzMyScore').textContent = p0 ? `积分 ${p0.score}` : '';

    renderHand();
    updateActions();
    renderFeed();
  }

  function renderFeed() {
    if (!root) return;
    const feed = root.querySelector('#ddzFeed');
    if (!feed) return;
    feed.innerHTML = '';
    const logs = (window.App.eventsFor('ddz') || []).slice(-6);
    for (const l of logs) feed.appendChild(UI.el('div', null, l.label));
  }

  function renderHand() {
    const row = root.querySelector('#ddzHand');
    if (!row || !state) return;
    const hand = state.hand || [];
    const canAct = state.phase === 'playing' && state.turn === mySeat();
    const sig = hand.map((c) => c.id).join(',') + '|' + canAct + '|' + state.phase + '|' + Array.from(selected).sort().join(',');
    if (sig === lastHandSig) return;
    lastHandSig = sig;

    row.innerHTML = '';
    for (const c of hand) {
      const d = UI.cardEl(c, {
        sel: selected.has(c.id),
        dim: !canAct && state.phase === 'playing',
      });
      d.dataset.id = c.id;
      row.appendChild(d);
    }
  }

  function updateActions() {
    const bar = root.querySelector('#ddzActions');
    if (!bar || !state) return;
    bar.innerHTML = '';

    // 叫分
    if (state.phase === 'bidding' && state.bid.turn === mySeat()) {
      const panel = UI.el('div', 'bidPanel');
      panel.appendChild(UI.el('div', 'ttl', `叫分（当前最高 ${state.bid.best} 分）`));
      const row = UI.el('div', 'row');
      for (let v = 1; v <= 3; v++) {
        if (v <= state.bid.best) continue;
        const btn = UI.el('button', 'primary', `${v} 分`);
        btn.onclick = () => act({ type: 'bid', value: v });
        row.appendChild(btn);
      }
      const pass = UI.el('button', 'ghost', '不叫');
      pass.onclick = () => act({ type: 'bid', value: 0 });
      row.appendChild(pass);
      panel.appendChild(row);
      bar.appendChild(panel);
      return;
    }

    if (state.phase !== 'playing') return;
    if (state.turn !== mySeat()) {
      bar.appendChild(UI.el('div', 'emptytable', '等待其他玩家…'));
      return;
    }

    const sel = state.hand.filter((c) => selected.has(c.id));

    const btnHint = UI.el('button', 'ghost', '提示');
    // 提示永远可用：手里有牌就能推荐一手
    btnHint.disabled = !state.hand.length;
    btnHint.onclick = () => hint();

    const canPass = !!(state.lastPlay && state.lastPlay.seat !== mySeat());
    const btnPass = UI.el('button', 'ghost', '不要');
    btnPass.disabled = !canPass;
    btnPass.onclick = () => act({ type: 'pass' });

    const btnPlay = UI.el('button', 'primary', sel.length ? `出牌 (${sel.length})` : '出牌');
    btnPlay.disabled = !sel.length;
    btnPlay.onclick = () => {
      if (!sel.length) return;
      act({ type: 'play', cards: sel.map((c) => c.id) });
    };

    bar.appendChild(btnHint);
    bar.appendChild(btnPass);
    bar.appendChild(btnPlay);

    if (state.canBeatAny === false) {
      const tip = UI.el('div', 'emptytable', '（管不上了，建议不要）');
      bar.appendChild(tip);
    }
  }

  /** 提示：直接用服务端算好的建议 */
  function hint() {
    if (!state) return;
    if (state.suggest && state.suggest.length) {
      const ids = new Set(state.suggest);
      applySelect(state.hand.filter((c) => ids.has(c.id)));
      return;
    }
    if (state.canBeatAny === false) {
      UI.toast('这手牌管不上，建议不要');
      return;
    }
    // 兜底：手选最小单张
    const sorted = state.hand.slice().sort((a, b) => a.rank - b.rank);
    if (sorted.length) { applySelect([sorted[0]]); return; }
    UI.toast('没有可提示的牌');
  }

  function applySelect(cards) {
    selected = new Set(cards.map((c) => c.id));
    lastHandSig = '';
    renderHand();
    updateActions();
  }

  async function act(a) {
    const r = await window.Net.action(a);
    if (!r.ok) UI.toast(r.error || '操作失败', true);
    else { selected.clear(); lastHandSig = ''; }
  }

  function onEvent(ev) {
    if (!root) return;
    if (ev.name === 'bomb' || ev.name === 'spring') {
      UI.toast(ev.label, false);
    }
    renderFeed();
  }

  function unmount() { root = null; state = null; selected.clear(); lastHandSig = ''; }

  return { mount, setState, unmount, onEvent };
})();
