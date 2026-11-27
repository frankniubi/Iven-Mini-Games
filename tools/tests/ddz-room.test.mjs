// 斗地主 through the room layer: host with its own seat on 托管 plus two bots and a remote guest
// on 托管 over BroadcastChannel, several hands, checking views stay private and scores add up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomHost, RoomClient } from '../../core/net/room.js';
import { createHostTransport, createDiscovery } from '../../core/net/transports.js';
import { DDZ_DEF } from '../../games/doudizhu/index.js';

const fast = { ...DDZ_DEF, botDelay: () => 1 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await wait(5);
  }
}

test('three hands with a remote guest, all automated', async () => {
  const me = { name: '房主', avatar: '🐱', token: 'h' };
  const host = new RoomHost({ def: fast, settings: { bidMode: 'rob', baseScore: 1, botLevel: 'normal' }, me, code: '4821' });
  const hc = new RoomClient({ def: fast, me, transport: host.createLocalClient() });
  await hc.connect();
  await host.addTransport(createHostTransport('bc', 'DDZ-4821', '{}'));
  const found = [];
  const d = createDiscovery('bc');
  d.start((r) => found.push(r));
  await until(() => found.length);
  d.stop();
  const guest = new RoomClient({ def: fast, me: { name: '客人', avatar: '🐰', token: 'g' }, target: found[0] });
  await guest.connect();
  host.start();
  hc.setAuto(true);
  guest.setAuto(true);

  const leaks = [];
  guest.on('state', (v) => {
    if (v.phase !== 'over') {
      const json = JSON.stringify(v);
      // The guest's view must not contain the host's hand cards.
      const other = host.match ? fast.engine.getView(host.match, 0).hand : [];
      if (other.length && other.every((id) => v.hand.includes(id))) leaks.push(json);
    }
  });

  let finished = 0;
  let lastOver = -1;
  guest.on('state', (v) => {
    if (v.phase === 'over' && v.handNo !== lastOver) {
      lastOver = v.handNo;
      finished += 1;
    }
  });
  for (let hand = 1; hand <= 3; hand++) {
    await until(() => finished >= hand && guest.view?.phase === 'over');
    const sum = guest.view.scores.reduce((a, b) => a + b, 0);
    assert.equal(sum, 0, 'scores are zero-sum');
    hc.setReady(true);
    guest.setReady(true);
  }
  assert.equal(leaks.length, 0);
  host.close();
  hc.leave(true);
  guest.leave(true);
});
