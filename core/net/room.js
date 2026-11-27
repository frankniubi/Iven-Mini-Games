/**
 * Room layer shared by the networked card games.
 *
 * The host device runs the authoritative match with the game's engine, fills empty seats with
 * bots, and sends every human a personalised view after each action. Everyone, including the
 * host's own player, talks to the room through RoomClient, so the table UI has one code path.
 *
 * Game definition (`def`) a game passes in:
 *   { id, code, seats, engine: {createMatch, startHand, getView, getPendingSeats, applyAction, isHandOver},
 *     botAction(view, memory, opts), fallbackAction(view), botDelay?(view), botProfiles: [{name, avatar}] }
 *
 * Wire protocol (JSON text):
 *   client → host  hello{v, game, name, avatar, token} · act{a, seq} · ready{ready} · auto{on} · emote{id} · ping{ts} · bye
 *   host → client  welcome{seat, code, settings, hostName} · reject{reason} · seats{seats, settings, started}
 *                  state{view, events} · error{error} · emote{seat, id} · pong{ts} · end{reason}
 */

import { createClientTransport } from './transports.js';

export const PROTOCOL_VERSION = 1;

const DISCONNECT_GRACE_MS = 12000;
const PEER_TIMEOUT_MS = 20000;
const PING_EVERY_MS = 4000;
const CLIENT_SILENCE_MS = 15000;
const RECONNECT_WINDOW_MS = 90000;

/** Views go over Bluetooth too: drop the settings blob (clients get settings with the seats). */
function wireView(view) {
  if (!view || !view.settings) return view;
  const { settings, ...rest } = view;
  return rest;
}

const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12) || '玩家';

// ---------- loopback link for the host's own player ----------

class LoopbackClient {
  constructor(host) {
    this.host = host;
    this.peerId = 'local';
    this._msgCb = null;
    this._closeCb = null;
    this.open = false;
  }
  onMessage(cb) {
    this._msgCb = cb;
  }
  onClose(cb) {
    this._closeCb = cb;
  }
  async connect() {
    this.open = true;
    this.host._peerUp(this.peerId, this);
  }
  send(text) {
    if (this.open) setTimeout(() => this.host._onMessage(this.peerId, text), 0);
  }
  deliver(text) {
    if (this.open) setTimeout(() => this.open && this._msgCb?.(text), 0);
  }
  close() {
    this.open = false;
  }
}

// ---------- host ----------

export class RoomHost {
  /**
   * @param {object} o
   * @param {object} o.def        game definition
   * @param {object} o.settings   game settings (engine-specific, plus botLevel)
   * @param {object} o.me         {name, avatar, token} of the host's player (seat 0)
   * @param {string} o.code       4-digit room code shown to friends
   * @param {function} [o.onChange] called whenever seats/match change (host-side UI refresh)
   * @param {function} [o.persist]  called with a snapshot after each state change (solo resume)
   */
  constructor({ def, settings, me, code, onChange, persist }) {
    this.def = def;
    this.settings = { ...settings };
    this.code = code;
    this.onChange = onChange || (() => {});
    this.persist = persist || null;
    this.seats = Array.from({ length: def.seats }, () => ({ kind: 'empty' }));
    this.seats[0] = { kind: 'human', name: cleanName(me.name), avatar: me.avatar, token: me.token, peer: 'local', connected: true, ready: false, auto: false };
    this.transports = [];
    this.links = [];
    this.peers = new Map();
    this.match = null;
    this.memory = [];
    this.timers = new Map();
    this.started = false;
    this.closed = false;
    this.local = null;
    this.watchdog = setInterval(() => this._checkPeers(), 5000);
  }

  /** Opens the room on a host transport (LAN / BLE / BroadcastChannel). Returns link info or throws. */
  async addTransport(t) {
    t.onPeer((peerId, up) => (up ? this._peerUp(peerId, t) : this._peerDown(peerId)));
    t.onMessage((peerId, text) => this._onMessage(peerId, text));
    const info = await t.start();
    this.transports.push(t);
    this.links.push(info);
    this.onChange();
    return info;
  }

  createLocalClient() {
    this.local = new LoopbackClient(this);
    return this.local;
  }

  setSettings(next) {
    this.settings = { ...this.settings, ...next };
    this._broadcastSeats();
  }

  kick(seat) {
    const s = this.seats[seat];
    if (!s || seat === 0 || s.kind !== 'human') return;
    const peerId = s.peer;
    this._send(peerId, { t: 'reject', reason: '你被房主移出了房间' });
    this.seats[seat] = this.started ? this._botSeat(seat) : { kind: 'empty' };
    this.peers.delete(peerId);
    this._transportOf(peerId)?.kick(peerId);
    this._broadcastSeats();
    if (this.started) this._scheduleBots();
  }

  /** Starts the first hand; empty seats become bots. */
  start() {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].kind === 'empty') this.seats[i] = this._botSeat(i);
    }
    const seed = (Math.random() * 2 ** 31) | 0;
    this.match = this.def.engine.createMatch(this.settings, seed);
    this._beginHand();
  }

  /** Restores a saved solo session (snapshot from `persist`). */
  restore(snap) {
    this.settings = { ...snap.settings };
    this.match = snap.match;
    this.memory = snap.memory || [];
    this.started = true;
    snap.seats.forEach((s, i) => {
      if (i === 0) return;
      this.seats[i] = { kind: 'bot', name: s.name, avatar: s.avatar };
    });
    this._broadcastSeats();
    this._broadcastState([]);
  }

  close(reason = '房主已关闭房间') {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watchdog);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    for (const [peerId] of this.peers) if (peerId !== 'local') this._send(peerId, { t: 'end', reason });
    setTimeout(() => this.transports.forEach((t) => t.stop()), 300);
    this.local?.close();
  }

  humanCount() {
    return this.seats.filter((s) => s.kind === 'human').length;
  }

  seatsPublic() {
    return this.seats.map((s) => ({
      kind: s.kind,
      name: s.name || '',
      avatar: s.avatar || '',
      connected: s.kind === 'human' ? Boolean(s.connected) : s.kind === 'bot',
      ready: Boolean(s.ready),
      auto: Boolean(s.auto),
      host: s.peer === 'local',
    }));
  }

  // ---- internals ----

  _botSeat(i) {
    const used = new Set(this.seats.map((s) => s.name));
    const pool = this.def.botProfiles || [];
    const pick = pool.find((p) => !used.has(p.name)) || { name: `电脑${i}`, avatar: '🤖' };
    return { kind: 'bot', name: pick.name, avatar: pick.avatar, ready: true };
  }

  _transportOf(peerId) {
    return this.peers.get(peerId)?.link || null;
  }

  _peerUp(peerId, link) {
    this.peers.set(peerId, { link, seat: null, lastSeen: Date.now() });
  }

  _peerDown(peerId) {
    const p = this.peers.get(peerId);
    this.peers.delete(peerId);
    if (!p || p.seat == null) return;
    const s = this.seats[p.seat];
    if (s.peer !== peerId) return;
    if (!this.started) {
      this.seats[p.seat] = { kind: 'empty' };
    } else {
      s.connected = false;
      s.droppedAt = Date.now();
      setTimeout(() => {
        if (!s.connected && this.seats.includes(s)) {
          s.auto = true;
          this._broadcastSeats();
          this._scheduleBots();
          this._maybeNextHand();
        }
      }, DISCONNECT_GRACE_MS);
    }
    this._broadcastSeats();
  }

  _checkPeers() {
    const now = Date.now();
    for (const [peerId, p] of this.peers) {
      if (peerId === 'local') continue;
      if (now - p.lastSeen > PEER_TIMEOUT_MS) {
        this._transportOf(peerId)?.kick(peerId);
        this._peerDown(peerId);
      }
    }
  }

  _send(peerId, msg) {
    if (!peerId) return;
    const text = JSON.stringify(msg);
    if (peerId === 'local') this.local?.deliver(text);
    else this._transportOf(peerId)?.send(peerId, text);
  }

  _onMessage(peerId, text) {
    if (this.closed) return;
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.lastSeen = Date.now();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    const seat = peer.seat;
    switch (m.t) {
      case 'hello':
        this._hello(peerId, peer, m);
        break;
      case 'ping':
        this._send(peerId, { t: 'pong', ts: m.ts });
        break;
      case 'act':
        if (seat != null) this._act(seat, peerId, m.a);
        break;
      case 'ready':
        if (seat != null) {
          this.seats[seat].ready = Boolean(m.ready);
          this._broadcastSeats();
          this._maybeNextHand();
        }
        break;
      case 'auto':
        if (seat != null) {
          this.seats[seat].auto = Boolean(m.on);
          this._broadcastSeats();
          this._scheduleBots();
        }
        break;
      case 'emote':
        if (seat != null) this._broadcast({ t: 'emote', seat, id: String(m.id).slice(0, 24) });
        break;
      case 'bye':
        if (peerId !== 'local') {
          this._transportOf(peerId)?.kick(peerId);
          this._peerDown(peerId);
        }
        break;
      default:
        break;
    }
  }

  _hello(peerId, peer, m) {
    if (m.v !== PROTOCOL_VERSION || m.game !== this.def.id) {
      this._send(peerId, { t: 'reject', reason: '游戏版本不一致，请先同步更新' });
      return;
    }
    let seat = this.seats.findIndex((s) => s.kind === 'human' && s.token === m.token);
    if (peerId === 'local') seat = 0;
    if (seat < 0) seat = this.seats.findIndex((s) => s.kind === 'empty');
    if (seat < 0 && this.started) seat = this.seats.findIndex((s) => s.kind === 'bot');
    if (seat < 0) {
      this._send(peerId, { t: 'reject', reason: '房间已满' });
      return;
    }
    const s = this.seats[seat];
    if (s.kind === 'human' && s.peer && s.peer !== peerId && this.peers.has(s.peer)) {
      const old = s.peer;
      this.peers.get(old).seat = null;
      this._transportOf(old)?.kick(old);
    }
    const wasBot = s.kind === 'bot';
    Object.assign(s, {
      kind: 'human',
      name: cleanName(m.name),
      avatar: String(m.avatar || '🙂').slice(0, 8),
      token: m.token,
      peer: peerId,
      connected: true,
      auto: false,
      droppedAt: 0,
    });
    if (wasBot) s.ready = true;
    peer.seat = seat;
    this._send(peerId, { t: 'welcome', seat, code: this.code, settings: this.settings, hostName: this.seats[0].name });
    this._broadcastSeats();
    if (this.started && this.match) {
      this._send(peerId, { t: 'state', view: wireView(this.def.engine.getView(this.match, seat)), events: [] });
    }
  }

  _act(seat, peerId, action) {
    if (!this.match || !action || typeof action !== 'object') return;
    const res = this.def.engine.applyAction(this.match, seat, action);
    if (!res.ok) {
      this._send(peerId, { t: 'error', error: res.error || '这样出不行' });
      this._send(peerId, { t: 'state', view: wireView(this.def.engine.getView(this.match, seat)), events: [] });
      return;
    }
    this._afterAction(res.events || []);
  }

  _afterAction(events) {
    if (this.def.engine.isHandOver(this.match)) {
      for (const s of this.seats) s.ready = s.kind !== 'human';
      this._broadcastSeats();
    }
    this._broadcastState(events);
    this._maybeNextHand();
  }

  _beginHand() {
    this.def.engine.startHand(this.match);
    this.memory = this.seats.map(() => ({}));
    for (const s of this.seats) s.ready = s.kind !== 'human';
    this._broadcastSeats();
    // Engines may expose start-of-hand events (e.g. mahjong 翻财神 / 补花); they are public.
    const opening = (this.match.lastEvents || []).filter((ev) => ev.e !== 'draw' && ev.e !== 'deal');
    this._broadcastState([{ e: 'newHand', handNo: this.match.handNo }, ...opening]);
  }

  _maybeNextHand() {
    if (!this.match || !this.def.engine.isHandOver(this.match)) return;
    const humans = this.seats.filter((s) => s.kind === 'human');
    // Someone present has to press 继续; players on 托管 or offline never hold the table up.
    if (!humans.some((s) => s.connected && s.ready)) return;
    if (humans.every((s) => s.ready || s.auto || !s.connected)) {
      setTimeout(() => {
        if (!this.closed && this.def.engine.isHandOver(this.match)) this._beginHand();
      }, 400);
    }
  }

  _broadcast(msg) {
    for (const s of this.seats) if (s.kind === 'human' && s.connected) this._send(s.peer, msg);
  }

  _broadcastSeats() {
    this._broadcast({ t: 'seats', seats: this.seatsPublic(), settings: this.settings, started: this.started, code: this.code });
    this.onChange();
  }

  _broadcastState(events) {
    if (!this.match) return;
    this.seats.forEach((s, seat) => {
      if (s.kind === 'human' && s.connected) {
        this._send(s.peer, { t: 'state', view: wireView(this.def.engine.getView(this.match, seat)), events });
      }
    });
    if (this.persist) {
      this.persist({
        settings: this.settings,
        seats: this.seatsPublic(),
        match: this.match,
        memory: this.memory,
      });
    }
    this.onChange();
    this._scheduleBots();
  }

  _isAutomated(s) {
    return s.kind === 'bot' || (s.kind === 'human' && (s.auto || (!s.connected && Date.now() - (s.droppedAt || 0) > DISCONNECT_GRACE_MS)));
  }

  _scheduleBots() {
    if (!this.match || this.closed || this.def.engine.isHandOver(this.match)) return;
    const pending = this.def.engine.getPendingSeats(this.match);
    for (const seat of pending) {
      const s = this.seats[seat];
      if (!this._isAutomated(s) || this.timers.has(seat)) continue;
      if (this.def.engine.getLegalActions && !this.def.engine.getLegalActions(this.match, seat)) continue;
      const view = this.def.engine.getView(this.match, seat);
      const delay = this.def.botDelay ? this.def.botDelay(view) : 650 + Math.random() * 650;
      this.timers.set(
        seat,
        setTimeout(() => {
          this.timers.delete(seat);
          this._botMove(seat);
        }, s.kind === 'bot' ? delay : Math.min(delay, 500)),
      );
    }
  }

  _botMove(seat) {
    if (!this.match || this.closed || this.def.engine.isHandOver(this.match)) return;
    if (!this.def.engine.getPendingSeats(this.match).includes(seat)) return;
    if (!this._isAutomated(this.seats[seat])) return;
    if (this.def.engine.getLegalActions && !this.def.engine.getLegalActions(this.match, seat)) return;
    const view = this.def.engine.getView(this.match, seat);
    let res = null;
    try {
      const action = this.def.botAction(view, this.memory[seat] || (this.memory[seat] = {}), { level: this.settings.botLevel });
      res = this.def.engine.applyAction(this.match, seat, action);
    } catch (err) {
      console.warn('bot error', err);
    }
    if (!res || !res.ok) {
      res = this.def.engine.applyAction(this.match, seat, this.def.fallbackAction(view));
      if (!res.ok) {
        console.error('bot fallback rejected', res.error);
        return;
      }
    }
    this._afterAction(res.events || []);
  }
}

// ---------- client ----------

export class RoomClient {
  /**
   * @param {object} o
   * @param {object} o.def        game definition (only id is needed client-side)
   * @param {object} o.me         {name, avatar, token}
   * @param {object} [o.target]   discovered room / manual address for remote rooms
   * @param {object} [o.transport] prebuilt transport (host's loopback)
   */
  constructor({ def, me, target, transport }) {
    this.def = def;
    this.me = me;
    this.target = target || null;
    this.fixedTransport = transport || null;
    this.t = null;
    this.seat = -1;
    this.seats = [];
    this.settings = {};
    this.started = false;
    this.code = '';
    this.view = null;
    this.status = 'idle';
    this.listeners = new Map();
    this.leaving = false;
    this.lastHeard = 0;
    this.pinger = null;
    this.reconnectDeadline = 0;
  }

  on(evt, cb) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(cb);
    return () => this.listeners.get(evt)?.delete(cb);
  }

  _emit(evt, ...args) {
    this.listeners.get(evt)?.forEach((cb) => {
      try {
        cb(...args);
      } catch (err) {
        console.error(err);
      }
    });
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this._emit('status', s);
  }

  /** Connects and waits for the welcome (rejects with a Chinese reason on failure). */
  async connect() {
    this.leaving = false;
    this._setStatus('connecting');
    await this._open();
    this._startPing();
  }

  async _open() {
    const t = this.fixedTransport || createClientTransport(this.target);
    this.t = t;
    const welcome = new Promise((resolve, reject) => {
      this._pendingWelcome = { resolve, reject };
    });
    t.onMessage((text) => this._onMessage(text));
    t.onClose((reason) => this._onClosed(t, reason));
    try {
      await t.connect();
    } catch (err) {
      this._pendingWelcome = null;
      throw new Error(err?.message || '连接失败');
    }
    this.lastHeard = Date.now();
    this._send({ t: 'hello', v: PROTOCOL_VERSION, game: this.def.id, name: this.me.name, avatar: this.me.avatar, token: this.me.token });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('房主没有响应')), 8000));
    try {
      await Promise.race([welcome, timeout]);
    } catch (err) {
      this._pendingWelcome = null;
      t.close();
      throw err;
    }
    this._setStatus('connected');
  }

  _send(msg) {
    this.t?.send(JSON.stringify(msg));
  }

  _onMessage(text) {
    this.lastHeard = Date.now();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    switch (m.t) {
      case 'welcome':
        this.seat = m.seat;
        this.code = m.code;
        this.settings = m.settings || {};
        this.hostName = m.hostName;
        this._pendingWelcome?.resolve(m);
        this._pendingWelcome = null;
        this._emit('welcome', m);
        break;
      case 'reject':
        this._pendingWelcome?.reject(new Error(m.reason));
        this._pendingWelcome = null;
        this._emit('rejected', m.reason);
        this.leave(true);
        break;
      case 'seats':
        this.seats = m.seats;
        this.settings = m.settings || this.settings;
        this.started = m.started;
        this.code = m.code || this.code;
        this._emit('seats', m.seats);
        break;
      case 'state':
        this.view = m.view;
        this._emit('state', m.view, m.events || []);
        break;
      case 'error':
        this._emit('error', m.error);
        break;
      case 'emote':
        this._emit('emote', m.seat, m.id);
        break;
      case 'end':
        this._emit('end', m.reason);
        this.leave(true);
        break;
      default:
        break;
    }
  }

  _startPing() {
    clearInterval(this.pinger);
    if (this.fixedTransport) return;
    this.pinger = setInterval(() => {
      if (this.status !== 'connected') return;
      this._send({ t: 'ping', ts: Date.now() });
      if (Date.now() - this.lastHeard > CLIENT_SILENCE_MS) {
        const t = this.t;
        t?.close();
        this._onClosed(t, 'timeout');
      }
    }, PING_EVERY_MS);
  }

  _onClosed(t, reason) {
    if (t !== this.t || this.leaving) return;
    this.t = null;
    if (reason === 'kicked') {
      this._setStatus('closed');
      this._emit('end', '你已离开房间');
      return;
    }
    this._reconnect();
  }

  async _reconnect() {
    this._setStatus('reconnecting');
    this.reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;
    while (!this.leaving && Date.now() < this.reconnectDeadline) {
      try {
        await this._open();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!this.leaving) {
      this._setStatus('closed');
      this._emit('end', '和房主的连接断开了');
    }
  }

  act(action) {
    this._send({ t: 'act', a: action, seq: this.view?.seq });
  }

  setReady(ready = true) {
    this._send({ t: 'ready', ready });
  }

  setAuto(on) {
    this._send({ t: 'auto', on });
  }

  emote(id) {
    this._send({ t: 'emote', id });
  }

  leave(silent = false) {
    if (this.leaving) return;
    this.leaving = true;
    clearInterval(this.pinger);
    if (!silent) this._send({ t: 'bye' });
    const t = this.t;
    this.t = null;
    setTimeout(() => t?.close(), 100);
    this._setStatus('closed');
  }
}

/** Persistent identity for this device (name/avatar editable in the lobby). */
export function loadPlayer(store) {
  let p = store.get('player', null);
  if (!p || !p.token) {
    const avatars = ['🐱', '🐶', '🐼', '🦊', '🐰', '🐻', '🐨', '🐯', '🐸', '🐧'];
    p = {
      name: `玩家${Math.floor(100 + Math.random() * 900)}`,
      avatar: avatars[Math.floor(Math.random() * avatars.length)],
      token: Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
    };
    store.set('player', p);
  }
  return p;
}
