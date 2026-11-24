'use strict';

/** 应用主控 */
window.App = (function () {
  const UI = window.UI;
  let name = '';
  let roomId = null;
  let game = null;
  let mySeatIdx = -1;
  let lobby = null;
  let lastState = null;
  let events = { ddz: [], mahjong: [] };
  let overlayDismissed = false;
  let showingResultFor = null;
  let activeView = null;

  const el = (id) => document.getElementById(id);
  const DEFAULT_NAME = '玩家';

  function mySeat() { return mySeatIdx; }
  function eventsFor(g) { return events[g] || []; }

  // ---------------- 启动 ----------------
  function init() {
    const saved = localStorage.getItem('qp_name') || '';
    el('inputName').value = saved;

    loadAddresses();

    document.querySelectorAll('[data-create]').forEach((b) => {
      b.onclick = () => createRoom(b.dataset.create);
    });
    el('btnQuick').onclick = quickPlay;
    el('btnJoin').onclick = joinRoom;
    el('inputRoom').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    el('inputRoom').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinRoom();
    });
    el('btnLeave').onclick = doLeave;
    el('btnAddAI').onclick = () => lobbyAct({ type: 'addAI' });
    el('btnRemoveAI').onclick = () => lobbyAct({ type: 'removeAI' });
    el('btnStart').onclick = () => lobbyAct({ type: 'start' });
    el('btnCopyRoom').onclick = async () => {
      const url = location.origin + '/?room=' + roomId;
      const ok = await UI.copyText(`房间号 ${roomId}\n${url}`);
      UI.toast(ok ? '已复制房间号和链接' : '复制失败', !ok);
    };

    // 支持 ?room=XXXX 直接进房
    const params = new URLSearchParams(location.search);
    const autoRoom = params.get('room');
    if (autoRoom) el('inputRoom').value = autoRoom.toUpperCase();

    // 网络事件
    window.Net.on('lobby', onLobby);
    window.Net.on('state', onGameState);
    window.Net.on('event', onGameEvent);
    window.Net.on('neterr', () => UI.toast('连接断开，正在重连…', true));
    window.Net.on('open', () => {});

    window.addEventListener('beforeunload', () => {
      window.Net.leave();
    });
    window.addEventListener('resize', () => {});
  }

  async function loadAddresses() {
    try {
      const r = await fetch('/api/info');
      const j = await r.json();
      const host = location.hostname;
      const list = el('addrList');
      list.innerHTML = '';
      const port = j.port || location.port || 80;
      const seen = new Set();
      const addrs = (j.addresses || []).map((a) => `http://${a.address}:${port}`);
      if (location.protocol.startsWith('http') && location.host) addrs.unshift(`http://${host}:${port}`);
      for (const a of addrs) {
        if (seen.has(a)) continue;
        seen.add(a);
        list.appendChild(UI.el('code', null, a));
      }
      if (!addrs.length) list.appendChild(UI.el('code', null, '未检测到局域网地址'));
    } catch (e) {
      el('addrList').textContent = '读取地址失败';
    }
  }

  // ---------------- 房间 ----------------
  async function createRoom(type) {
    const nm = readName();
    if (!nm) return;
    el('inputName').disabled = true;
    const r = await window.Net.create(type, nm);
    el('inputName').disabled = false;
    if (!r.ok) return UI.toast(r.error || '创建失败', true);
    enterRoom(r.game, r.roomId, r.seat);
  }

  /**
   * 一键开局：建房间 → 补满电脑 → 直接开始，落到牌桌。
   * 目的是让人打开页面就看见牌，而不是先面对一张表单。
   */
  async function quickPlay() {
    const btn = el('btnQuick');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.querySelector('small').textContent = '正在发牌…';
    try {
      const nm = readName();
      el('inputName').disabled = true;
      const r = await window.Net.create('ddz', nm);
      if (!r.ok) { UI.toast(r.error || '创建房间失败', true); return; }
      enterRoom(r.game, r.roomId, r.seat);
      // 补满其余座位：斗地主固定 3 人 = 自己 + 2 个电脑。
      // 只发需要的次数——多发一次服务端会回 400「位置满了」，控制台会留一条红字。
      const seats = 3;
      for (let i = 1; i < seats; i++) {
        const a = await window.Net.action({ type: 'addAI' });
        if (!a.ok) break;
      }
      const s = await window.Net.action({ type: 'start' });
      if (!s.ok) UI.toast(s.error || '开局失败', true);
    } catch (e) {
      UI.toast('开局失败：' + (e && e.message ? e.message : e), true);
    } finally {
      btn.disabled = false;
      btn.querySelector('small').textContent = '斗地主 · 和 2 个电脑打，不用等人';
      el('inputName').disabled = false;
    }
  }

  async function joinRoom() {
    const nm = readName();
    if (!nm) return;
    const id = el('inputRoom').value.trim().toUpperCase();
    if (!id) return UI.toast('请输入房间号', true);
    const r = await window.Net.join(id, nm);
    if (!r.ok) return UI.toast(r.error || '加入失败', true);
    enterRoom(r.game, r.roomId, r.seat);
  }

  function readName() {
    let v = el('inputName').value.trim();
    if (!v) {
      // 不给用户设卡：没填就用默认名，并把它填回输入框，让人知道自己叫什么
      v = DEFAULT_NAME;
      el('inputName').value = v;
    }
    if (v.length > 8) v = v.slice(0, 8);
    localStorage.setItem('qp_name', v);
    name = v;
    return v;
  }

  function enterRoom(g, rid, seat) {
    game = g;
    roomId = rid;
    mySeatIdx = seat;
    lobby = null;
    lastState = null;
    showingResultFor = null;
    for (const k in events) events[k] = [];
    el('screen-home').hidden = true;
    el('screen-lobby').hidden = false;
    el('screen-game').hidden = true;
    el('btnLeave').hidden = false;
    el('lobbyRoomId').textContent = rid;
    el('lobbyGame').textContent = g === 'ddz' ? '斗地主 · 经典 3 人' : '麻将 · 广东推倒胡';
    el('lobbyGame').dataset.game = g;
    updateTopBar();
  }

  function updateTopBar() {
    const info = el('roomInfo');
    info.innerHTML = '';
    if (roomId) {
      const c1 = UI.el('span', 'chip', `房间 ${roomId}`);
      info.appendChild(c1);
    }
    if (game) {
      info.appendChild(UI.el('span', 'chip', game === 'ddz' ? '斗地主' : '麻将'));
    }
    el('meInfo').textContent = name ? `我：${name}` : '';
  }

  function doLeave() {
    if (!UI.confirmBox('确定离开房间？')) return;
    window.Net.leave();
    roomId = null; game = null; mySeatIdx = -1; lobby = null; lastState = null;
    activeView = null;
    el('screen-game').hidden = true;
    el('screen-lobby').hidden = true;
    el('screen-home').hidden = false;
    el('btnLeave').hidden = true;
    el('overlay').hidden = true;
    el('roomInfo').innerHTML = '';
    el('meInfo').textContent = '';
    el('inputName').disabled = false;
    updateTopBar();
  }

  async function lobbyAct(a) {
    const r = await window.Net.action(a);
    if (!r.ok) UI.toast(r.error || '操作失败', true);
  }

  // ---------------- 大厅 ----------------
  function onLobby(msg) {
    if (!roomId) return;
    lobby = msg;
    if (msg.state === 'lobby') {
      el('screen-lobby').hidden = false;
      el('screen-game').hidden = true;
      renderLobby(msg);
    }
  }

  function renderLobby(m) {
    const grid = el('lobbySeats');
    grid.innerHTML = '';
    const cap = m.capacity || 3;
    for (let i = 0; i < cap; i++) {
      const p = m.players[i];
      const d = UI.el('div', 'seat' + (p ? ' occupied' : ''));
      d.appendChild(UI.el('div', 'seatNo', `#${i + 1}`));
      if (p) {
        d.appendChild(UI.el('div', 'avatar', p.isAI ? '🤖' : '🧑'));
        d.appendChild(UI.el('div', 'pname', p.name + (i === mySeatIdx ? '（我）' : '')));
        const tag = UI.el('div', 'ptag', p.isAI ? '电脑' : (p.connected ? '在线' : '离线'));
        if (p.isAI) tag.classList.add('ai');
        else if (!p.connected) tag.classList.add('off');
        d.appendChild(tag);
        if (m.state !== 'lobby' || p.score) d.appendChild(UI.el('div', 'ptag', `积分 ${p.score}`));
      } else {
        d.appendChild(UI.el('div', 'avatar', '➕'));
        d.appendChild(UI.el('div', 'pname', '空位'));
        d.appendChild(UI.el('div', 'ptag', '等待加入'));
      }
      grid.appendChild(d);
    }

    const aiCount = m.players.filter((p) => p.isAI).length;
    el('btnAddAI').disabled = m.players.length >= cap;
    el('btnRemoveAI').disabled = aiCount === 0;
    el('btnStart').disabled = !m.canStart;

    const need = Math.max(0, (m.minSeats || 3) - m.players.length);
    let tip = '';
    if (m.canStart) tip = '人齐了，可以开始';
    else if (need > 0) tip = `还差 ${need} 人，或点「补一个 AI」凑人数`;
    el('lobbyTip').textContent = tip;
  }

  // ---------------- 游戏 ----------------
  function onGameState(msg) {
    if (!roomId) return;
    if (msg.seat !== mySeatIdx) return;
    lastState = msg.state;

    if (!lastState) return;
    el('screen-lobby').hidden = true;
    el('screen-game').hidden = false;
    updateTopBar();

    if (activeView !== game || !document.getElementById('tableWrap')) {
      // 挂载视图
      const host = el('screen-game');
      host.innerHTML = '<div class="tableWrap" id="tableWrap"></div>';
      activeView = game;
      if (game === 'ddz') window.DdzView.mount(host.firstChild);
      else window.MahjongView.mount(host.firstChild);
    }

    if (game === 'ddz') window.DdzView.setState(lastState);
    else window.MahjongView.setState(lastState);

    maybeShowResult(lastState);
  }

  function onGameEvent(ev) {
    if (!game) return;
    events[game].push(ev);
    if (events[game].length > 40) events[game].shift();
    if (game === 'ddz') window.DdzView.onEvent(ev);
    else window.MahjongView.onEvent(ev);
  }

  // ---------------- 结算 ----------------
  function maybeShowResult(s) {
    const r = s && s.result;
    if (!r) { el('overlay').hidden = true; return; }
    const key = JSON.stringify(r.delta) + '|' + (r.winnerSeat ?? r.winner) + '|' + s.hand.length;
    if (showingResultFor === key) return;
    showingResultFor = key;
    showResult(s, r);
  }

  function showResult(s, r) {
    const card = el('overlayCard');
    card.innerHTML = '';
    el('overlay').hidden = false;

    const seats = s.seats;
    const me = mySeatIdx;
    const isDdz = s.game === 'ddz';

    const h = UI.el('h2');
    if (isDdz) {
      const iWin = (r.winner === 'landlord') === !!(seats[me] && seats[me].isLandlord);
      h.textContent = iWin ? '你赢了！' : '你输了';
      h.className = iWin ? 'win' : 'lose';
    } else {
      if (r.draw) { h.textContent = '流局'; }
      else {
        const iWin = r.winnerSeat === me;
        h.textContent = iWin ? '胡牌！' : `${r.winnerName} 胡牌`;
        h.className = iWin ? 'win' : 'lose';
      }
    }
    card.appendChild(h);

    const sub = UI.el('div', 'sub');
    if (isDdz) {
      sub.textContent = `底分 ${r.base} × 倍数 ${r.mult} = ${r.unit} 分/家`;
    } else {
      if (r.draw) sub.textContent = '牌墙摸完，本局无人胡牌';
      else sub.textContent = `${r.selfDraw ? '自摸' : '点炮'} · ${r.fan} 番 · 每家 ${r.score} 分`;
    }
    card.appendChild(sub);

    if (!isDdz && r.fans) {
      const fl = UI.el('div', 'fanList');
      for (const f of String(r.fans).split(' + ')) fl.appendChild(UI.el('span', null, f));
      card.appendChild(fl);
    }

    // 分数表
    const tb = UI.el('table', 'scoreTable');
    const thead = UI.el('thead');
    const trh = UI.el('tr');
    trh.appendChild(UI.el('th', null, '玩家'));
    trh.appendChild(UI.el('th', null, '本局'));
    trh.appendChild(UI.el('th', null, '总分'));
    thead.appendChild(trh);
    tb.appendChild(thead);
    const tbody = UI.el('tbody');
    seats.forEach((p, i) => {
      const tr = UI.el('tr');
      if (i === me) tr.classList.add('me');
      tr.appendChild(UI.el('td', null, p.name + (i === me ? '（我）' : '')));
      const d = (r.delta && r.delta[i]) || 0;
      const td = UI.el('td', d > 0 ? 'pos' : d < 0 ? 'neg' : '', (d > 0 ? '+' : '') + d);
      tr.appendChild(td);
      tr.appendChild(UI.el('td', null, String(p.score)));
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody);
    card.appendChild(tb);

    // 亮牌
    const rv = UI.el('div', 'revealHands');
    if (isDdz) {
      (r.hands || []).forEach((hand, i) => {
        const row = UI.el('div', 'revealRow');
        row.appendChild(UI.el('span', 'ttl', seats[i].name));
        const cs = UI.el('div', 'cards');
        if (!hand.length) cs.appendChild(UI.el('span', null, '（已出完）'));
        for (const c of hand) cs.appendChild(UI.cardEl(c, { small: true }));
        row.appendChild(cs);
        rv.appendChild(row);
      });
    } else {
      (r.hands || []).forEach((hand, i) => {
        const row = UI.el('div', 'revealRow');
        row.appendChild(UI.el('span', 'ttl', seats[i].name));
        const cs = UI.el('div', 'cards');
        for (const t of hand) cs.appendChild(window.MahjongView.tileEl(t.t, { size: 'xs' }));
        row.appendChild(cs);
        rv.appendChild(row);
      });
    }
    card.appendChild(rv);

    // 按钮
    const btnRow = UI.el('div', 'overlayBtns');

    const again = UI.el('button', 'primary big2', '再来一局');
    again.onclick = async () => {
      const r2 = await window.Net.action({ type: 'nextRound' });
      if (!r2.ok) return UI.toast(r2.error || '失败', true);
      el('overlay').hidden = true;
      showingResultFor = null;
      activeView = null;
      el('screen-game').hidden = true;
      el('screen-lobby').hidden = false;
    };
    btnRow.appendChild(again);

    const back = UI.el('button', 'ghost', '离开房间');
    back.onclick = () => { el('overlay').hidden = true; doLeave(); };
    btnRow.appendChild(back);

    card.appendChild(btnRow);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { mySeat, eventsFor, init };
})();
