/**
 * 斗地主 table UI. Renders the personalised view the room sends to this seat and turns taps into
 * actions. Works the same for solo games, hosting and guests: everything goes through RoomClient.
 */

import { analyzeAll, analyzeCards, canBeat, hintPlays, rankOf } from './engine.js';
import { backHtml, cardHtml } from './cards.js';
import { createSfx, playCallout, PASS_CALLOUTS } from './sfx.js';
import { hapticTap, isNativeApp } from '../../core/platform.js';

const EMOTES = [
  '快出牌呀，茶都凉了',
  '这手牌打得漂亮！',
  '再来一局，今晚不散',
  '队友配合得真好',
  '手气来了挡不住',
  '网络有点卡，等等我',
  '我先离开一下，马上回来',
  '今天先到这，下次再战',
];

const BID_TEXT = { call: '叫地主', nocall: '不叫', rob: '抢地主', norob: '不抢' };
const FX_TEXT = { bomb: '炸弹', rocket: '王炸', plane: '飞机', plane1: '飞机', plane2: '飞机', straight: '顺子', pairStraight: '连对' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * @param {HTMLElement} root  .ddz-root
 * @param {object} session    {client, host, solo}
 * @param {object} o          {audio, toast, storage, onExit}
 */
export function mountTable(root, session, o) {
  const { client, host, solo } = session;
  const prefs = { voice: true, counter: false, ...o.storage.get('table_prefs', {}) };
  const sfx = createSfx(o.audio, prefs);
  const savePrefs = () => o.storage.set('table_prefs', prefs);

  const el = document.createElement('div');
  el.className = 'ddz-table';
  el.innerHTML = `
    <div class="ddz-probe"></div>
    <div class="ddz-topbar">
      <button class="ddz-pill" data-a="exit">← 退出</button>
      <div class="ddz-info"><i class="ddz-net"></i><span data-r="room"></span><span>倍数 <b data-r="mult">×1</b></span></div>
      <div class="ddz-top-right">
        <button class="ddz-pill" data-a="counter">记牌器</button>
        <button class="ddz-pill" data-a="emote">💬</button>
        <button class="ddz-pill" data-a="auto">托管</button>
        <button class="ddz-pill" data-a="settings">⚙︎</button>
      </div>
    </div>
    <div class="ddz-bottom" data-r="bottom"></div>
    <div class="ddz-counter hidden" data-r="counter"></div>
    <div class="ddz-seat left" data-pos="2"></div>
    <div class="ddz-seat right" data-pos="1"></div>
    <div class="ddz-seat me" data-pos="0"></div>
    <div class="ddz-played" data-played="0"></div>
    <div class="ddz-played" data-played="1"></div>
    <div class="ddz-played" data-played="2"></div>
    <div data-r="bubbles"></div>
    <div class="ddz-actions" data-r="actions"></div>
    <div class="ddz-hand" data-r="hand"></div>
    <div class="ddz-fx" data-r="fx"></div>
    <div class="ddz-banner" data-r="banner"></div>
    <div class="ddz-overlay hidden" data-r="overlay"></div>`;
  root.appendChild(el);

  const $ = (sel) => el.querySelector(sel);
  const R = (name) => el.querySelector(`[data-r="${name}"]`);
  const probe = $('.ddz-probe');
  const handLayer = R('hand');
  const handEls = new Map();
  const selected = new Set();
  let L = null;
  let view = client.view;
  let hintIdx = -1;
  let hintList = null;
  let resultShownFor = -1;
  let dealing = false;
  let freshIds = new Set();
  let destroyed = false;
  let lastTurnSeat = -2;
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!destroyed) fn();
    }, ms);
    timers.add(t);
    return t;
  };

  const me = () => client.seat;
  const posOf = (seat) => (seat - me() + 3) % 3;
  const seatAt = (pos) => (me() + pos) % 3;
  const seatInfo = (seat) => client.seats[seat] || { name: '', avatar: '🙂', kind: 'empty' };
  const myAuto = () => Boolean(client.seats[me()]?.auto);

  // ---------- layout ----------

  function computeLayout() {
    const W = el.clientWidth;
    const H = el.clientHeight;
    const ps = getComputedStyle(probe);
    const safe = { t: parseFloat(ps.paddingTop) || 0, r: parseFloat(ps.paddingRight) || 0, b: parseFloat(ps.paddingBottom) || 0, l: parseFloat(ps.paddingLeft) || 0 };
    const land = W >= H * 1.05;
    let ch = land ? clamp(H * 0.28, 68, 168) : clamp(Math.min(H * 0.16, W * 0.3), 64, 150);
    const avail = W - safe.l - safe.r - 20;
    // 20 cards must fit with each card showing at least ~30% of its width.
    const maxCw = avail / (1 + 19 * 0.3);
    let cw = Math.min(Math.round(ch * 0.7), Math.floor(maxCw));
    ch = Math.round(cw / 0.7);
    const mh = Math.round(ch * (land ? 0.62 : 0.56));
    const mw = Math.round(mh * 0.7);
    const bh = Math.round(clamp(mh * 0.78, 40, 72));
    const bw = Math.round(bh * 0.7);
    const top = safe.t + 6;
    const barH = 36;
    const handY = H - safe.b - (land ? 6 : 12) - ch;
    L = { W, H, land, safe, top, barH, cw, ch, mw, mh, bw, bh, avail, handY, seatY: top + barH + (land ? 10 : 16) };
    for (const [k, v] of Object.entries({ cw, ch, mw, mh, bw, bh })) el.style.setProperty(`--${k}`, `${v}px`);

    const bar = $('.ddz-topbar');
    bar.style.top = `${top}px`;
    bar.style.padding = `0 ${safe.r + 10}px 0 ${safe.l + 10}px`;

    const seatW = 84;
    const left = el.querySelector('.ddz-seat[data-pos="2"]');
    const right = el.querySelector('.ddz-seat[data-pos="1"]');
    const mine = el.querySelector('.ddz-seat[data-pos="0"]');
    left.style.left = `${safe.l + 10}px`;
    left.style.top = `${L.seatY}px`;
    right.style.right = `${safe.r + 10}px`;
    right.style.top = `${L.seatY}px`;
    mine.style.left = `${safe.l + 10}px`;
    mine.style.top = `${Math.max(L.seatY + 120, handY - (land ? 102 : 110))}px`;

    // Played-card anchors: [x, y, align]
    const sideX = safe.l + 10 + seatW + 44;
    if (land) {
      L.anchors = [
        [W / 2, handY - 62 - mh, 'center'],
        [W - sideX, L.seatY + 6, 'right'],
        [sideX, L.seatY + 6, 'left'],
      ];
      L.sideMax = W / 2 - sideX - 70;
    } else {
      L.anchors = [
        [W / 2, handY - 64 - mh, 'center'],
        [W - safe.r - 12, L.seatY + 118, 'right'],
        [safe.l + 12, L.seatY + 118, 'left'],
      ];
      L.sideMax = W * 0.62;
    }
    L.actionsY = handY - 56;

    const bottom = R('bottom');
    bottom.style.left = `${W / 2}px`;
    bottom.style.top = `${top + barH + 6}px`;
    const counter = R('counter');
    counter.style.left = `${W / 2}px`;
    counter.style.top = `${top + barH + bh + 14}px`;
    const actions = R('actions');
    actions.style.top = `${L.actionsY}px`;
    const banner = R('banner');
    banner.style.top = `${top + barH + bh + 16}px`;
  }

  // ---------- rendering ----------

  function renderAll() {
    if (!L || !view) return;
    renderInfo();
    renderSeats();
    renderBottom();
    renderCounter();
    renderPlayed();
    renderHand();
    renderActions();
    renderBubbles();
  }

  function renderInfo() {
    R('room').textContent = `${solo ? '单机' : `房间 ${client.code}`} · 第${view.handNo}局`;
    R('mult').textContent = `×${view.multiplier || 1}`;
    const net = $('.ddz-net');
    net.style.display = solo ? 'none' : '';
    net.classList.toggle('bad', client.status !== 'connected');
    const autoBtn = $('[data-a="auto"]');
    autoBtn.classList.toggle('on', myAuto());
    $('[data-a="counter"]').classList.toggle('on', prefs.counter);
  }

  function renderSeats() {
    for (let pos = 0; pos < 3; pos++) {
      const seat = seatAt(pos);
      const s = seatInfo(seat);
      const box = el.querySelector(`.ddz-seat[data-pos="${pos}"]`);
      const role = view.landlord < 0 ? '' : seat === view.landlord ? '地主' : '农民';
      const count = view.counts?.[seat] ?? 0;
      const tag = s.kind === 'human' && !s.connected ? '掉线' : s.auto ? '托管' : s.kind === 'bot' ? '电脑' : '';
      const score = view.scores?.[seat] ?? 0;
      box.classList.toggle('turn', view.phase !== 'over' && view.turn === seat);
      box.innerHTML = `
        <div class="ddz-ava">${esc(s.avatar || '🙂')}<span class="ddz-role ${role === '地主' ? 'lord' : ''}">${role}</span></div>
        <div class="ddz-name">${esc(s.name || '')}</div>
        <div class="ddz-score">积分 ${score > 0 ? '+' : ''}${score}</div>
        <div class="ddz-tag">${tag}</div>
        ${pos === 0 ? '' : `<div class="ddz-count ${view.phase === 'playing' && count > 0 && count <= 2 ? 'warn' : ''}">${count}</div>`}`;
    }
  }

  function renderBottom() {
    const box = R('bottom');
    const known = view.bottom && view.bottom.length === 3;
    const html = known ? view.bottom.map((id) => cardHtml(id)).join('') : view.phase === 'over' ? '' : [0, 1, 2].map(() => backHtml()).join('');
    if (box.dataset.sig !== html) {
      box.innerHTML = html;
      box.dataset.sig = html;
    }
  }

  function renderCounter() {
    const box = R('counter');
    box.classList.toggle('hidden', !prefs.counter);
    if (!prefs.counter) return;
    const seen = new Array(15).fill(0);
    for (const id of view.playedCards || []) seen[rankOf(id)]++;
    for (const id of view.hand || []) seen[rankOf(id)]++;
    const labels = ['大王', '小王', '2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'];
    const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    box.innerHTML = ranks
      .map((r, i) => {
        const left = (r >= 13 ? 1 : 4) - seen[r];
        return `<div class="${left ? '' : 'zero'}"><span>${labels[i]}</span><b>${left}</b></div>`;
      })
      .join('');
  }

  function layoutCards(container, ids, anchor, maxW, cls = '') {
    const [ax, ay, align] = anchor;
    const n = ids.length;
    let step = L.mw * 0.42;
    if (n > 1 && L.mw + step * (n - 1) > maxW) step = Math.max(10, (maxW - L.mw) / (n - 1));
    const total = n ? L.mw + step * (n - 1) : 0;
    const x0 = align === 'center' ? ax - total / 2 : align === 'right' ? ax - total : ax;
    container.style.left = `${x0}px`;
    container.style.top = `${ay}px`;
    container.style.width = `${total}px`;
    container.classList.toggle('reveal', cls === 'reveal');
    container.innerHTML = ids.map((id, i) => cardHtml(id).replace('class="pk', `style="left:${Math.round(i * step)}px;top:0" class="pk`)).join('');
  }

  function renderPlayed() {
    for (let pos = 0; pos < 3; pos++) {
      const seat = seatAt(pos);
      const box = el.querySelector(`[data-played="${pos}"]`);
      const maxW = pos === 0 ? L.W * 0.8 : L.sideMax;
      if (view.phase === 'over' && view.result && pos !== 0) {
        layoutCards(box, view.result.hands?.[seat] || [], L.anchors[pos], maxW, 'reveal');
        continue;
      }
      const act = view.phase === 'playing' || view.phase === 'over' ? view.trick?.actions?.[seat] : null;
      const sig = act && act !== 'pass' ? `${seat}:${act.cards.join(',')}` : '';
      if (box.dataset.sig === sig) continue;
      box.dataset.sig = sig;
      if (act && act !== 'pass') layoutCards(box, act.cards, L.anchors[pos], maxW);
      else box.innerHTML = '';
    }
  }

  function bubbleFor(seat) {
    if (view.phase === 'bidding') {
      const hist = view.bidding?.history || [];
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].seat !== seat) continue;
        const a = hist[i].action;
        if (a.type === 'bid') return { text: a.score ? `${a.score}分` : '不叫', pass: !a.score };
        return { text: BID_TEXT[a.type] || '', pass: a.type === 'nocall' || a.type === 'norob' };
      }
      return null;
    }
    if (view.phase === 'playing' && view.trick?.actions?.[seat] === 'pass') return { text: '不出', pass: true };
    return null;
  }

  function renderBubbles() {
    const box = R('bubbles');
    const parts = [];
    for (let pos = 0; pos < 3; pos++) {
      const seat = seatAt(pos);
      const b = bubbleFor(seat);
      const [ax, ay, align] = L.anchors[pos];
      const y = ay + L.mh / 2 - 18;
      if (b) {
        const style = align === 'center' ? `left:${ax}px;top:${y}px;transform:translateX(-50%)` : align === 'right' ? `right:${L.W - ax}px;top:${y}px` : `left:${ax}px;top:${y}px`;
        parts.push(`<div class="ddz-bubble ${b.pass ? 'pass' : ''}" style="${style}">${b.text}</div>`);
      }
      if (view.phase !== 'over' && view.turn === seat && !(pos === 0 && !myAuto())) {
        const cx = align === 'center' ? ax - 20 : align === 'right' ? ax - 40 : ax;
        parts.push(`<div class="ddz-clock" style="left:${cx}px;top:${y + (b ? 40 : 0)}px">⏰</div>`);
      }
    }
    box.innerHTML = parts.join('');
  }

  function handPositions(n) {
    let step = n > 1 ? Math.min(L.cw * 0.56, (L.avail - L.cw) / (n - 1)) : 0;
    step = Math.max(step, 8);
    const total = L.cw + step * Math.max(0, n - 1);
    const x0 = (L.W - total) / 2;
    return { x0, step };
  }

  function renderHand() {
    const ids = view.hand || [];
    const keep = new Set(ids);
    for (const [id, node] of handEls) {
      if (!keep.has(id)) {
        node.remove();
        handEls.delete(id);
        selected.delete(id);
      }
    }
    const { x0, step } = handPositions(ids.length);
    const fresh = [];
    ids.forEach((id, i) => {
      let node = handEls.get(id);
      if (!node) {
        const wrap = document.createElement('div');
        wrap.innerHTML = cardHtml(id);
        node = wrap.firstElementChild;
        handLayer.appendChild(node);
        handEls.set(id, node);
        if (dealing) {
          node.classList.add('dealing');
          node.style.left = `${L.W / 2 - L.cw / 2}px`;
          node.style.top = `${L.top + L.barH}px`;
          node.style.opacity = '0';
          fresh.push([node, i]);
        }
      }
      node.style.zIndex = String(i + 1);
      node.classList.toggle('sel', selected.has(id));
      node.classList.toggle('fresh', freshIds.has(id));
      if (!fresh.length || !fresh.find((f) => f[0] === node)) {
        node.style.left = `${x0 + i * step}px`;
        node.style.top = `${L.handY}px`;
      }
    });
    // keep DOM order = display order so overlaps stack left to right
    ids.forEach((id) => handLayer.appendChild(handEls.get(id)));
    if (fresh.length) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          fresh.forEach(([node, i]) => {
            node.style.transitionDelay = `${i * 28}ms`;
            node.style.opacity = '1';
            node.style.left = `${x0 + i * step}px`;
            node.style.top = `${L.handY}px`;
          });
          later(() => fresh.forEach(([node]) => {
            node.classList.remove('dealing');
            node.style.transitionDelay = '';
          }), 28 * fresh.length + 450);
        }),
      );
    }
  }

  // ---------- actions ----------

  function followCombo() {
    const last = view.trick?.last;
    return last && last.seat !== me() ? last.combo : null;
  }

  function selectionPlayable() {
    const ids = [...selected];
    if (!ids.length) return false;
    const prev = followCombo();
    if (!prev) return Boolean(analyzeCards(ids));
    return analyzeAll(ids).some((c) => canBeat(c, prev));
  }

  function btn(label, color, act, disabled = false) {
    return `<button class="ddz-btn ${color}" data-act="${act}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  }

  function renderActions() {
    const box = R('actions');
    let html = '';
    const myTurn = view.phase !== 'over' && view.turn === me();
    if (myAuto()) {
      html = btn('取消托管', 'blue', 'unauto');
    } else if (myTurn && view.phase === 'bidding') {
      const stage = view.bidding?.stage;
      if (view.bidMode === 'score' || stage === 'score') {
        const high = view.bidding?.highScore || 0;
        html = btn('不叫', 'gray', 'bid:0') + [1, 2, 3].map((s) => btn(`${s}分`, 'orange', `bid:${s}`, s <= high)).join('');
      } else if (stage === 'rob') {
        html = btn('不抢', 'gray', 'norob') + btn('抢地主', 'orange', 'rob');
      } else {
        html = btn('不叫', 'gray', 'nocall') + btn('叫地主', 'orange', 'call');
      }
    } else if (myTurn && view.phase === 'playing') {
      const prev = followCombo();
      if (!hintList) hintList = hintPlays(view.hand, prev);
      if (prev && !hintList.length) {
        html = btn('要不起', 'blue', 'pass');
      } else {
        html = (prev ? btn('不出', 'gray', 'pass') : '') + btn('提示', 'blue', 'hint') + btn('出牌', 'orange', 'play', !selectionPlayable());
      }
    }
    if (box.dataset.sig !== html) {
      box.innerHTML = html;
      box.dataset.sig = html;
    }
  }

  function send(action) {
    client.act(action);
  }

  R('actions').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    o.audio.playClick();
    if (act === 'unauto') {
      client.setAuto(false);
      return;
    }
    if (act.startsWith('bid:')) send({ type: 'bid', score: Number(act.slice(4)) });
    else if (['call', 'nocall', 'rob', 'norob'].includes(act)) send({ type: act });
    else if (act === 'pass') {
      selected.clear();
      send({ type: 'pass' });
    } else if (act === 'hint') {
      if (!hintList?.length) {
        o.toast('没有能大过上家的牌', '🃏', 1600);
        return;
      }
      hintIdx = (hintIdx + 1) % hintList.length;
      selected.clear();
      hintList[hintIdx].forEach((id) => selected.add(id));
      renderHand();
      renderActions();
    } else if (act === 'play') {
      if (!selectionPlayable()) {
        o.toast('这样出不符合规则', '🃏', 1600);
        return;
      }
      send({ type: 'play', cards: [...selected] });
    }
  });

  // ---------- hand selection (tap or slide across cards) ----------

  let sweep = null;

  function cardAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const node = hit && hit.closest ? hit.closest('.ddz-hand .pk') : null;
    return node ? Number(node.dataset.id) : null;
  }

  function onDown(e) {
    const id = cardAt(e.clientX, e.clientY);
    if (id == null) {
      if (!e.target.closest('button') && !e.target.closest('.ddz-overlay') && selected.size) {
        selected.clear();
        renderHand();
        renderActions();
      }
      return;
    }
    e.preventDefault();
    sweep = { ids: [id] };
    handEls.get(id)?.classList.add('sweep');
  }

  function onMove(e) {
    if (!sweep) return;
    const id = cardAt(e.clientX, e.clientY);
    if (id == null || sweep.ids.includes(id)) return;
    sweep.ids.push(id);
    handEls.get(id)?.classList.add('sweep');
  }

  function onUp() {
    if (!sweep) return;
    const ids = sweep.ids;
    sweep = null;
    ids.forEach((id) => handEls.get(id)?.classList.remove('sweep'));
    if (ids.length >= 5 && ids.every((id) => !selected.has(id))) {
      // Sliding over a run picks one card per rank when that makes a straight.
      const byRank = new Map();
      for (const id of ids) if (!byRank.has(rankOf(id))) byRank.set(rankOf(id), id);
      const pick = [...byRank.values()];
      if (!analyzeCards(ids) && analyzeCards(pick)?.type === 'straight') {
        pick.forEach((id) => selected.add(id));
        sfx.select();
        hintIdx = -1;
        renderHand();
        renderActions();
        return;
      }
    }
    for (const id of ids) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    }
    sfx.select();
    hintIdx = -1;
    renderHand();
    renderActions();
  }

  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  // ---------- events → sound, voice, effects ----------

  function fx(text, kind = '') {
    const box = R('fx');
    box.innerHTML = `${kind === 'bomb' ? '<div class="ddz-flash"></div>' : ''}<div class="ddz-fx-text ${kind}">${text}</div>`;
    if (kind === 'bomb') {
      root.classList.remove('shake');
      void root.offsetWidth;
      root.classList.add('shake');
    }
    later(() => (box.innerHTML = ''), 1300);
  }

  function capturePlayedRects(ids) {
    const rects = new Map();
    for (const id of ids) {
      const node = handEls.get(id);
      if (node) rects.set(id, node.getBoundingClientRect());
    }
    return rects;
  }

  function flyFromHand(rects) {
    const box = el.querySelector('[data-played="0"]');
    box.querySelectorAll('.pk').forEach((node) => {
      const r0 = rects.get(Number(node.dataset.id));
      if (!r0) return;
      const r1 = node.getBoundingClientRect();
      node.classList.add('fly');
      node.style.transition = 'none';
      node.style.transform = `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px) scale(${r0.width / r1.width})`;
      requestAnimationFrame(() => {
        node.style.transition = '';
        node.style.transform = '';
      });
    });
  }

  function handleEvents(events, prevView) {
    let flyRects = null;
    for (const ev of events) {
      switch (ev.e) {
        case 'newHand':
          dealing = true;
          selected.clear();
          freshIds = new Set();
          hideOverlay();
          sfx.deal();
          later(() => (dealing = false), 50);
          break;
        case 'redeal':
          o.toast('没人叫地主，重新发牌', '🔄', 1800);
          dealing = true;
          selected.clear();
          later(() => (dealing = false), 50);
          break;
        case 'bid': {
          sfx.bid();
          const a = ev.action || {};
          sfx.say(a.type === 'bid' ? (a.score ? `${a.score}分` : '不叫') : BID_TEXT[a.type]);
          break;
        }
        case 'landlord':
          sfx.whoosh();
          if (ev.seat === me()) {
            freshIds = new Set(ev.bottom || []);
            later(() => {
              freshIds = new Set();
              renderHand();
            }, 1600);
          }
          break;
        case 'play': {
          const t = ev.combo?.type;
          if (t === 'bomb') {
            sfx.bomb();
            fx('💣 炸弹', 'bomb');
          } else if (t === 'rocket') {
            sfx.rocket();
            fx('🚀 王炸', 'bomb');
          } else {
            sfx.play();
            if (FX_TEXT[t]) fx(t.startsWith('plane') ? '✈️ 飞机' : FX_TEXT[t]);
          }
          sfx.say(playCallout(ev.combo));
          if (ev.seat === me()) {
            flyRects = capturePlayedRects(ev.cards || []);
            selected.clear();
          } else if (prevView) {
            const left = (prevView.counts?.[ev.seat] ?? 99) - (ev.cards?.length || 0);
            if (left === 2 || left === 1) {
              later(() => {
                sfx.alarm();
                sfx.say(left === 2 ? '我只剩两张牌了' : '我只剩一张牌了');
              }, 700);
            }
          }
          break;
        }
        case 'pass':
          sfx.pass();
          sfx.say(PASS_CALLOUTS[Math.floor(Math.random() * PASS_CALLOUTS.length)]);
          break;
        case 'handOver':
          later(() => showResult(), 1100);
          if (ev.result?.spring || ev.result?.antiSpring) later(() => fx(ev.result.spring ? '🌸 春天' : '🌸 反春'), 300);
          break;
        default:
          break;
      }
    }
    return flyRects;
  }

  // ---------- overlays ----------

  function overlay(html) {
    const ov = R('overlay');
    ov.innerHTML = `<div class="ddz-panel">${html}</div>`;
    ov.classList.remove('hidden');
    return ov;
  }

  function hideOverlay() {
    const ov = R('overlay');
    ov.classList.add('hidden');
    ov.innerHTML = '';
    ov.dataset.kind = '';
  }

  function showResult() {
    if (!view || view.phase !== 'over' || !view.result || resultShownFor === view.handNo) return;
    resultShownFor = view.handNo;
    const res = view.result;
    const iAmLord = me() === view.landlord;
    const win = (res.winnerSide === 'landlord') === iAmLord;
    win ? sfx.win() : sfx.lose();
    sfx.say(win ? '你赢了' : '你输了');
    const rows = [0, 1, 2]
      .map((seat) => {
        const s = seatInfo(seat);
        const d = res.deltas?.[seat] ?? 0;
        return `<div class="ddz-row"><span class="e">${esc(s.avatar)}</span><span>${esc(s.name)}${seat === view.landlord ? ' 👑' : ''}${seat === me() ? '（我）' : ''}</span>
          <span class="d ${d >= 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${d}</span><span class="t">总 ${view.scores?.[seat] ?? 0}</span></div>`;
      })
      .join('');
    const tags = [`${res.winnerSide === 'landlord' ? '地主' : '农民'}获胜`, `倍数 ×${res.multiplier}`];
    if (res.spring) tags.push('春天');
    if (res.antiSpring) tags.push('反春');
    const ov = overlay(`
      <h2 class="${win ? 'win' : 'lose'}">${win ? '🎉 胜利' : '😢 失败'}</h2>
      <div class="sub">${tags.join(' · ')}</div>
      <div class="ddz-rows">${rows}</div>
      <div class="btns">${btn('退出', 'gray', 'ov-exit')}${btn('继续', 'orange', 'ov-next')}</div>
      <div class="note" data-r="readynote"></div>`);
    ov.dataset.kind = 'result';
    ov.querySelector('[data-act="ov-next"]').onclick = () => {
      o.audio.playClick();
      client.setReady(true);
      const b = ov.querySelector('[data-act="ov-next"]');
      b.disabled = true;
      b.textContent = '已准备';
      updateReadyNote();
    };
    ov.querySelector('[data-act="ov-exit"]').onclick = () => {
      o.audio.playClick();
      confirmExit();
    };
    updateReadyNote();
  }

  function updateReadyNote() {
    const note = el.querySelector('[data-r="readynote"]');
    if (!note) return;
    const waiting = client.seats.filter((s) => s.kind === 'human' && s.connected && !s.auto && !s.ready).map((s) => s.name);
    note.textContent = waiting.length && !solo ? `等待 ${waiting.join('、')} 准备…` : '';
  }

  function confirmExit() {
    const text = solo ? '进度会自动保存，下次可以继续。' : host ? '你是房主，退出会解散房间。' : '退出后你的位置由电脑代打。';
    const ov = overlay(`<h2 style="font-size:22px">确定退出吗？</h2><div class="sub">${text}</div><div class="btns">${btn('取消', 'gray', 'c-no')}${btn('退出', 'orange', 'c-yes')}</div>`);
    ov.dataset.kind = 'confirm';
    ov.querySelector('[data-act="c-no"]').onclick = () => {
      o.audio.playClick();
      hideOverlay();
      if (view?.phase === 'over') {
        resultShownFor = -1;
        showResult();
      }
    };
    ov.querySelector('[data-act="c-yes"]').onclick = () => {
      o.audio.playClick();
      exit();
    };
  }

  function showEmotes() {
    const ov = overlay(`<h2 style="font-size:20px">快捷聊天</h2><div class="ddz-list">${EMOTES.map((t, i) => `<button data-emote="${i}">${t}</button>`).join('')}</div><div class="btns" style="margin-top:12px">${btn('关闭', 'gray', 'e-close')}</div>`);
    ov.querySelectorAll('[data-emote]').forEach((b) => {
      b.onclick = () => {
        client.emote(Number(b.dataset.emote));
        hideOverlay();
      };
    });
    ov.querySelector('[data-act="e-close"]').onclick = hideOverlay;
  }

  function showSettings() {
    const row = (key, label) => `<label class="ddz-switch"><span>${label}</span><input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''}/></label>`;
    const ov = overlay(`<h2 style="font-size:20px">设置</h2>
      <label class="ddz-switch"><span>音效</span><input type="checkbox" data-sound ${o.audio.isMuted() ? '' : 'checked'}/></label>
      ${row('voice', '语音播报')}${row('counter', '记牌器')}
      <div class="btns" style="margin-top:12px">${btn('关闭', 'gray', 's-close')}</div>`);
    ov.querySelector('[data-sound]').onchange = (e) => o.audio.setMuted(!e.target.checked);
    ov.querySelectorAll('[data-pref]').forEach((inp) => {
      inp.onchange = () => {
        prefs[inp.dataset.pref] = inp.checked;
        savePrefs();
        renderAll();
      };
    });
    ov.querySelector('[data-act="s-close"]').onclick = hideOverlay;
  }

  function showEmote(seat, id) {
    const text = EMOTES[Number(id)];
    if (!text) return;
    const pos = posOf(seat);
    const [ax, ay, align] = L.anchors[pos];
    const b = document.createElement('div');
    b.className = 'ddz-bubble chat';
    const y = pos === 0 ? ay - 20 : ay - 8;
    b.style.cssText = align === 'center' ? `left:${ax}px;top:${y}px;transform:translateX(-50%)` : align === 'right' ? `right:${L.W - ax}px;top:${y}px` : `left:${ax}px;top:${y}px`;
    b.textContent = text;
    el.appendChild(b);
    sfx.say(text);
    later(() => b.remove(), 3200);
  }

  el.querySelector('.ddz-topbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    o.audio.playClick();
    switch (b.dataset.a) {
      case 'exit':
        confirmExit();
        break;
      case 'counter':
        prefs.counter = !prefs.counter;
        savePrefs();
        renderAll();
        break;
      case 'emote':
        showEmotes();
        break;
      case 'auto':
        client.setAuto(!myAuto());
        break;
      case 'settings':
        showSettings();
        break;
      default:
        break;
    }
  });

  // ---------- room wiring ----------

  function onState(nextView, events) {
    const prevView = view;
    view = nextView;
    hintList = null;
    hintIdx = -1;
    const flyRects = handleEvents(events || [], prevView);
    renderAll();
    if (flyRects && flyRects.size) flyFromHand(flyRects);
    const myTurn = view.phase !== 'over' && view.turn === me();
    if (myTurn && lastTurnSeat !== me() && !myAuto()) {
      sfx.turn();
      if (isNativeApp) hapticTap('light');
    }
    lastTurnSeat = view.phase === 'over' ? -2 : view.turn;
    if (view.phase === 'over' && !events?.some((e) => e.e === 'handOver')) later(showResult, 300);
  }

  const offs = [
    client.on('state', onState),
    client.on('seats', () => {
      renderAll();
      updateReadyNote();
    }),
    client.on('error', (msg) => o.toast(msg, '⚠️', 1800)),
    client.on('emote', showEmote),
    client.on('status', (s) => {
      R('banner').textContent = s === 'reconnecting' ? '连接中断，正在重连…' : '';
      renderInfo();
    }),
    client.on('end', (reason) => {
      o.toast(reason || '房间已关闭', '👋', 2600);
      exit(true);
    }),
  ];

  const onResize = () => {
    computeLayout();
    el.querySelectorAll('[data-played]').forEach((box) => (box.dataset.sig = '-'));
    renderAll();
  };
  window.addEventListener('resize', onResize);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  ro?.observe(el);

  if (!isNativeApp && el.clientHeight > el.clientWidth) {
    const tip = document.createElement('div');
    tip.className = 'ddz-rotate';
    tip.style.top = `${(parseFloat(getComputedStyle(probe).paddingTop) || 0) + 48}px`;
    tip.textContent = '📱 横屏玩更舒服';
    el.appendChild(tip);
    later(() => tip.remove(), 5000);
  }

  computeLayout();
  if (view) {
    dealing = true;
    renderAll();
    dealing = false;
    if (view.phase === 'over') later(showResult, 300);
  }

  function exit(fromEnd = false) {
    if (destroyed) return;
    if (host) host.close();
    if (!fromEnd || !host) client.leave(fromEnd);
    destroy();
    o.onExit();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    host?.close();
    client.leave();
    timers.forEach((t) => clearTimeout(t));
    offs.forEach((off) => off());
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    ro?.disconnect();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    el.remove();
  }

  return {
    /** Android back button: close a panel, else ask to leave. */
    back() {
      const ov = R('overlay');
      if (!ov.classList.contains('hidden') && ov.dataset.kind !== 'result') {
        hideOverlay();
        return;
      }
      confirmExit();
    },
    destroy,
  };
}
