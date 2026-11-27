// Room layer tests with a toy engine: solo flow, a remote guest over BroadcastChannel,
// bots, hand-over → next hand, reconnect, and automatic play for a dropped guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomHost, RoomClient } from '../../core/net/room.js';
import { createHostTransport, createClientTransport, createDiscovery } from '../../core/net/transports.js';

const toy = {
  createMatch: (settings, seed) => ({ seed, handNo: 0, seq: 0, scores: [0, 0, 0], turn: 0, count: 0, over: false, log: [] }),
  startHand: (m) => Object.assign(m, { handNo: m.handNo + 1, count: 0, over: false, turn: m.handNo % 3, log: [] }),
  getView: (m, seat) => ({ seat, seq: m.seq, turn: m.over ? -1 : m.turn, count: m.count, handNo: m.handNo, phase: m.over ? 'over' : 'playing', secret: m.log.filter((x) => x.seat === seat) }),
  getPendingSeats: (m) => (m.over ? [] : [m.turn]),
  applyAction(m, seat, a) {
    if (m.over || seat !== m.turn) return { ok: false, error: '还没轮到你' };
    if (a.type !== 'inc') return { ok: false, error: '不认识的动作' };
    m.count += 1;
    m.seq += 1;
    m.log.push({ seat });
    m.turn = (m.turn + 1) % 3;
    const events = [{ e: 'inc', seat }];
    if (m.count >= 9) {
      m.over = true;
      m.scores[seat] += 1;
      events.push({ e: 'handOver' });
    }
    return { ok: true, events };
  },
  isHandOver: (m) => m.over,
};

const def = {
  id: 'toy',
  code: 'DDZ',
  seats: 3,
  engine: toy,
  botAction: () => ({ type: 'inc' }),
  fallbackAction: () => ({ type: 'inc' }),
  botDelay: () => 5,
  botProfiles: [{ name: '甲', avatar: '🤖' }, { name: '乙', avatar: '🤖' }],
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await wait(5);
  }
}

test('solo: human + bots play hands, ready starts the next hand', async () => {
  const host = new RoomHost({ def, settings: {}, me: { name: '我', avatar: '🐱', token: 't0' }, code: 'solo' });
  const client = new RoomClient({ def, me: { name: '我', avatar: '🐱', token: 't0' }, transport: host.createLocalClient() });
  await client.connect();
  host.start();
  client.on('state', (v) => {
    if (v.turn === client.seat) client.act({ type: 'inc' });
  });
  await until(() => client.view && client.view.phase === 'over');
  assert.equal(client.view.count, 9);
  assert.deepEqual(client.seats.map((s) => s.kind), ['human', 'bot', 'bot']);
  client.setReady(true);
  await until(() => client.view.handNo === 2 && client.view.phase === 'playing');
  host.close();
  client.leave(true);
});

test('remote guest over BroadcastChannel joins, plays, reconnects and is auto-played when gone', async () => {
  const me = { name: '房主', avatar: '🐱', token: 'host' };
  const host = new RoomHost({ def, settings: {}, me, code: '1234' });
  const hostClient = new RoomClient({ def, me, transport: host.createLocalClient() });
  await hostClient.connect();
  await host.addTransport(createHostTransport('bc', 'DDZ-1234', '{}'));

  const found = [];
  const disc = createDiscovery('bc');
  disc.start((r) => found.push(r));
  await until(() => found.length > 0);
  disc.stop();
  assert.equal(found[0].name, 'DDZ-1234');

  const guestMe = { name: '女朋友', avatar: '🐰', token: 'gf' };
  const guest = new RoomClient({ def, me: guestMe, target: found[0] });
  await guest.connect();
  assert.equal(guest.seat, 1);
  await until(() => host.humanCount() === 2);

  host.start();
  for (const c of [hostClient, guest]) {
    c.on('state', (v) => {
      if (v.turn === c.seat && v.phase === 'playing') setTimeout(() => c.act({ type: 'inc' }), 1);
    });
  }
  await until(() => guest.view?.phase === 'over' && hostClient.view?.phase === 'over');
  // Guest only ever sees its own private log entries.
  assert.ok(guest.view.secret.every((x) => x.seat === 1));

  // Wrong-turn action is rejected with an error, not applied.
  const errors = [];
  guest.on('error', (e) => errors.push(e));
  hostClient.setReady(true);
  guest.setReady(true);
  await until(() => guest.view.handNo === 2);
  if (guest.view.turn !== 1) {
    guest.act({ type: 'inc' });
    await until(() => errors.length > 0);
  }

  // Reconnect with the same token keeps the seat.
  const target = guest.target;
  guest.leave(true);
  const again = new RoomClient({ def, me: guestMe, target });
  await again.connect();
  assert.equal(again.seat, 1);
  again.leave(); // sends bye → seat drops, then becomes automated after the grace period
  await until(() => host.seats[1].connected === false);
  host.seats[1].droppedAt = Date.now() - 60000; // skip the 12 s grace in the test
  host._scheduleBots();
  hostClient.on('state', (v) => {
    if (v.turn === hostClient.seat && v.phase === 'playing') setTimeout(() => hostClient.act({ type: 'inc' }), 1);
  });
  await until(() => hostClient.view.phase === 'over', 5000);
  host.close();
  hostClient.leave(true);
});
