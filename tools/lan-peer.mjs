/**
 * Desktop stand-in for a phone on the same Wi‑Fi, speaking the app's LAN protocol
 * (newline-delimited JSON over TCP). Used to test the real app in an emulator:
 *
 *   node tools/lan-peer.mjs join <host> <port> <game> [name]   join a room hosted by the app (adb forward tcp:47321 tcp:47321)
 *   node tools/lan-peer.mjs host <port> <game>                 host a room the app can join by IP (10.0.2.2 from the emulator)
 *
 * In both modes this side plays automatically with the game's bot.
 */

import net from 'node:net';
import { RoomHost, RoomClient } from '../core/net/room.js';

const [mode, ...rest] = process.argv.slice(2);

async function loadDef(game) {
  if (game === 'doudizhu') return (await import('../games/doudizhu/index.js')).DDZ_DEF;
  return (await import('../games/taicang-mj/index.js')).MJ_DEF;
}

/** Line-framed socket → room-client transport. */
class TcpClientTransport {
  constructor(host, port) {
    this.host = host;
    this.port = port;
  }
  onMessage(cb) {
    this._msg = cb;
  }
  onClose(cb) {
    this._close = cb;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.port, this.host, () => resolve());
      this.sock = sock;
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line && line[0] !== '~') this._msg?.(line);
        }
      });
      sock.on('error', reject);
      sock.on('close', () => this._close?.('closed'));
    });
  }
  send(text) {
    this.sock?.write(`${text}\n`);
  }
  close() {
    this.sock?.end();
  }
}

/** TCP server → room-host transport. */
class TcpHostTransport {
  constructor(port) {
    this.port = port;
    this.peers = new Map();
    this.n = 0;
  }
  onPeer(cb) {
    this._peer = cb;
  }
  onMessage(cb) {
    this._msg = cb;
  }
  start() {
    return new Promise((resolve) => {
      this.server = net.createServer((sock) => {
        const id = `tcp:${++this.n}`;
        this.peers.set(id, sock);
        this._peer?.(id, true);
        let buf = '';
        sock.setEncoding('utf8');
        sock.on('data', (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (line && line[0] !== '~') this._msg?.(id, line);
          }
        });
        const gone = () => {
          if (this.peers.delete(id)) this._peer?.(id, false);
        };
        sock.on('close', gone);
        sock.on('error', gone);
      });
      this.server.listen(this.port, '0.0.0.0', () => resolve({ via: 'lan', port: this.port }));
    });
  }
  send(id, text) {
    this.peers.get(id)?.write(`${text}\n`);
  }
  kick(id) {
    this.peers.get(id)?.end();
  }
  stop() {
    this.server?.close();
    for (const s of this.peers.values()) s.destroy();
  }
}

function autoplay(client, def, label) {
  client.on('state', (v, events) => {
    const ev = events.map((e) => e.e).join(',');
    console.log(`[${label}] hand ${v.handNo} ${v.phase} turn=${v.turn} ${ev}`);
    if (v.phase === 'over') {
      setTimeout(() => client.setReady(true), 1500);
      return;
    }
    const mine = v.options ? Boolean(v.options) : v.turn === v.seat;
    if (!mine) return;
    setTimeout(() => {
      const fresh = client.view;
      if (fresh !== v) return;
      client.act(def.botAction(v, {}, { level: 'normal' }));
    }, 600);
  });
  client.on('seats', (s) => console.log(`[${label}] seats`, s.map((x) => `${x.name || '-'}(${x.kind}${x.connected ? '' : ',off'})`).join(' ')));
  client.on('error', (e) => console.log(`[${label}] error`, e));
  client.on('end', (r) => {
    console.log(`[${label}] end`, r);
    process.exit(0);
  });
}

if (mode === 'join') {
  const [host, port, game, name = '电脑那头'] = rest;
  const def = await loadDef(game);
  const client = new RoomClient({ def, me: { name, avatar: '💻', token: `pc-${name}` }, transport: new TcpClientTransport(host, Number(port)) });
  autoplay(client, def, 'join');
  await client.connect();
  console.log(`[join] seat ${client.seat} in room ${client.code} hosted by ${client.hostName}`);
} else if (mode === 'host') {
  const [port, game] = rest;
  const def = await loadDef(game);
  const me = { name: '电脑房主', avatar: '💻', token: 'pc-host' };
  const host = new RoomHost({ def, settings: def.engine.defaultSettings(), me, code: '7777', onChange: () => {} });
  const local = new RoomClient({ def, me, transport: host.createLocalClient() });
  await local.connect();
  autoplay(local, def, 'host');
  await host.addTransport(new TcpHostTransport(Number(port)));
  console.log(`[host] room 7777 listening on ${port}; start with: type "start" + Enter`);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    if (d.trim() === 'start') host.start();
  });
  if (rest.includes('--start-when-joined')) {
    const timer = setInterval(() => {
      if (host.humanCount() >= 2) {
        clearInterval(timer);
        setTimeout(() => host.start(), 1500);
      }
    }, 300);
  }
} else {
  console.log('usage: node tools/lan-peer.mjs join <host> <port> <game> | host <port> <game> [--start-when-joined]');
}
