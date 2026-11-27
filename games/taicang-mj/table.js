/**
 * 太仓麻将 table UI. Renders the personalised view the room sends to this seat; everything goes
 * through RoomClient, so solo, host and guest share one code path.
 *
 * Screen positions: 0 = me (bottom), 1 = 下家 (right), 2 = 对家 (top), 3 = 上家 (left).
 */

import { tileHtml, backHtml } from './tiles.js';
import { tileName } from './engine.js';
import { hapticTap, isNativeApp } from '../../core/platform.js';

const EMOTES = ['快点打呀，等得花都谢了', '这牌打得漂亮！', '今天手气真好', '再来一圈！', '别急别急，让我想想', '不好意思，我胡了', '交个朋友吧', '先走一步，下次再搓'];
const CLAIM_TEXT = { chi: '吃', pon: '碰', mingkan: '杠', kan: '杠', ankan: '杠', bukan: '杠' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function createSfx(sharedAudio, prefs) {
  let voice = null;
  const pick = () => {
    if (typeof speechSynthesis === 'undefined') return;
    const vs = speechSynthesis.getVoices();
    voice = vs.find((v) => /zh[-_]CN/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  };
  if (typeof speechSynthesis !== 'undefined') {
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  }
  const clack = (vol = 0.25, f = 2600) => {
    const c = sharedAudio.getContext();
    if (!c) return;
    const t = c.currentTime;
    const len = Math.floor(c.sampleRate * 0.06);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t);
    const o = c.createOscillator();
    const og = c.createGain();
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    og.gain.setValueAtTime(vol * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(og).connect(c.destination);
    o.start(t);
    o.stop(t + 0.1);
  };
  const tone = (f, dur, delay = 0, vol = 0.1, type = 'triangle') => {
    const c = sharedAudio.getContext();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  return {
    say(text) {
      if (!prefs.voice || !text || typeof speechSynthesis === 'undefined' || sharedAudio.isMuted()) return;
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        if (voice) u.voice = voice;
        u.rate = 1.1;
        if (speechSynthesis.speaking) speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch {
        // optional
      }
    },
    select: () => clack(0.08, 4200),
    discard: () => clack(0.28),
    claim: () => {
      clack(0.3, 1800);
      tone(660, 0.15, 0.05);
    },
    flower: () => [880, 1175].forEach((f, i) => tone(f, 0.16, i * 0.08, 0.07)),
    turn: () => tone(990, 0.14, 0, 0.07, 'sine'),
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, i * 0.1, 0.1)),
    lose: () => [440, 392, 330].forEach((f, i) => tone(f, 0.3, i * 0.14, 0.08, 'sine')),
  };
}

/**
 * @param {HTMLElement} root  .mj-root
 * @param {object} session    {client, host, solo}
 * @param {object} o          {audio, toast, storage, onExit, rulesHtml}
 */
export function mountTable(root, session, o) {
  const { client, host, solo } = session;
  const prefs = { voice: true, ...o.storage.get('table_prefs', {}) };
  const savePrefs = () => o.storage.set('table_prefs', prefs);
  const sfx = createSfx(o.audio, prefs);

  const el = document.createElement('div');
  el.className = 'mj-table';
  el.innerHTML = `
    <div class="mj-probe"></div>
    <div class="mj-topbar">
      <button class="mj-pill" data-a="exit">← 退出</button>
      <div class="mj-info"><i class="mj-net"></i><span data-r="info"></span></div>
      <div class="mj-right">
        <button class="mj-pill" data-a="rules">规则</button>
        <button class="mj-pill" data-a="emote">💬</button>
        <button class="mj-pill" data-a="auto">托管</button>
        <button class="mj-pill" data-a="settings">⚙︎</button>
      </div>
    </div>
    <div class="mj-layer" data-r="rivers"></div>
    <div class="mj-layer" data-r="ops"></div>
    <div class="mj-center" data-r="center"></div>
    <div class="mj-dir" data-r="dir"></div>
    <div data-r="seats"></div>
    <div class="mj-layer" data-r="mine"></div>
    <div class="mj-hand" data-r="hand"></div>
    <div class="mj-hint" data-r="hint"></div>
    <div class="mj-actions" data-r="actions"></div>
    <div data-r="choice"></div>
    <div class="mj-layer" data-r="fx"></div>
    <div class="mj-banner" data-r="banner"></div>
    <div class="mj-overlay hidden" data-r="overlay"></div>`;
  root.appendChild(el);

  const $ = (sel) => el.querySelector(sel);
  const R = (name) => el.querySelector(`[data-r="${name}"]`);
  const probe = $('.mj-probe');
  let L = null;
  let view = client.view;
  let selIdx = -1;
  let resultShownFor = -1;
  let destroyed = false;
  let lastTurn = -2;
  let lastDiscardKey = '';
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
  const posOf = (seat) => (seat - me() + 4) % 4;
  const seatAt = (pos) => (me() + pos) % 4;
  const seatInfo = (seat) => client.seats[seat] || { name: '', avatar: '🙂', kind: 'empty' };
  const myAuto = () => Boolean(client.seats[me()]?.auto);
  const wilds = () => new Set(view?.wilds || []);

  // ---------- layout ----------

  function computeLayout() {
    const W = el.clientWidth;
    const H = el.clientHeight;
    const ps = getComputedStyle(probe);
    const safe = { t: parseFloat(ps.paddingTop) || 0, r: parseFloat(ps.paddingRight) || 0, b: parseFloat(ps.paddingBottom) || 0, l: parseFloat(ps.paddingLeft) || 0 };
    const top = safe.t + 4;
    const barH = 34;
    const availW = W - safe.l - safe.r - 16;
    const hw = Math.round(clamp(Math.min((availW - 40) / 16.4, (H - top - barH) * 0.14), 22, 66));
    const hh = Math.round(hw * 1.36);
    const mw = Math.round(hw * 0.78);
    const mh = Math.round(mw * 1.36);
    const ow = Math.round(clamp(hw * 0.56, 14, 36));
    const oh = Math.round(ow * 1.36);
    const handY = H - safe.b - hh - 6;
    const topRowY = top + barH + 4;
    const sideZone = Math.round(oh * 0.92) + 8 + Math.round(clamp(hw * 0.5, 14, 34) * 1.36) + 6;
    const innerTop = topRowY + oh + 8;
    const innerBottom = handY - 10;
    const innerH = innerBottom - innerTop;
    const innerW = W - safe.l - safe.r - 2 * (sideZone + 10);
    // rivers: top/bottom rows of 12 (two rows), sides columns of 5; centre box fills the ring
    const rw = Math.round(clamp(Math.min((innerH - 18) / 10.44, (innerW - 44) / 25.6), 14, 40));
    const rh = Math.round(rw * 1.36);
    const cW = 12 * (rw + 2);
    const cH = 5 * (rw + 2);
    const cx = W / 2;
    const cy = innerTop + innerH / 2;
    L = { W, H, safe, top, barH, hw, hh, mw, mh, ow, oh, rw, rh, handY, topRowY, cx, cy, cW, cH, sideZone };
    for (const k of ['hw', 'hh', 'mw', 'mh', 'ow', 'oh', 'rw', 'rh']) el.style.setProperty(`--${k}`, `${L[k]}px`);

    const bar = $('.mj-topbar');
    bar.style.top = `${top}px`;
    bar.style.padding = `0 ${safe.r + 8}px 0 ${safe.l + 8}px`;
    const center = R('center');
    center.style.left = `${cx}px`;
    center.style.top = `${cy}px`;
    center.style.width = `${cW - 8}px`;
    center.style.height = `${cH - 8}px`;
    R('actions').style.right = `${safe.r + 12}px`;
    R('actions').style.bottom = `${H - handY + 14 + hh * 0.22}px`;
    R('hint').style.left = `${cx}px`;
    R('hint').style.top = `${handY - hh * 0.22 - 26}px`;
    R('banner').style.top = `${top + barH + 8}px`;
  }

  // Absolute tile at a centre point, optionally rotated (sizes from the layer's CSS vars).
  function at(html, cx, cy, w, h, rot = 0) {
    const style = `left:${Math.round(cx - w / 2)}px;top:${Math.round(cy - h / 2)}px;${rot ? `transform:rotate(${rot}deg);` : ''}`;
    return html.replace('class="mj-t', `style="${style}" class="mj-t`);
  }

  // ---------- rendering ----------

  function renderAll() {
    if (!L || !view) return;
    renderInfo();
    renderCenter();
    renderRivers();
    renderOpponents();
    renderSeats();
    renderMine();
    renderActions();
  }

  function renderInfo() {
    const ses = view.session;
    const parts = [solo ? '单机' : `房间 ${client.code}`, ses?.handsPerSession ? `第 ${Math.max(1, Math.min(ses.handsPlayed + (view.phase === 'over' ? 0 : 1), ses.handsPerSession))}/${ses.handsPerSession} 局` : `第 ${view.handNo} 局`];
    R('info').textContent = parts.join(' · ');
    const net = $('.mj-net');
    net.style.display = solo ? 'none' : '';
    net.classList.toggle('bad', client.status !== 'connected');
    $('[data-a="auto"]').classList.toggle('on', myAuto());
  }

  function renderCenter() {
    const w = view.wilds || [];
    const ws = wilds();
    const tiles = (kinds) => kinds.map((k) => tileHtml(k, '', '', ws.has(k))).join('');
    R('center').innerHTML = `
      <div class="wall">余 <b>${view.wallCount ?? '-'}</b> 张</div>
      <span class="k">翻牌</span><div class="tiles">${view.indicator != null ? tileHtml(view.indicator) : ''}</div>
      <span class="k">财神</span><div class="tiles">${tiles(w.slice(0, 4))}</div>`;
    const dir = R('dir');
    const turnPos = view.phase === 'over' || view.turn == null || view.turn < 0 ? -1 : posOf(view.turn);
    dir.style.display = turnPos < 0 ? 'none' : '';
    const off = [[0, L.cH / 2 + 2], [L.cW / 2 + 2, 0], [0, -L.cH / 2 - 2], [-L.cW / 2 - 2, 0]][Math.max(0, turnPos)];
    dir.style.left = `${L.cx + off[0]}px`;
    dir.style.top = `${L.cy + off[1]}px`;
  }

  function renderRivers() {
    const { rw, rh, cx, cy, cW, cH } = L;
    const ws = wilds();
    const last = view.lastDiscard;
    const parts = [];
    for (let pos = 0; pos < 4; pos++) {
      const seat = seatAt(pos);
      const list = view.discards?.[seat] || [];
      list.forEach((k, i) => {
        const isLast = last && last.seat === seat && i === list.length - 1;
        const cls = `${isLast ? 'last' : ''}${isLast && lastDiscardKey !== `${view.seq}` ? ' new' : ''}`;
        const html = tileHtml(k, cls, '', ws.has(k));
        let x;
        let y;
        let rot = 0;
        if (pos === 0) {
          x = cx - cW / 2 + (i % 12) * (rw + 2) + rw / 2 + 1;
          y = cy + cH / 2 + 4 + Math.floor(i / 12) * (rh + 2) + rh / 2;
        } else if (pos === 2) {
          x = cx + cW / 2 - (i % 12) * (rw + 2) - rw / 2 - 1;
          y = cy - cH / 2 - 4 - Math.floor(i / 12) * (rh + 2) - rh / 2;
        } else if (pos === 3) {
          x = cx - cW / 2 - 4 - Math.floor(i / 5) * (rh + 2) - rh / 2;
          y = cy - cH / 2 + (i % 5) * (rw + 2) + rw / 2 + 1;
          rot = 90;
        } else {
          x = cx + cW / 2 + 4 + Math.floor(i / 5) * (rh + 2) + rh / 2;
          y = cy + cH / 2 - (i % 5) * (rw + 2) - rw / 2 - 1;
          rot = -90;
        }
        parts.push(at(html, x, y, rw, rh, rot));
      });
    }
    const box = R('rivers');
    box.className = 'mj-layer mj-river';
    box.innerHTML = parts.join('');
  }

  function meldTiles(m, ws) {
    if (m.type === 'ankan' && m.tiles.some((k) => k < 0)) return [-1, -1, -1, -1];
    return m.tiles;
  }

  function renderOpponents() {
    const { ow, oh, rw, rh, safe, topRowY, W, H } = L;
    const ws = wilds();
    const parts = [];
    for (const pos of [1, 2, 3]) {
      const seat = seatAt(pos);
      const count = view.counts?.[seat] ?? 0;
      const melds = view.melds?.[seat] || [];
      const reveal = view.phase === 'over' && view.result?.hands?.[seat];
      const handKinds = reveal ? view.result.hands[seat] : null;
      if (pos === 2) {
        // top: a row of backs (or revealed tiles), melds to the left
        const meldW = melds.reduce((s, m) => s + meldTiles(m).length * (rw + 1) + 6, 0);
        const handW = count * (ow + 1) + (count % 3 === 2 ? 6 : 0);
        let x = W / 2 - (handW + meldW) / 2;
        const y = topRowY + oh / 2;
        for (const m of melds) {
          for (const k of meldTiles(m)) {
            parts.push(at(k < 0 ? backHtml('mj-small') : tileHtml(k, 'mj-small', '', ws.has(k)), x + rw / 2, y + (oh - rh) / 2, rw, rh));
            x += rw + 1;
          }
          x += 6;
        }
        for (let i = 0; i < count; i++) {
          if (count % 3 === 2 && i === count - 1) x += 6;
          const k = handKinds ? handKinds[i] : null;
          parts.push(at(k != null ? tileHtml(k, '', '', ws.has(k)) : backHtml(), x + ow / 2, y, ow, oh));
          x += ow + 1;
        }
      } else {
        // sides: column of tiles lying down, melds in a second column towards the centre
        const left = pos === 3;
        const thick = Math.round(ow * 0.62);
        const colX = left ? safe.l + 8 + oh * 0.46 : W - safe.r - 8 - oh * 0.46;
        let y = topRowY + 50;
        for (let i = 0; i < count; i++) {
          if (count % 3 === 2 && i === count - 1) y += 6;
          const k = handKinds ? handKinds[i] : null;
          if (k != null) {
            parts.push(at(tileHtml(k, '', '', ws.has(k)), colX, y + ow / 2, ow, oh, left ? 90 : -90));
            y += ow + 1;
          } else {
            parts.push(at(backHtml('side'), colX, y + thick / 2, oh * 0.92, thick).replace('mj-t back side', 'mj-t back mj-sideback'));
            y += thick;
          }
        }
        const mx = left ? colX + oh * 0.46 + 6 + rh / 2 : colX - oh * 0.46 - 6 - rh / 2;
        let my = topRowY + 50;
        for (const m of melds) {
          for (const k of meldTiles(m)) {
            parts.push(at(k < 0 ? backHtml('mj-small') : tileHtml(k, 'mj-small', '', ws.has(k)), mx, my + rw / 2, rw, rh, left ? 90 : -90));
            my += rw + 1;
          }
          my += 6;
        }
      }
    }
    const box = R('ops');
    box.className = 'mj-layer mj-op';
    box.innerHTML = parts.join('');
    box.querySelectorAll('.mj-sideback').forEach((n) => {
      n.style.setProperty('--tw', `${Math.round(L.oh * 0.92)}px`);
      n.style.setProperty('--th', `${Math.round(L.ow * 0.62)}px`);
    });
    box.querySelectorAll('.mj-small').forEach((n) => {
      n.style.setProperty('--tw', `${L.rw}px`);
      n.style.setProperty('--th', `${L.rh}px`);
    });
  }

  function renderSeats() {
    const { safe, topRowY, W, handY, ow } = L;
    const parts = [];
    for (let pos = 0; pos < 4; pos++) {
      const seat = seatAt(pos);
      const s = seatInfo(seat);
      const flowers = view.flowers?.[seat]?.length || 0;
      const score = view.scores?.[seat] ?? 0;
      const tag = s.kind === 'human' && !s.connected ? '掉线' : s.auto ? '托管' : s.kind === 'bot' ? '电脑' : '';
      let style;
      if (pos === 0) style = `left:${safe.l + L.sideZone + 14}px;top:${handY - L.hh * 0.22 - 50}px`;
      else if (pos === 1) style = `right:${safe.r + 8}px;top:${topRowY}px;flex-direction:row-reverse;text-align:right`;
      else if (pos === 2) style = `left:${Math.max(safe.l + 130, W / 2 - ((view.counts?.[seat] ?? 13) * (ow + 1)) / 2 - (view.melds?.[seat]?.length || 0) * 3.2 * L.rw - 140)}px;top:${topRowY}px`;
      else style = `left:${safe.l + 8}px;top:${topRowY}px`;
      const turn = view.phase !== 'over' && view.turn === seat;
      parts.push(`<div class="mj-seat ${turn ? 'turn' : ''}" style="${style}">
        <div class="mj-ava">${esc(s.avatar || '🙂')}${seat === view.dealer ? '<span class="mj-dealer">庄</span>' : ''}</div>
        <div class="mj-meta"><b>${esc(s.name)}</b><span>${score > 0 ? '+' : ''}${score} 分</span><em>花×${flowers}${tag ? ` · ${tag}` : ''}</em></div></div>`);
    }
    R('seats').innerHTML = parts.join('');
  }

  /** My concealed tiles with the drawn tile last: [{kind, drawn}] */
  function myTiles() {
    const list = (view.hand || []).map((k) => ({ kind: k, drawn: false }));
    if (view.drawn != null && view.drawn >= 0) list.push({ kind: view.drawn, drawn: true });
    return list;
  }

  function renderMine() {
    const { hw, hh, mw, mh, rw, rh, W, safe, handY } = L;
    const ws = wilds();
    const melds = view.melds?.[me()] || [];
    const tiles = myTiles();
    const meldW = melds.reduce((s, m) => s + meldTiles(m).length * (mw + 1) + 8, 0);
    const handW = tiles.length * (hw + 1) + (tiles.some((t) => t.drawn) ? 12 : 0);
    let x = Math.max(safe.l + 8, (W - meldW - handW) / 2);
    // melds (left) in the "mine" layer
    const mparts = [];
    for (const m of melds) {
      for (const k of meldTiles(m)) {
        mparts.push(at(k < 0 ? backHtml() : tileHtml(k, '', '', ws.has(k)), x + mw / 2, handY + hh - mh / 2, mw, mh));
        x += mw + 1;
      }
      x += 8;
    }
    // my flowers: small row above the hand, after my name
    const flowers = view.flowers?.[me()] || [];
    let fx = safe.l + L.sideZone + 14 + 140;
    const fy = handY - hh * 0.22 - 30;
    for (const k of flowers) {
      mparts.push(at(tileHtml(k), fx + rw * 0.4, fy, rw * 0.8, rh * 0.8).replace('class="mj-t', 'class="mj-t mj-fl'));
      fx += rw * 0.8 + 2;
    }
    const mine = R('mine');
    mine.className = 'mj-layer mj-melds';
    mine.innerHTML = mparts.join('');
    mine.querySelectorAll('.mj-fl').forEach((n) => {
      n.style.setProperty('--tw', `${Math.round(rw * 0.8)}px`);
      n.style.setProperty('--th', `${Math.round(rh * 0.8)}px`);
    });

    const canDiscard = Boolean(view.options?.discard) && !myAuto();
    const hparts = tiles.map((t, i) => {
      if (t.drawn) x += 12;
      const cls = [i === selIdx ? 'sel' : '', t.drawn && view.turn === me() ? 'drawn' : '', !canDiscard && view.phase !== 'over' ? 'dim' : ''].join(' ');
      const html = at(tileHtml(t.kind, cls, `data-i="${i}"`, ws.has(t.kind)), x + hw / 2, handY + hh / 2, hw, hh);
      x += hw + 1;
      return html;
    });
    R('hand').innerHTML = hparts.join('');

    let hint = '';
    if (view.phase === 'over') hint = '';
    else if (myAuto()) hint = '托管中，电脑帮你打';
    else if (canDiscard) hint = selIdx >= 0 ? '再点一次打出' : '轮到你出牌 · 点牌选中，再点打出';
    else if (view.options && (view.options.hu || view.options.pon || view.options.chi?.length || view.options.kan?.length)) hint = '可以吃碰杠胡，也可以选「过」';
    else if (view.turn !== me()) hint = `等待 ${esc(seatInfo(view.turn).name)}…`;
    R('hint').textContent = hint;
  }

  function renderActions() {
    const box = R('actions');
    const opt = view.options;
    const html = [];
    if (opt && !myAuto() && view.phase !== 'over') {
      if (opt.chi?.length) html.push('<button class="mj-btn chi" data-act="chi">吃</button>');
      if (opt.pon) html.push('<button class="mj-btn pon" data-act="pon">碰</button>');
      if (opt.kan?.length) html.push('<button class="mj-btn kan" data-act="kan">杠</button>');
      if (opt.hu) html.push(`<button class="mj-btn hu" data-act="hu">${view.turn === me() && opt.discard ? '自摸' : '胡'}</button>`.replace('>自摸<', ' style="font-size:20px">自摸<'));
      if (html.length && (opt.pass || opt.discard)) html.push(`<button class="mj-btn pass" data-act="pass">过</button>`);
    }
    const sig = html.join('');
    if (box.dataset.sig !== sig) {
      box.innerHTML = sig;
      box.dataset.sig = sig;
      R('choice').innerHTML = '';
    }
  }

  function showChoice(kind, options) {
    const ws = wilds();
    const box = R('choice');
    box.innerHTML = `<div class="mj-choice" style="right:${L.safe.r + 12}px;bottom:${L.H - L.handY + 90 + L.hh * 0.22}px">${options
      .map((opt, i) => `<button data-i="${i}">${(Array.isArray(opt) ? opt : [opt]).map((k) => tileHtml(k, '', `style="--tw:${L.rw}px;--th:${L.rh}px"`, ws.has(k))).join('')}</button>`)
      .join('')}</div>`;
    box.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const opt = options[Number(b.dataset.i)];
        box.innerHTML = '';
        if (kind === 'chi') client.act({ type: 'chi', tiles: opt });
        else client.act({ type: 'kan', tile: opt });
      };
    });
  }

  R('actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !view?.options) return;
    o.audio.playClick();
    const opt = view.options;
    switch (b.dataset.act) {
      case 'hu':
        client.act({ type: 'hu' });
        break;
      case 'pon':
        client.act({ type: 'pon' });
        break;
      case 'kan':
        if (opt.kan.length === 1) client.act({ type: 'kan', tile: opt.kan[0] });
        else showChoice('kan', opt.kan);
        break;
      case 'chi':
        if (opt.chi.length === 1) client.act({ type: 'chi', tiles: opt.chi[0] });
        else showChoice('chi', opt.chi);
        break;
      case 'pass':
        // On my own turn "过" just dismisses the self-draw/kong prompt; I still have to discard.
        if (opt.discard) {
          R('actions').innerHTML = '';
          R('actions').dataset.sig = 'dismissed';
        } else {
          client.act({ type: 'pass' });
        }
        break;
      default:
        break;
    }
  });

  // ---------- hand: tap to select, tap again (or swipe up) to discard ----------

  let press = null;

  function discardIndex(i) {
    const t = myTiles()[i];
    if (!t || !view.options?.discard) return;
    selIdx = -1;
    client.act({ type: 'discard', tile: t.kind });
  }

  el.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.mj-hand .mj-t');
    if (!node) {
      if (selIdx >= 0 && !e.target.closest('button') && !e.target.closest('.mj-overlay')) {
        selIdx = -1;
        renderMine();
      }
      return;
    }
    e.preventDefault();
    press = { i: Number(node.dataset.i), y: e.clientY, done: false };
  });

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  function onMove(e) {
    if (!press || press.done) return;
    if (press.y - e.clientY > L.hh * 0.6 && view.options?.discard) {
      press.done = true;
      discardIndex(press.i);
    }
  }

  function onUp() {
    if (!press) return;
    const { i, done } = press;
    press = null;
    if (done) return;
    if (i === selIdx && view.options?.discard && !myAuto()) {
      discardIndex(i);
      return;
    }
    selIdx = i;
    sfx.select();
    renderMine();
  }

  // ---------- effects ----------

  function seatPoint(seat) {
    const pos = posOf(seat);
    const { cx, cy, cW, cH } = L;
    return [[cx, cy + cH / 2 + 40], [cx + cW / 2 + 70, cy], [cx, cy - cH / 2 - 40], [cx - cW / 2 - 70, cy]][pos];
  }

  function fx(text, seat, kind = '') {
    const [x, y] = seat == null ? [L.cx, L.cy] : seatPoint(seat);
    const n = document.createElement('div');
    n.className = `mj-fx ${kind}`;
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    n.textContent = text;
    R('fx').appendChild(n);
    later(() => n.remove(), 1250);
  }

  function handleEvents(events) {
    for (const ev of events) {
      switch (ev.e) {
        case 'newHand':
          selIdx = -1;
          hideOverlay();
          break;
        case 'indicator':
          later(() => {
            fx('翻财神', null, 'small');
            if (ev.wilds?.length) sfx.say(`财神 ${tileName(ev.wilds[0])}`);
          }, 400);
          break;
        case 'discard':
          sfx.discard();
          sfx.say(tileName(ev.tile));
          break;
        case 'flower':
          sfx.flower();
          fx('补花', ev.seat, 'small');
          break;
        case 'claim':
          sfx.claim();
          fx(CLAIM_TEXT[ev.type] || '杠', ev.seat);
          sfx.say(CLAIM_TEXT[ev.type] || '杠');
          if (isNativeApp) hapticTap('medium');
          break;
        case 'kan':
          sfx.claim();
          fx('杠', ev.seat);
          sfx.say('杠');
          break;
        case 'hu':
          fx(ev.selfDraw ? '自摸' : ev.robbed ? '抢杠' : '胡', ev.seat, 'big');
          sfx.say(ev.selfDraw ? '自摸' : '胡了');
          break;
        case 'handOver':
          later(showResult, 1300);
          break;
        default:
          break;
      }
    }
  }

  // ---------- overlays ----------

  function overlay(html, kind = '') {
    const ov = R('overlay');
    ov.innerHTML = `<div class="mj-panel">${html}</div>`;
    ov.classList.remove('hidden');
    ov.dataset.kind = kind;
    return ov;
  }

  function hideOverlay() {
    const ov = R('overlay');
    ov.classList.add('hidden');
    ov.innerHTML = '';
    ov.dataset.kind = '';
  }

  function handTilesHtml(seat, winTile) {
    const ws = wilds();
    const res = view.result;
    const concealed = res.hands?.[seat] || [];
    const melds = view.melds?.[seat] || [];
    const parts = melds.map((m) => m.tiles.map((k) => (k < 0 ? backHtml() : tileHtml(k, '', '', ws.has(k)))).join('') + '<span class="gap"></span>');
    parts.push(concealed.map((k) => tileHtml(k, '', '', ws.has(k))).join(''));
    if (winTile != null) parts.push(`<span class="gap"></span>${tileHtml(winTile, 'win', '', ws.has(winTile))}`);
    return parts.join('');
  }

  function showResult() {
    if (!view || view.phase !== 'over' || !view.result || resultShownFor === view.handNo) return;
    resultShownFor = view.handNo;
    const res = view.result;
    const winners = res.winners || [];
    const iWon = winners.includes(me());
    if (res.type === 'draw' || !winners.length) sfx.lose();
    else iWon ? sfx.win() : sfx.lose();
    const pw = Math.round(clamp(Math.min(L.W * 0.9, 600) / 17, 18, 34));
    const blocks = winners
      .map((seat, wi) => {
        const s = seatInfo(seat);
        const items = Array.isArray(res.items?.[0]) ? res.items[wi] : res.items || [];
        const extra = res.details?.[wi] || res.wins?.[wi] || {};
        const total = extra.points ?? res.total;
        return `<div class="sub">${esc(s.avatar)} <b>${esc(s.name)}</b> ${res.selfDraw ? '自摸' : res.loser != null ? `胡 ${esc(seatInfo(res.loser).name)} 放冲` : '胡牌'}</div>
          <div class="mj-winhand" style="--pw:${pw}px">${handTilesHtml(seat, res.winTile)}</div>
          <div class="mj-items">${items.map((it) => `<span>${esc(it.name)} <b>${esc(it.value)}</b></span>`).join('')}</div>
          ${total != null ? `<div class="mj-total">共 ${esc(total)} 花${res.baoSeat != null ? ` · ${esc(seatInfo(res.baoSeat).name)} 承包` : ''}</div>` : ''}`;
      })
      .join('');
    const rows = [0, 1, 2, 3]
      .map((seat) => {
        const s = seatInfo(seat);
        const d = res.deltas?.[seat] ?? 0;
        return `<div class="mj-row"><div class="e">${esc(s.avatar)}</div><div>${esc(s.name)}${seat === me() ? '（我）' : ''}</div>
          <div class="d ${d >= 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${d}</div><div class="t">总 ${view.scores?.[seat] ?? 0}</div></div>`;
      })
      .join('');
    const title = res.type === 'draw' || !winners.length ? '荒庄' : iWon ? '🎉 胡了！' : `${esc(seatInfo(winners[0]).name)} 胡了`;
    const ses = view.session;
    const sessionDone = ses?.handsPerSession && ses.handsPlayed >= ses.handsPerSession;
    const ov = overlay(
      `<h2 class="${iWon ? 'win' : ''}">${title}</h2>
      ${res.type === 'draw' ? '<div class="sub">牌摸完没人胡，庄家连庄</div>' : blocks}
      <div class="mj-rows">${rows}</div>
      ${sessionDone ? `<div class="sub">${ses.handsPerSession} 局打完啦，继续就接着累计</div>` : ''}
      <div class="btns"><button class="pbtn gray" data-x="exit">退出</button><button class="pbtn" data-x="next">继续</button></div>
      <div class="note" data-r="readynote"></div>`,
      'result',
    );
    ov.querySelector('[data-x="next"]').onclick = (e) => {
      o.audio.playClick();
      client.setReady(true);
      e.target.disabled = true;
      e.target.textContent = '已准备';
      updateReadyNote();
    };
    ov.querySelector('[data-x="exit"]').onclick = () => {
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
    const ov = overlay(`<h2 style="font-size:22px">确定退出吗？</h2><div class="sub">${text}</div><div class="btns"><button class="pbtn gray" data-x="no">取消</button><button class="pbtn" data-x="yes">退出</button></div>`, 'confirm');
    ov.querySelector('[data-x="no"]').onclick = () => {
      o.audio.playClick();
      hideOverlay();
      if (view?.phase === 'over') {
        resultShownFor = -1;
        showResult();
      }
    };
    ov.querySelector('[data-x="yes"]').onclick = () => {
      o.audio.playClick();
      exit();
    };
  }

  function showEmotes() {
    const ov = overlay(`<h2 style="font-size:20px">快捷聊天</h2><div class="mj-list">${EMOTES.map((t, i) => `<button data-e="${i}">${t}</button>`).join('')}</div><div class="btns" style="margin-top:12px"><button class="pbtn gray" data-x="close">关闭</button></div>`, 'emote');
    ov.querySelectorAll('[data-e]').forEach((b) => {
      b.onclick = () => {
        client.emote(Number(b.dataset.e));
        hideOverlay();
      };
    });
    ov.querySelector('[data-x="close"]').onclick = hideOverlay;
  }

  function showSettings() {
    const ov = overlay(`<h2 style="font-size:20px">设置</h2>
      <label class="mj-switch"><span>音效</span><input type="checkbox" data-sound ${o.audio.isMuted() ? '' : 'checked'}/></label>
      <label class="mj-switch"><span>语音报牌</span><input type="checkbox" data-voice ${prefs.voice ? 'checked' : ''}/></label>
      <div class="btns" style="margin-top:12px"><button class="pbtn gray" data-x="close">关闭</button></div>`, 'settings');
    ov.querySelector('[data-sound]').onchange = (e) => o.audio.setMuted(!e.target.checked);
    ov.querySelector('[data-voice]').onchange = (e) => {
      prefs.voice = e.target.checked;
      savePrefs();
    };
    ov.querySelector('[data-x="close"]').onclick = hideOverlay;
  }

  function showRules() {
    const ov = overlay(`<h2 style="font-size:20px">太仓麻将规则</h2><div class="rules">${o.rulesHtml || ''}</div><div class="btns" style="margin-top:12px"><button class="pbtn gray" data-x="close">关闭</button></div>`, 'rules');
    ov.querySelector('[data-x="close"]').onclick = hideOverlay;
  }

  function showEmote(seat, id) {
    const text = EMOTES[Number(id)];
    if (!text) return;
    const [x, y] = seatPoint(seat);
    const b = document.createElement('div');
    b.className = 'mj-bubble';
    b.style.left = `${clamp(x - 90, 8, L.W - 230)}px`;
    b.style.top = `${y - 20}px`;
    b.textContent = text;
    el.appendChild(b);
    sfx.say(text);
    later(() => b.remove(), 3200);
  }

  el.querySelector('.mj-topbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    o.audio.playClick();
    switch (b.dataset.a) {
      case 'exit':
        confirmExit();
        break;
      case 'rules':
        showRules();
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

  function onState(next, events) {
    const prevSeq = view?.seq;
    view = next;
    if (prevSeq !== view.seq) selIdx = Math.min(selIdx, myTiles().length - 1);
    if (!view.options?.discard) selIdx = -1;
    handleEvents(events || []);
    renderAll();
    lastDiscardKey = `${view.seq}`;
    const myMove = view.phase !== 'over' && (view.turn === me() || (view.options && !view.options.discard)) && view.options;
    if (myMove && lastTurn !== `${view.seq}` && !myAuto()) {
      if (view.turn === me()) sfx.turn();
      if (isNativeApp) hapticTap('light');
    }
    lastTurn = `${view.seq}`;
    if (view.phase === 'over' && !events?.some((ev) => ev.e === 'handOver')) later(showResult, 300);
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
    renderAll();
    checkRotate();
  };
  window.addEventListener('resize', onResize);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  ro?.observe(el);

  let rotateDismissed = false;
  function checkRotate() {
    const portrait = el.clientHeight > el.clientWidth * 1.1 && el.clientWidth < 700;
    let n = el.querySelector('.mj-rotate');
    if (portrait && !rotateDismissed) {
      if (!n) {
        n = document.createElement('div');
        n.className = 'mj-rotate';
        n.innerHTML = '<div>📱↻<br>请把手机横过来玩麻将<br><button>仍然竖屏</button></div>';
        n.querySelector('button').onclick = () => {
          rotateDismissed = true;
          n.remove();
        };
        el.appendChild(n);
      }
    } else if (n) n.remove();
  }

  computeLayout();
  checkRotate();
  if (view) {
    renderAll();
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
    ro?.disconnect();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    el.remove();
  }

  return {
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
