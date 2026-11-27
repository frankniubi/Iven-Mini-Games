/**
 * Transports carry room-protocol text (JSON, never containing raw newlines) between one host
 * and its clients.
 *
 *   Host transport:   start() → {via, ip?, port?}, onPeer(cb(peerId, isUp)), onMessage(cb(peerId, text)),
 *                     send(peerId, text), kick(peerId), stop()
 *   Client transport: connect(), onMessage(cb(text)), onClose(cb(reason)), send(text), close()
 *   Discovery:        start(cb(room)), stop(); room = {key, via, id, name, info, ip?, port?, rssi?} or {key, lost:true}
 *
 * Kinds:
 *   'lan' — same Wi‑Fi: TCP (capacitor-tcp-socket) + Bonjour/NSD discovery (capacitor-zeroconf-nsd)
 *   'ble' — Bluetooth LE: host is a GATT peripheral, guests are centrals (@capgo/capacitor-bluetooth-low-energy)
 *   'bc'  — BroadcastChannel between tabs of one desktop browser, for testing the multiplayer flow
 *
 * Both native kinds frame messages as UTF-8 lines. Lines starting with '~' are link control
 * (BLE chunk size, BLE kick); room messages always start with '{'.
 */

import { isNativeApp, loadNative, nativePlatform, hasNativePlugin } from '../platform.js';

export const LAN_PORT = 47321;
const BC_CHANNEL = 'ivenhall-net-v1';
const ZC_TYPE = '_ivenhall._tcp.';
const ZC_DOMAIN = 'local.';

// Each BLE room advertises its own service UUID: c6a5<game>-<room code>-4f11-9e5a-6c6f62627900.
const BLE_GAMES = { DDZ: '0001', TCM: '0002' };
const BLE_SUFFIX = '-4f11-9e5a-6c6f62627900';
const BLE_RX = `c6a5ff01-0000${BLE_SUFFIX}`; // guests write here
const BLE_TX = `c6a5ff02-0000${BLE_SUFFIX}`; // host notifies here
const BLE_DEFAULT_CHUNK = 20;

const randomId = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const encoder = new TextEncoder();

export const bcAvailable = typeof BroadcastChannel !== 'undefined';

/** Desktop test mode: `?netdebug=1` once, remembered in localStorage. */
export function netDebugEnabled() {
  try {
    if (/[?&]netdebug=1/.test(window.location.search)) localStorage.setItem('ivenhall_netdebug', '1');
    if (/[?&]netdebug=0/.test(window.location.search)) localStorage.removeItem('ivenhall_netdebug');
    return bcAvailable && localStorage.getItem('ivenhall_netdebug') === '1';
  } catch {
    return false;
  }
}

/** Which ways of playing together this device offers. */
export function availableVias() {
  if (isNativeApp) return ['lan', 'ble'];
  return netDebugEnabled() ? ['bc'] : [];
}

class Emitter {
  constructor() {
    this._peerCb = null;
    this._msgCb = null;
    this._closeCb = null;
  }
  onPeer(cb) {
    this._peerCb = cb;
  }
  onMessage(cb) {
    this._msgCb = cb;
  }
  onClose(cb) {
    this._closeCb = cb;
  }
}

/** Splits an incoming byte stream into text lines. */
class LineReader {
  constructor(onLine) {
    this.onLine = onLine;
    this.decoder = new TextDecoder();
    this.buf = '';
  }
  push(bytes) {
    this.buf += this.decoder.decode(bytes, { stream: true });
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line) this.onLine(line);
    }
  }
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function chunkBytes(bytes, size) {
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(Array.from(bytes.subarray(i, i + size)));
  return out;
}

function friendlyError(err, fallback) {
  const code = err?.code || '';
  const msg = String(err?.message || err || '');
  if (/denied|permission|unauthori/i.test(code + msg)) return new Error('没有权限，请在系统设置里允许');
  if (/power|off|disabled|not enabled/i.test(msg)) return new Error('蓝牙未打开');
  return new Error(msg ? msg.slice(0, 40) : fallback);
}

// ---------- BroadcastChannel (tabs of one browser) ----------

class BcHost extends Emitter {
  constructor(name, info) {
    super();
    this.via = 'bc';
    this.name = name;
    this.info = info;
    this.room = `r${randomId()}`;
    this.peers = new Set();
  }
  async start() {
    this.ch = new BroadcastChannel(BC_CHANNEL);
    this.ch.onmessage = (ev) => {
      const m = ev.data;
      if (!m || m.room !== this.room) return;
      if (m.k === 'conn') {
        this.peers.add(m.from);
        this.ch.postMessage({ k: 'ack', room: this.room, to: m.from });
        this._peerCb?.(`bc:${m.from}`, true);
      } else if (m.k === 'up' && this.peers.has(m.from)) {
        this._msgCb?.(`bc:${m.from}`, m.d);
      } else if (m.k === 'bye' && this.peers.delete(m.from)) {
        this._peerCb?.(`bc:${m.from}`, false);
      }
    };
    const beacon = () => this.ch?.postMessage({ k: 'beacon', room: this.room, name: this.name, info: this.info });
    beacon();
    this.timer = setInterval(beacon, 1000);
    return { via: 'bc' };
  }
  send(peerId, text) {
    this.ch?.postMessage({ k: 'down', room: this.room, to: peerId.slice(3), d: text });
  }
  kick(peerId) {
    const id = peerId.slice(3);
    this.ch?.postMessage({ k: 'kick', room: this.room, to: id });
    if (this.peers.delete(id)) this._peerCb?.(peerId, false);
  }
  stop() {
    clearInterval(this.timer);
    if (!this.ch) return;
    for (const id of this.peers) this.ch.postMessage({ k: 'kick', room: this.room, to: id });
    this.ch.close();
    this.ch = null;
  }
}

class BcClient extends Emitter {
  constructor(target) {
    super();
    this.room = target.id;
    this.me = `c${randomId()}`;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ch = new BroadcastChannel(BC_CHANNEL);
      const timer = setTimeout(() => {
        this.close(true);
        reject(new Error('连接超时'));
      }, 4000);
      this.ch.onmessage = (ev) => {
        const m = ev.data;
        if (!m || m.room !== this.room || m.to !== this.me) return;
        if (m.k === 'ack') {
          clearTimeout(timer);
          resolve();
        } else if (m.k === 'down') {
          this._msgCb?.(m.d);
        } else if (m.k === 'kick') {
          this.close(true);
          this._closeCb?.('kicked');
        }
      };
      this.ch.postMessage({ k: 'conn', room: this.room, from: this.me });
    });
  }
  send(text) {
    this.ch?.postMessage({ k: 'up', room: this.room, from: this.me, d: text });
  }
  close(silent = false) {
    if (!this.ch) return;
    if (!silent) this.ch.postMessage({ k: 'bye', room: this.room, from: this.me });
    this.ch.close();
    this.ch = null;
  }
}

class BcDiscovery {
  start(cb) {
    this.ch = new BroadcastChannel(BC_CHANNEL);
    this.ch.onmessage = (ev) => {
      const m = ev.data;
      if (m && m.k === 'beacon') cb({ key: `bc:${m.room}`, via: 'bc', id: m.room, name: m.name, info: m.info });
    };
  }
  stop() {
    this.ch?.close();
    this.ch = null;
  }
}

// ---------- Wi‑Fi LAN: TCP + Bonjour ----------

async function lanPlugins() {
  const v = await loadNative();
  if (!v) throw new Error('需要在 App 中使用');
  return v;
}

export async function localIp() {
  const v = await loadNative();
  if (!v) return null;
  try {
    if (hasNativePlugin('AppBridge')) return (await v.AppBridge.getLocalIp()).ip || null;
    if (v.CapacitorWifi && hasNativePlugin('CapacitorWifi')) return (await v.CapacitorWifi.getIpAddress()).ipAddress || null;
  } catch {
    // fall through
  }
  return null;
}

/** Reads a TCP client until it closes, feeding lines to onLine. */
async function tcpReadLoop(v, client, onLine, onEnd) {
  const reader = new LineReader(onLine);
  for (;;) {
    let chunk;
    try {
      chunk = await v.TcpSocket.read({ client, expectLen: 65536, timeout: 0, encoding: v.DataEncoding.BASE64 });
    } catch (err) {
      onEnd(err?.code === 'EOF' ? 'closed' : err?.code || 'closed');
      return;
    }
    if (chunk?.result) reader.push(b64ToBytes(chunk.result));
  }
}

class LanHost extends Emitter {
  constructor(name, info) {
    super();
    this.via = 'lan';
    this.name = name;
    this.info = info;
    this.server = null;
    this.peers = new Map();
  }
  async start() {
    const v = await lanPlugins();
    this.v = v;
    let res;
    try {
      res = await v.TcpSocket.listen({ ipAddress: '0.0.0.0', port: LAN_PORT });
    } catch {
      res = await v.TcpSocket.listen({ ipAddress: '0.0.0.0', port: 0 });
    }
    this.server = res.server;
    this.port = res.port;
    this._acceptLoop();
    try {
      await v.ZeroConf.register({ type: ZC_TYPE, domain: ZC_DOMAIN, name: this.name, port: this.port, props: { i: this.info }, addressFamily: 'ipv4' });
      this.registered = true;
    } catch (err) {
      console.warn('zeroconf register failed', err);
    }
    let ip = await localIp();
    if (!ip && this.registered) ip = await this._ownAddress();
    return { via: 'lan', ip, port: this.port };
  }
  /** iOS has no direct IP lookup here: find our own Bonjour record instead (best effort, 3 s). */
  _ownAddress() {
    return new Promise((resolve) => {
      const finder = new LanDiscovery();
      const done = (ip) => {
        clearTimeout(timer);
        finder.stop();
        resolve(ip);
      };
      const timer = setTimeout(() => done(null), 3000);
      finder.start((room) => {
        if (!room.lost && room.name === this.name && room.ip) done(room.ip);
      }).catch(() => done(null));
    });
  }
  async _acceptLoop() {
    while (this.server != null) {
      try {
        const { client } = await this.v.TcpSocket.accept({ server: this.server, timeout: 0 });
        this._addPeer(client);
      } catch (err) {
        if (this.server == null || err?.code === 'CLOSED') return;
        await sleep(300);
      }
    }
  }
  _addPeer(client) {
    const id = `lan:${client}`;
    this.peers.set(id, client);
    this._peerCb?.(id, true);
    tcpReadLoop(
      this.v,
      client,
      (line) => {
        if (line[0] !== '~') this._msgCb?.(id, line);
      },
      () => {
        if (this.peers.delete(id)) this._peerCb?.(id, false);
      },
    );
  }
  send(peerId, text) {
    const client = this.peers.get(peerId);
    if (client != null) this.v.TcpSocket.send({ client, data: `${text}\n`, encoding: this.v.DataEncoding.UTF8 }).catch(() => {});
  }
  kick(peerId) {
    const client = this.peers.get(peerId);
    if (client == null) return;
    this.peers.delete(peerId);
    this.v.TcpSocket.disconnect({ client }).catch(() => {});
    this._peerCb?.(peerId, false);
  }
  stop() {
    if (!this.v) return;
    const server = this.server;
    this.server = null;
    for (const client of this.peers.values()) this.v.TcpSocket.disconnect({ client }).catch(() => {});
    this.peers.clear();
    if (server != null) this.v.TcpSocket.closeServer({ server }).catch(() => {});
    if (this.registered) this.v.ZeroConf.unregister({ type: ZC_TYPE, domain: ZC_DOMAIN, name: this.name }).catch(() => {});
  }
}

class LanClient extends Emitter {
  constructor(target) {
    super();
    this.target = target;
    this.client = null;
  }
  async connect() {
    const v = await lanPlugins();
    this.v = v;
    const { ip, port } = this.target;
    if (!ip) throw new Error('没有找到房主的地址');
    try {
      this.client = (await v.TcpSocket.connect({ ipAddress: ip, port: port || LAN_PORT, timeout: 6 })).client;
    } catch (err) {
      throw new Error(err?.code === 'TIMEOUT' ? '连接超时，确认在同一个 Wi‑Fi' : '连不上房主');
    }
    const client = this.client;
    tcpReadLoop(
      v,
      client,
      (line) => {
        if (line[0] !== '~') this._msgCb?.(line);
      },
      (reason) => {
        if (this.client === client) {
          this.client = null;
          this._closeCb?.(reason);
        }
      },
    );
  }
  send(text) {
    if (this.client != null) this.v.TcpSocket.send({ client: this.client, data: `${text}\n`, encoding: this.v.DataEncoding.UTF8 }).catch(() => {});
  }
  close() {
    const client = this.client;
    this.client = null;
    if (client != null) this.v.TcpSocket.disconnect({ client }).catch(() => {});
  }
}

let zcWatching = false;
const zcFinders = new Set();

class LanDiscovery {
  async start(cb) {
    this.cb = cb;
    const v = await lanPlugins();
    this.v = v;
    zcFinders.add(this);
    if (!zcWatching) {
      zcWatching = true;
      try {
        // Events arrive through this callback; the plugin's 'discover' listener is Electron-only.
        await v.ZeroConf.watch({ type: ZC_TYPE, domain: ZC_DOMAIN }, (res) => zcFinders.forEach((f) => f._event(res)));
      } catch (err) {
        zcWatching = false;
        zcFinders.delete(this);
        throw err;
      }
    }
  }
  _event(res) {
    const s = res?.service;
    if (!res?.action || !s || !s.name) return; // Android's first callback carries no action
    const key = `lan:${s.name}`;
    if (res.action === 'removed') {
      this.cb?.({ key, lost: true });
      return;
    }
    const ip = (s.ipv4Addresses || []).find((a) => a && a !== '0.0.0.0');
    if (!ip) return;
    this.cb?.({ key, via: 'lan', id: s.name, name: s.name, info: s.txtRecord?.i || '', ip, port: s.port });
  }
  stop() {
    zcFinders.delete(this);
    if (!zcFinders.size && this.v && zcWatching) {
      zcWatching = false;
      this.v.ZeroConf.unwatch({ type: ZC_TYPE, domain: ZC_DOMAIN }).catch(() => {});
    }
  }
}

// ---------- Bluetooth LE ----------

let bleMode = null;
let bleListeners = null;
const bleRoutes = { host: null, client: null, finders: new Set() };

async function blePlugin(mode) {
  const v = await loadNative();
  if (!v) throw new Error('需要在 App 中使用');
  const BLE = v.BluetoothLowEnergy;
  if (!BLE) throw new Error('蓝牙插件缺失');
  if (bleMode !== mode) {
    try {
      await BLE.initialize({ mode, showPowerAlert: false });
    } catch (err) {
      throw friendlyError(err, '蓝牙初始化失败');
    }
    bleMode = mode;
  }
  // The permission prompt can leave requestPermissions pending even after the user answers,
  // so check first, request with a time limit, then check again.
  let perm = await BLE.checkPermissions().catch(() => null);
  if (perm?.bluetooth !== 'granted') {
    await Promise.race([BLE.requestPermissions().catch(() => null), sleep(20000)]);
    perm = await BLE.checkPermissions().catch(() => null);
    if (perm && perm.bluetooth !== 'granted') throw new Error('没有蓝牙权限，请在系统设置里允许');
  }
  try {
    if (!(await BLE.isEnabled()).enabled) throw new Error('蓝牙未打开');
  } catch (err) {
    if (err?.message === '蓝牙未打开') throw err;
  }
  if (!bleListeners) {
    bleListeners = [
      await BLE.addListener('centralConnected', (e) => bleRoutes.host?._central(devId(e), true)),
      await BLE.addListener('centralDisconnected', (e) => bleRoutes.host?._central(devId(e), false)),
      await BLE.addListener('gattCharacteristicWriteRequest', (e) => bleRoutes.host?._write({ ...e, deviceId: devId(e) })),
      await BLE.addListener('characteristicChanged', (e) => bleRoutes.client?._notify({ ...e, deviceId: devId(e) })),
      await BLE.addListener('deviceDisconnected', (e) => bleRoutes.client?._gone(devId(e))),
      await BLE.addListener('deviceScanned', (e) => bleRoutes.finders.forEach((f) => f._scanned(e))),
    ];
  }
  // Wrapped: a Capacitor plugin proxy answers any property, including `then`, so returning it
  // from an async function would make `await` hang on a native "then" call.
  return { BLE };
}

const devId = (e) => e?.deviceId ?? e?.device?.deviceId;
const sameUuid = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

function bleServiceFor(name) {
  const m = /^([A-Z]{3})-(\d{4})$/.exec(name);
  if (!m || !BLE_GAMES[m[1]]) throw new Error('房间名无效');
  return `c6a5${BLE_GAMES[m[1]]}-${m[2]}${BLE_SUFFIX}`;
}

/**
 * Sends lines as ordered chunks, one GATT operation at a time. `paceMs` spaces notifications
 * (Android's notify resolves before the packet is out); failed chunks are retried a few times
 * (iOS rejects a notify while its transmit queue is full).
 */
class ChunkQueue {
  constructor(sendChunk, paceMs = 0) {
    this.sendChunk = sendChunk;
    this.paceMs = paceMs;
    this.q = [];
    this.busy = false;
    this.size = BLE_DEFAULT_CHUNK;
  }
  push(text) {
    for (const c of chunkBytes(encoder.encode(`${text}\n`), this.size)) this.q.push(c);
    this.pump();
  }
  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.q.length) {
      const c = this.q[0];
      let sent = false;
      for (let attempt = 0; attempt < 8 && !sent; attempt++) {
        try {
          await this.sendChunk(c);
          sent = true;
        } catch {
          await sleep(30 * (attempt + 1));
        }
      }
      if (!sent) {
        this.q.length = 0;
        break;
      }
      this.q.shift();
      if (this.paceMs) await sleep(this.paceMs);
    }
    this.busy = false;
  }
}

class BleHost extends Emitter {
  constructor(name) {
    super();
    this.via = 'ble';
    this.name = name;
    this.service = bleServiceFor(name);
    this.peers = new Map();
  }
  async start() {
    const { BLE } = await blePlugin('peripheral');
    this.BLE = BLE;
    bleRoutes.host = this;
    try {
      await BLE.addGattService({
        service: this.service,
        characteristics: [
          { uuid: BLE_RX, properties: { write: true, writeWithoutResponse: true } },
          { uuid: BLE_TX, properties: { read: true, notify: true }, value: [] },
        ],
      });
      await BLE.startAdvertising({ services: [this.service], includeName: false });
    } catch (err) {
      bleRoutes.host = null;
      throw friendlyError(err, '蓝牙广播失败');
    }
    return { via: 'ble' };
  }
  _peer(deviceId) {
    let p = this.peers.get(deviceId);
    if (!p) {
      const id = `ble:${deviceId}`;
      p = {
        id,
        reader: new LineReader((line) => this._line(p, line)),
        out: new ChunkQueue((value) => this.BLE.notifyGattCharacteristicChanged({ service: this.service, characteristic: BLE_TX, value, deviceId }), nativePlatform === 'android' ? 12 : 0),
      };
      this.peers.set(deviceId, p);
      this._peerCb?.(id, true);
    }
    return p;
  }
  _central(deviceId, up) {
    if (up) {
      this._peer(deviceId);
      return;
    }
    const p = this.peers.get(deviceId);
    if (!p) return;
    this.peers.delete(deviceId);
    this._peerCb?.(p.id, false);
  }
  _write(e) {
    if (!sameUuid(e.characteristic, BLE_RX) || !sameUuid(e.service, this.service)) return;
    this._peer(e.deviceId).reader.push(Uint8Array.from(e.value || []));
  }
  _line(p, line) {
    if (line.startsWith('~chunk:')) {
      p.out.size = Math.max(BLE_DEFAULT_CHUNK, Math.min(244, Number(line.slice(7)) || BLE_DEFAULT_CHUNK));
    } else if (line[0] !== '~') {
      this._msgCb?.(p.id, line);
    }
  }
  _byId(peerId) {
    for (const p of this.peers.values()) if (p.id === peerId) return p;
    return null;
  }
  send(peerId, text) {
    this._byId(peerId)?.out.push(text);
  }
  kick(peerId) {
    const p = this._byId(peerId);
    if (!p) return;
    p.out.push('~bye');
    for (const [dev, q] of this.peers) if (q === p) this.peers.delete(dev);
    this._peerCb?.(peerId, false);
  }
  stop() {
    if (bleRoutes.host === this) bleRoutes.host = null;
    if (!this.BLE) return;
    for (const p of this.peers.values()) p.out.push('~bye');
    this.peers.clear();
    setTimeout(() => {
      this.BLE.stopAdvertising().catch(() => {});
      this.BLE.removeGattService({ service: this.service }).catch(() => {});
    }, 400);
  }
}

class BleClient extends Emitter {
  constructor(target) {
    super();
    this.deviceId = target.id;
    this.service = target.service;
    this.open = false;
    this.reader = new LineReader((line) => {
      if (line === '~bye') {
        this.close();
        this._closeCb?.('kicked');
      } else if (line[0] !== '~') {
        this._msgCb?.(line);
      }
    });
  }
  async connect() {
    const { BLE } = await blePlugin('central');
    this.BLE = BLE;
    const deviceId = this.deviceId;
    try {
      await BLE.connect({ deviceId });
      await BLE.discoverServices({ deviceId });
    } catch (err) {
      throw friendlyError(err, '蓝牙连接失败');
    }
    // Android negotiates here; on iOS the call just reports the MTU the system already agreed.
    let size = BLE_DEFAULT_CHUNK;
    try {
      const r = await BLE.requestMtu({ deviceId, mtu: 247 });
      if (r?.mtu) size = Math.max(BLE_DEFAULT_CHUNK, Math.min(244, r.mtu - 3));
    } catch {
      if (nativePlatform === 'ios') size = 180;
    }
    this.out = new ChunkQueue((value) => BLE.writeCharacteristic({ deviceId, service: this.service, characteristic: BLE_RX, value, type: 'withResponse' }));
    bleRoutes.client = this;
    try {
      await BLE.startCharacteristicNotifications({ deviceId, service: this.service, characteristic: BLE_TX });
    } catch (err) {
      bleRoutes.client = null;
      BLE.disconnect({ deviceId }).catch(() => {});
      throw friendlyError(err, '蓝牙订阅失败');
    }
    this.open = true;
    this.out.push(`~chunk:${size}`);
    this.out.size = size;
  }
  _notify(e) {
    if (e.deviceId !== this.deviceId || !sameUuid(e.characteristic, BLE_TX)) return;
    this.reader.push(Uint8Array.from(e.value || []));
  }
  _gone(deviceId) {
    if (deviceId !== this.deviceId || !this.open) return;
    this.open = false;
    if (bleRoutes.client === this) bleRoutes.client = null;
    this._closeCb?.('closed');
  }
  send(text) {
    if (this.open) this.out.push(text);
  }
  close() {
    if (!this.open) return;
    this.open = false;
    if (bleRoutes.client === this) bleRoutes.client = null;
    this.BLE.disconnect({ deviceId: this.deviceId }).catch(() => {});
  }
}

const BLE_SERVICE_RE = /^c6a5(\d{4})-(\d{4})-4f11-9e5a-6c6f62627900$/i;
const BLE_GAME_BY_NUM = Object.fromEntries(Object.entries(BLE_GAMES).map(([k, v]) => [v, k]));

class BleDiscovery {
  async start(cb) {
    this.cb = cb;
    const { BLE } = await blePlugin('central');
    this.BLE = BLE;
    bleRoutes.finders.add(this);
    try {
      await BLE.startScan({ timeout: 0, allowDuplicates: true });
    } catch (err) {
      bleRoutes.finders.delete(this);
      throw friendlyError(err, '蓝牙搜索失败');
    }
  }
  _scanned(e) {
    const d = e.device || e; // deviceScanned delivers {device: {deviceId, rssi, serviceUuids}}
    for (const uuid of d.serviceUuids || []) {
      const m = BLE_SERVICE_RE.exec(uuid);
      const game = m && BLE_GAME_BY_NUM[m[1]];
      if (!game) continue;
      this.cb?.({ key: `ble:${d.deviceId}`, via: 'ble', id: d.deviceId, name: `${game}-${m[2]}`, info: '', rssi: d.rssi, service: uuid.toLowerCase() });
      return;
    }
  }
  stop() {
    bleRoutes.finders.delete(this);
    if (!bleRoutes.finders.size) this.BLE?.stopScan().catch(() => {});
  }
}

/** Link status for the host lobby. */
export async function nativeStatus() {
  const v = await loadNative();
  const out = { lan: { available: Boolean(v?.TcpSocket), ip: null }, ble: { available: false, state: 'unsupported' } };
  if (!v) return out;
  out.lan.ip = await localIp();
  const BLE = v.BluetoothLowEnergy;
  if (BLE) {
    try {
      const avail = (await BLE.isAvailable()).available;
      out.ble.available = avail;
      out.ble.state = !avail ? 'unsupported' : (await BLE.isEnabled()).enabled ? 'on' : 'off';
    } catch {
      out.ble.state = 'unknown';
      out.ble.available = true;
    }
  }
  return out;
}

// ---------- factories ----------

export function createHostTransport(via, name, info) {
  if (via === 'bc') return new BcHost(name, info);
  if (via === 'lan') return new LanHost(name, info);
  return new BleHost(name);
}

/** target: a discovered room ({via, id, ip?, port?, service?}) or a manual LAN address ({via:'lan', ip, port}). */
export function createClientTransport(target) {
  if (target.via === 'bc') return new BcClient(target);
  if (target.via === 'lan') return new LanClient(target);
  return new BleClient(target);
}

export function createDiscovery(via) {
  if (via === 'bc') return new BcDiscovery();
  if (via === 'lan') return new LanDiscovery();
  return new BleDiscovery();
}
