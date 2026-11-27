// node --test tools/tests/taicang-mj.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as E from '../../games/taicang-mj/engine.js';
import { RULESETS, chengbaoSeat } from '../../games/taicang-mj/rules.js';
import { botAction } from '../../games/taicang-mj/ai.js';

const P = E.parseTiles;
const T = (s) => P(s)[0];

// ---------------------------------------------------------------------------
// Helpers

/** Total copies of every kind across wall, hands, melds, rivers, flowers and the 翻牌. */
function tally(match) {
  const h = match.hand;
  const c = new Array(E.KIND_COUNT).fill(0);
  for (let i = h.head; i < h.tail; i++) c[h.wall[i]]++;
  for (let s = 0; s < 4; s++) {
    for (const t of h.hands[s]) c[t]++;
    for (const m of h.melds[s]) for (const t of m.tiles) c[t]++;
    for (const t of h.discards[s]) c[t]++;
    for (const t of h.flowers[s]) c[t]++;
  }
  if (h.indicator !== null) c[h.indicator]++;
  return c;
}

function assertConserved(match, msg = '') {
  assert.deepEqual(tally(match), E.tileCountsFor(match.settings), `tile conservation ${msg}`);
}

/**
 * Build a mid-hand position. spec: { dealer, turn, hands:[str|null x4], drawn, melds:[[{type, tiles:str, from}]],
 * flowers:[str], front: str (next draws), back: str (next replacements, first = first taken), indicator }
 */
function craft(settings, spec) {
  const m = E.createMatch({ firstDealer: 0, ...settings }, 'craft');
  m.dealer = spec.dealer ?? 0;
  const reserved = m.settings.reservedTiles;
  m.settings.reservedTiles = 0;
  E.startHand(m, spec.indicator != null ? { indicator: spec.indicator } : {});
  m.settings.reservedTiles = reserved;
  const h = m.hand;
  h.deadWall = reserved | 0;
  const pool = E.tileCountsFor(m.settings).slice();
  if (h.indicator !== null) pool[h.indicator]--;
  const take = (k) => {
    if (!pool[k]) throw new Error(`craft: no copy left of ${E.tileName(k)}`);
    pool[k]--;
    return k;
  };
  const melds = (spec.melds || [[], [], [], []]).map((list) =>
    list.map((mm) => ({ type: mm.type, tiles: P(mm.tiles).map(take), from: mm.from ?? null, ...(mm.type === 'ankan' ? {} : { claimed: P(mm.tiles)[0] }) })),
  );
  const flowers = (spec.flowers || ['', '', '', '']).map((s) => P(s).map(take));
  const explicit = spec.hands.map((s) => (s === null ? null : P(s).map(take)));
  const front = P(spec.front || '').map(take);
  const back = P(spec.back || '').map(take);
  const playable = new Set(E.playKindsFor(m.settings, h.wilds));
  const hands = explicit.map((x, s) => {
    if (x) return x;
    const need = 13 - 3 * melds[s].length + (s === (spec.turn ?? m.dealer) ? 1 : 0);
    // Junk: scattered singles (never wilds or flowers); duplicates only if singles run out.
    const order = Array.from({ length: 34 }, (_, k) => k).sort((a, b) => ((a * 5 + s * 11) % 34) - ((b * 5 + s * 11) % 34));
    const ok = (k) => playable.has(k) && !h.wilds.includes(k) && pool[k] > 0;
    const out = [];
    for (const k of order) if (out.length < need && ok(k)) out.push(take(k));
    for (const k of order) while (out.length < need && ok(k)) out.push(take(k));
    if (out.length < need) throw new Error('craft: not enough tiles for junk');
    return out;
  });
  hands.forEach((x, s) => {
    const want = 13 - 3 * melds[s].length + (s === (spec.turn ?? m.dealer) ? 1 : 0);
    if (x.length !== want) throw new Error(`craft: seat ${s} has ${x.length} tiles, expected ${want}`);
  });
  const rest = [];
  for (let k = 0; k < E.KIND_COUNT; k++) while (pool[k] > 0) rest.push(k), pool[k]--;
  h.wall = [...front, ...rest, ...back.slice().reverse()];
  h.head = 0;
  h.tail = h.wall.length;
  h.hands = hands;
  h.melds = melds;
  h.flowers = flowers;
  h.discards = [[], [], [], []];
  h.turn = spec.turn ?? m.dealer;
  h.stage = 'discard';
  h.claim = null;
  h.lastDiscard = null;
  h.drawn = [null, null, null, null];
  h.drawSource = null;
  if (spec.drawn) {
    h.drawn[h.turn] = T(spec.drawn);
    h.drawSource = 'wall';
  }
  h.kanDraw = false;
  h.flowerDraw = false;
  h.turnsTaken = [3, 3, 3, 3];
  h.discardCount = 12;
  h.claimCount = melds.flat().filter((x) => x.from !== null).length;
  m.phase = 'playing';
  m.result = null;
  m.scores = [0, 0, 0, 0];
  m.history = [];
  assertConserved(m, 'after craft');
  return m;
}

function act(m, seat, action) {
  const r = E.applyAction(m, seat, action);
  assert.ok(r.ok, `action ${JSON.stringify(action)} by ${seat} rejected: ${r.error}`);
  assertConserved(m);
  return r;
}

function sum(a) {
  return a.reduce((x, y) => x + y, 0);
}

// ---------------------------------------------------------------------------
// Tiles

test('tile names, suits, sorting and notation', () => {
  assert.equal(E.tileName(2), '三万');
  assert.equal(E.tileName(15), '七条');
  assert.equal(E.tileName(26), '九筒');
  assert.equal(E.tileName(27), '东风');
  assert.equal(E.tileName(31), '红中');
  assert.equal(E.tileName(32), '发财');
  assert.equal(E.tileName(33), '白板');
  assert.equal(E.tileName(34), '春');
  assert.equal(E.tileName(41), '菊');
  assert.equal(E.tileName(42), '百搭');
  assert.equal(E.tileName(43), '大白板');
  assert.equal(E.tileSuit(0), 'wan');
  assert.equal(E.tileSuit(9), 'tiao');
  assert.equal(E.tileSuit(18), 'tong');
  assert.equal(E.tileSuit(28), 'wind');
  assert.equal(E.tileSuit(31), 'dragon');
  assert.equal(E.tileSuit(36), 'flower');
  assert.equal(E.tileSuit(42), 'special');
  assert.deepEqual(E.sortTiles([33, 2, -1, 0, 18]), [0, 2, 18, 33, -1]);
  assert.deepEqual(P('19m1s9p7z1f1x2x'), [0, 8, 9, 26, 33, 34, 42, 43]);
});

test('财神 from the flipped indicator', () => {
  assert.deepEqual(E.wildsForIndicator(T('4m')), [T('5m')]);
  assert.deepEqual(E.wildsForIndicator(T('9s')), [T('1s')]);
  assert.deepEqual(E.wildsForIndicator(T('9p')), [T('1p')]);
  assert.deepEqual(E.wildsForIndicator(T('4z')), [T('1z')]); // 北 → 东
  assert.deepEqual(E.wildsForIndicator(T('7z')), [T('5z')]); // 白 → 中
  assert.deepEqual(E.wildsForIndicator(T('2f')), P('5678f')); // 夏 → 梅兰竹菊
  assert.deepEqual(E.wildsForIndicator(T('8f')), P('1234f'));
  assert.deepEqual(E.wildsForIndicator(E.BAIDA), [E.BLANK]);
  assert.deepEqual(E.wildsForIndicator(E.BLANK), [E.BAIDA]);
});

test('TAICANG tile set: 152 tiles, 28 花, default ruleset', () => {
  const s = E.defaultSettings();
  assert.equal(s.ruleset, 'TAICANG');
  assert.equal(s.baseScore, 1);
  assert.equal(s.botLevel, 'normal');
  assert.equal(s.handsPerSession, 8);
  assert.equal(s.capHua, 100);
  const c = E.tileCountsFor(s);
  assert.equal(sum(c), 152);
  assert.equal(E.flowerKindsFor(s).reduce((n, k) => n + c[k], 0), 28);
  assert.equal(sum(E.tileCountsFor({ ruleset: 'GENERIC' })), 144);
  const m = E.createMatch({}, 7);
  E.startHand(m);
  assert.equal(m.hand.wall.length, 151, '翻牌 is removed from play');
  assert.ok(m.hand.indicator !== null && m.hand.wilds.length >= 1);
  assert.deepEqual(m.lastEvents.find((e) => e.e === 'indicator').wilds, m.hand.wilds);
  assertConserved(m);
});

// ---------------------------------------------------------------------------
// Win detection & shanten

test('win detection: standard, melds, seven pairs, not-a-win', () => {
  const g = { sevenPairs: true };
  assert.ok(E.isWinningHand(P('123m456m789m123p11s')));
  assert.ok(E.isWinningHand(P('111m222m333m444m55m')));
  assert.ok(E.isWinningHand(P('11122233344455m')));
  assert.ok(!E.isWinningHand(P('123m456m789m123p12s')));
  assert.ok(!E.isWinningHand(P('123z456z777z123m11m')), 'honours do not form sequences');
  assert.ok(!E.isWinningHand(P('891m234p567s111z22z')), 'no wrap-around');
  assert.ok(E.isWinningHand(P('456m789p11s'), 2), 'two exposed melds');
  assert.ok(!E.isWinningHand(P('456m789p11s'), 1), 'wrong tile count');
  assert.ok(E.isWinningHand(P('11s'), 4), '大吊车 shape');
  assert.ok(E.isWinningHand(P('1122m3344p5566s77z'), [], g));
  assert.ok(!E.isWinningHand(P('1122m3344p5566s77z'), [], { sevenPairs: false }));
  assert.ok(E.isWinningHand(P('1111m2233p4455s66z'), [], g));
  assert.ok(!E.isWinningHand(P('1111m2233p4455s66z'), [], { sevenPairsFour: false }));
  assert.ok(!E.isWinningHand(P('1122m3344p55s66s7z'), [], g), 'pairs with melds are not seven pairs');
  assert.ok(E.isWinningHand(P('19m19s19p1234567z1m'), [], { thirteenOrphans: true }));
  assert.ok(!E.isWinningHand(P('19m19s19p1234567z1m'), [], { thirteenOrphans: false }));
});

test('win detection with 财神 (wild tiles)', () => {
  const W = [E.BAIDA];
  const J = E.BAIDA;
  assert.ok(E.isWinningHand(P('123m456m789m12p11s').concat([J]), [], {}, W), 'joker fills a chow');
  assert.ok(E.isWinningHand(P('123m456m789m123p').concat([J, J]), [], {}, W), 'two jokers as the pair');
  assert.ok(E.isWinningHand(P('123m456m789m1p').concat([J, J, J, J]).slice(0, 14), [], {}, W));
  assert.ok(E.isWinningHand(P('1122m3344p5566s7z').concat([J]), [], {}, W), 'seven pairs with a joker');
  assert.ok(!E.isWinningHand(P('159m159p159s1z').concat([J, J, J, J]), [], {}, W), 'isolated tiles cannot win even with 4 jokers');
  // A natural tile used as itself: 5m is wild but 3-4-5m still works as a chow.
  const five = T('5m');
  assert.ok(E.isWinningHand(P('34m5m678m123p456p99s'), [], {}, [five]));
  // Decompositions record joker usage.
  const { counts, jokers } = E.splitHand(P('123m456m789m12p11s').concat([J]), W);
  const ds = E.decomposeHand(counts, jokers);
  assert.ok(ds.some((d) => d.sets.some((s) => s.type === 'chow' && s.tile === T('1p') && s.wilds === 1)));
});

test('shanten on known hands', () => {
  assert.equal(E.shanten(P('123m456m789m123p11s')), -1);
  assert.equal(E.shanten(P('123m456m789m123p1s')), 0);
  assert.equal(E.shanten(P('123m456m789m11p23s')), 0);
  assert.equal(E.shanten(P('13579m13579p135s')), 4);
  assert.equal(E.shanten(P('1122m3344p5566s7z')), 0, 'seven pairs tenpai');
  assert.equal(E.shanten(P('1122m3344p5566s7z'), 0, { sevenPairs: false }), 3);
  assert.equal(E.shanten(P('19m19s19p1234567z'), 0, { thirteenOrphans: true }), 0);
  assert.equal(E.shanten(P('456m789p1s'), 2), 0, 'with exposed melds');
  const W = { wilds: [E.BAIDA] };
  assert.equal(E.shanten(P('123m456m789m123p').concat([E.BAIDA]), 0, W), 0, 'joker waits on anything for the pair');
  assert.equal(E.shanten(P('123m456m789m1p').concat([E.BAIDA]), 1, W), -1, 'joker completes the pair');
  assert.equal(E.shanten(P('123m456m789m12p').concat([E.BAIDA, E.BAIDA]), 0, W), 0, '13 tiles: tenpai at best');
  assert.equal(E.shanten(P('123m456m789m12p5s').concat([E.BAIDA, E.BAIDA]), 0, W), -1);
  assert.equal(E.shanten(P('13579m13579p13s').concat([E.BAIDA]), 0, W), 3);
});

test('shanten agrees with win detection and changes by at most one per exchange (random hands)', () => {
  const rng = E.createRng('shanten');
  const kinds = Array.from({ length: 34 }, (_, k) => k);
  const deal = (n) => {
    const pool = [];
    for (const k of kinds) for (let i = 0; i < 4; i++) pool.push(k);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  };
  const opts = { sevenPairs: true };
  for (let round = 0; round < 120; round++) {
    const jokers = round % 3 === 0 ? 1 : 0;
    const hand = deal(14 - jokers);
    const c = E.toCounts(hand);
    const s = E.shantenCounts(c, 0, { ...opts, jokers });
    assert.equal(s === -1, E.isWinningCounts(c, 0, opts, jokers), `win/-1 mismatch for ${E.formatTiles(hand)}`);
    if (s < 0) continue;
    let best = 99;
    for (let d = 0; d < 34; d++) {
      if (!c[d]) continue;
      c[d]--;
      for (let k = 0; k < 34; k++) {
        if (c[k] >= 4) continue;
        c[k]++;
        const s2 = E.shantenCounts(c, 0, { ...opts, jokers });
        assert.ok(s2 >= s - 1, 'one exchange improves shanten by at most one');
        best = Math.min(best, s2);
        c[k]--;
      }
      c[d]++;
    }
    assert.equal(best, s - 1, `some exchange must improve ${E.formatTiles(hand)} (shanten ${s})`);
    // 13-tile hands: tenpai iff there is a winning tile.
    const h13 = hand.slice(0, 13 - jokers);
    const c13 = E.toCounts(h13);
    const s13 = E.shantenCounts(c13, 0, { ...opts, jokers });
    assert.equal(s13 === 0, E.waitsForCounts(c13, 0, opts, jokers).length > 0);
  }
});

// ---------------------------------------------------------------------------
// Claims

const GEN = { ruleset: 'GENERIC' };
// Seat 0 discards 5m: seat 1 can 吃 (two ways), seat 2 can 碰, seat 3 can 胡.
const CLAIM_SPEC = {
  dealer: 0,
  turn: 0,
  drawn: '5m',
  hands: ['5m 19s 19p 1234567z 28s', '46m 147p 258s 36s 99p 7m', '55m 1358p 1479s 2z 8m 3m', '123p 456p 789s 11s 46m'],
};

test('claim window: options per seat, priority 胡 > 碰 > 吃', () => {
  const m = craft(GEN, CLAIM_SPEC);
  const r = act(m, 0, { type: 'discard', tile: T('5m') });
  assert.deepEqual(r.events, [{ e: 'discard', seat: 0, tile: T('5m') }]);
  assert.deepEqual(E.getPendingSeats(m), [1, 2, 3]);
  const o1 = E.getLegalActions(m, 1);
  assert.deepEqual(o1.chi, [P('456m'), P('567m')]);
  assert.equal(o1.pon, false);
  assert.equal(o1.hu, false);
  assert.equal(o1.pass, true);
  assert.equal(E.getLegalActions(m, 2).pon, true);
  assert.equal(E.getLegalActions(m, 3).hu, true);
  assert.equal(E.getView(m, 1).stage, 'claim');
  act(m, 1, { type: 'chi', tiles: P('456m') });
  assert.deepEqual(E.getPendingSeats(m), [2, 3]);
  act(m, 2, { type: 'pon' });
  assert.deepEqual(E.getPendingSeats(m), [3]);
  const fin = act(m, 3, { type: 'hu' });
  assert.ok(E.isHandOver(m));
  assert.deepEqual(m.result.winners, [3]);
  assert.equal(m.result.loser, 0);
  assert.equal(m.result.selfDraw, false);
  assert.equal(sum(m.result.deltas), 0);
  assert.ok(fin.events.some((e) => e.e === 'hu' && e.seat === 3 && e.from === 0 && e.selfDraw === false));
  assert.ok(fin.events.some((e) => e.e === 'handOver'));
});

test('claim window: 碰 beats an earlier 吃; the hu seat passing does not block', () => {
  const m = craft(GEN, CLAIM_SPEC);
  act(m, 0, { type: 'discard', tile: T('5m') });
  act(m, 1, { type: 'chi', tiles: P('567m') });
  act(m, 3, { type: 'pass' });
  assert.deepEqual(E.getPendingSeats(m), [2], 'still waiting for the higher-priority 碰');
  const r = act(m, 2, { type: 'pon' });
  assert.deepEqual(r.events, [{ e: 'claim', seat: 2, type: 'pon', tiles: P('555m'), from: 0 }]);
  assert.equal(m.hand.turn, 2);
  assert.equal(m.hand.stage, 'discard');
  assert.deepEqual(m.hand.discards[0], [], 'claimed tile leaves the river');
  assert.deepEqual(m.hand.melds[2], [{ type: 'pon', tiles: P('555m'), from: 0, claimed: T('5m') }]);
  assert.equal(E.getLegalActions(m, 2).discard, true);
  assert.equal(E.getLegalActions(m, 1), null);
});

test('claim window resolves early once lower claims cannot matter', () => {
  const m = craft(GEN, CLAIM_SPEC);
  act(m, 0, { type: 'discard', tile: T('5m') });
  act(m, 2, { type: 'pon' });
  act(m, 3, { type: 'pass' });
  assert.deepEqual(E.getPendingSeats(m), [2], '吃 can no longer win, so the pon resolves');
  const bad = E.applyAction(m, 1, { type: 'chi', tiles: P('456m') });
  assert.equal(bad.ok, false);
  assert.ok(bad.error.length > 0);
});

const MULTI_SPEC = {
  dealer: 0,
  turn: 0,
  drawn: '5m',
  hands: ['5m 19s 19p 1234567z 28s', '234s 567s 789p 22z 46m', '55m 1358p 1479s 2z 8m 3m', '123p 456p 789s 11s 46m'],
};

test('一炮多响: every seat that calls 胡 wins and the discarder pays each', () => {
  const m = craft(GEN, MULTI_SPEC);
  act(m, 0, { type: 'discard', tile: T('5m') });
  act(m, 1, { type: 'hu' });
  assert.deepEqual(E.getPendingSeats(m), [2, 3]);
  act(m, 2, { type: 'pass' });
  act(m, 3, { type: 'hu' });
  assert.deepEqual(m.result.winners, [1, 3]);
  assert.equal(m.result.items.length, 2);
  assert.equal(m.result.deltas[0], -(m.result.total[0] + m.result.total[1]));
  assert.equal(sum(m.result.deltas), 0);
});

test('first-winner-only: the seat closest after the discarder takes the win', () => {
  const m = craft({ ...GEN, multiWin: false }, MULTI_SPEC);
  act(m, 0, { type: 'discard', tile: T('5m') });
  act(m, 3, { type: 'hu' });
  assert.ok(E.getPendingSeats(m).includes(1), 'seat 1 is closer and may still win');
  assert.ok(!E.isHandOver(m));
  act(m, 1, { type: 'pass' });
  assert.deepEqual(m.result.winners, [3]);
  const m2 = craft({ ...GEN, multiWin: false }, MULTI_SPEC);
  act(m2, 0, { type: 'discard', tile: T('5m') });
  act(m2, 1, { type: 'hu' });
  assert.ok(E.isHandOver(m2), 'closest winner resolves immediately');
  assert.deepEqual(m2.result.winners, [1]);
});

test('过胡: after passing a discard win you cannot win on discards until your next draw', () => {
  const spec = {
    dealer: 0,
    turn: 0,
    drawn: '5m',
    front: '8m',
    hands: ['5m 19s 19p 1234567z 28s', null, '67m 123p 456p 789s 11z', null],
  };
  const m = craft({ ...GEN, passHuLock: true }, spec);
  act(m, 0, { type: 'discard', tile: T('5m') });
  assert.equal(E.getLegalActions(m, 2).hu, true);
  act(m, 2, { type: 'pass' });
  for (const s of E.getPendingSeats(m)) act(m, s, { type: 'pass' });
  // Seat 1 draws 8m and throws it: seat 2 waits on it but is locked.
  assert.equal(m.hand.turn, 1);
  act(m, 1, { type: 'discard', tile: T('8m') });
  const o = E.getLegalActions(m, 2);
  assert.ok(o === null || o.hu === false, '过胡 blocks the discard win');
});

// ---------------------------------------------------------------------------
// Kongs

test('暗杠 draws a replacement from the back and enables 杠开', () => {
  const m = craft(GEN, { dealer: 0, turn: 0, drawn: '1m', back: '5z', hands: ['1111m 234m 456p 789s 5z', null, null, null] });
  const o = E.getLegalActions(m, 0);
  assert.deepEqual(o.kan, [T('1m')]);
  assert.deepEqual(o.kanTypes, [{ tile: T('1m'), type: 'ankan' }]);
  const tailBefore = m.hand.tail;
  const r = act(m, 0, { type: 'kan', tile: T('1m') });
  assert.deepEqual(r.events, [{ e: 'kan', seat: 0, kind: 'ankan', tile: null }, { e: 'draw', seat: 0, replacement: true }]);
  assert.equal(m.hand.tail, tailBefore - 1);
  assert.equal(m.hand.drawn[0], T('5z'));
  assert.deepEqual(E.getView(m, 1).melds[0][0].tiles, [-1, -1, -1, -1], 'others see a hidden 暗杠');
  assert.deepEqual(E.getView(m, 0).melds[0][0].tiles, P('1111m'));
  assert.equal(E.getLegalActions(m, 0).hu, true);
  act(m, 0, { type: 'hu' });
  const names = m.result.items[0].map((i) => i.name);
  assert.ok(names.includes('杠开') && names.includes('暗杠'), names.join(','));
  assert.deepEqual(m.result.deltas.map((d) => Math.sign(d)), [1, -1, -1, -1]);
});

test('明杠 on a discard: claim + kan events and a replacement draw', () => {
  const m = craft(GEN, { dealer: 0, turn: 0, drawn: '7p', back: '9s', hands: ['7p 19m 1234567z 258s 1p', '777p 123m 456m 99s 1z 9m', null, null] });
  act(m, 0, { type: 'discard', tile: T('7p') });
  const o = E.getLegalActions(m, 1);
  assert.equal(o.pon, true);
  assert.deepEqual(o.kan, [T('7p')]);
  const r = act(m, 1, { type: 'kan', tile: T('7p') });
  assert.deepEqual(r.events, [
    { e: 'claim', seat: 1, type: 'kan', tiles: P('7777p'), from: 0 },
    { e: 'kan', seat: 1, kind: 'mingkan', tile: T('7p') },
    { e: 'draw', seat: 1, replacement: true },
  ]);
  assert.equal(m.hand.melds[1][0].type, 'mingkan');
  assert.equal(m.hand.drawn[1], T('9s'));
  assert.equal(m.hand.turn, 1);
});

const ROB_SPEC = {
  dealer: 0,
  turn: 0,
  drawn: '7p',
  back: '3z',
  melds: [[{ type: 'pon', tiles: '777p', from: 2 }], [], [], []],
  hands: ['7p 123m 456m 789m 1z', '56p 123s 456s 789s 22z', null, null],
};

test('补杠 can be robbed (抢杠胡)', () => {
  const m = craft(GEN, ROB_SPEC);
  const o = E.getLegalActions(m, 0);
  assert.deepEqual(o.kanTypes, [{ tile: T('7p'), type: 'bukan' }]);
  const r = act(m, 0, { type: 'kan', tile: T('7p') });
  assert.deepEqual(r.events, [{ e: 'kan', seat: 0, kind: 'bukan', tile: T('7p') }]);
  assert.equal(m.hand.stage, 'claim');
  assert.deepEqual(E.getPendingSeats(m), [1]);
  const o1 = E.getLegalActions(m, 1);
  assert.equal(o1.hu, true);
  assert.equal(o1.pon, false);
  const fin = act(m, 1, { type: 'hu' });
  assert.ok(fin.events.some((e) => e.e === 'hu' && e.robbed === true));
  assert.equal(m.result.robKong, true);
  assert.equal(m.result.loser, 0);
  assert.equal(m.result.winTile, T('7p'));
  assert.equal(m.hand.melds[0][0].type, 'pon', 'the robbed kong stays a pon');
  assert.ok(m.result.hands[1].includes(T('7p')));
  assert.ok(!m.result.hands[0].includes(T('7p')));
  assert.ok(m.result.items[0].some((i) => i.name === '抢杠'));
});

test('补杠 completes when nobody robs', () => {
  const m = craft(GEN, ROB_SPEC);
  act(m, 0, { type: 'kan', tile: T('7p') });
  const r = act(m, 1, { type: 'pass' });
  assert.deepEqual(r.events, [{ e: 'draw', seat: 0, replacement: true }]);
  assert.equal(m.hand.melds[0][0].type, 'bukan');
  assert.deepEqual(m.hand.melds[0][0].tiles, P('7777p'));
  assert.equal(m.hand.drawn[0], T('3z'));
  assert.equal(m.hand.stage, 'discard');
});

// ---------------------------------------------------------------------------
// Flowers, dead wall, draw game

test('initial 补花 in seat order from the back of the wall, chained flowers included', () => {
  const m = E.createMatch({ ...GEN, firstDealer: 0 }, 1);
  const pool = E.tileCountsFor(m.settings).slice();
  const take = (k) => (pool[k]--, k);
  const dealer = [...P('1f2f'), ...P('123m456m789m12p').map(take)];
  take(T('1f'));
  take(T('2f'));
  const s1 = P('123s456s789s12z3z4z').map(take);
  const s2 = [take(T('4f')), ...P('345p678p11z55z6z7z').map(take)];
  const s3 = P('147m258p369s7z6z5z3z').map(take);
  const d14 = take(T('9p'));
  const tailTiles = [take(T('3f')), take(T('3p')), take(T('6p')), take(T('9m'))]; // last element of wall first
  const rest = [];
  for (let k = 0; k < E.KIND_COUNT; k++) while (pool[k] > 0) rest.push(k), pool[k]--;
  const wall = [...dealer, ...s1, ...s2, ...s3, d14, ...rest, ...tailTiles.slice().reverse()];
  E.startHand(m, { wall });
  const h = m.hand;
  assert.deepEqual(h.flowers[0], P('1f2f3f'));
  assert.deepEqual(h.flowers[2], P('4f'));
  assert.deepEqual(h.flowers[1], []);
  assert.equal(h.hands[0].length, 14);
  for (const s of [1, 2, 3]) assert.equal(h.hands[s].length, 13);
  assert.ok(h.hands.every((x) => x.every((t) => t < 34)), 'no flowers left in hands');
  assert.ok(h.hands[0].includes(T('3p')) && h.hands[0].includes(T('6p')));
  assert.ok(h.hands[2].includes(T('9m')));
  const ev = m.lastEvents.filter((e) => e.e === 'flower' || e.e === 'draw');
  assert.deepEqual(ev, [
    { e: 'flower', seat: 0, tile: T('1f') },
    { e: 'draw', seat: 0, replacement: true },
    { e: 'flower', seat: 0, tile: T('2f') },
    { e: 'draw', seat: 0, replacement: true },
    { e: 'flower', seat: 0, tile: T('3f') },
    { e: 'draw', seat: 0, replacement: true },
    { e: 'flower', seat: 2, tile: T('4f') },
    { e: 'draw', seat: 2, replacement: true },
  ]);
  assertConserved(m);
});

test('a flower drawn mid-hand is exposed and replaced immediately', () => {
  const m = craft(GEN, { dealer: 0, turn: 0, drawn: '1z', front: '6f', back: '9p', hands: ['1z 147m 258p 369s 234z 5z', null, null, null] });
  const r = act(m, 0, { type: 'discard', tile: T('1z') });
  assert.deepEqual(r.events.slice(1), [
    { e: 'draw', seat: 1, replacement: false },
    { e: 'flower', seat: 1, tile: T('6f') },
    { e: 'draw', seat: 1, replacement: true },
  ]);
  assert.equal(m.hand.drawn[1], T('9p'));
  const v = E.getView(m, 1);
  assert.equal(v.drawn, T('9p'));
  assert.deepEqual(v.flowers[1], [T('6f')]);
  assert.ok(!('tile' in r.events[1]), 'draw events never carry the tile');
});

test('dead wall: the hand is a draw (流局) when the live wall runs out, leaving reserved tiles', () => {
  const spec = {
    dealer: 0,
    turn: 0,
    drawn: '1z',
    front: '7z7z',
    hands: ['147m 258p 369s 1234z 5z', '258m 369p 147s 5z 6z 3m 4p', '369m 147p 258s 3z 4z 1m 5p', '147m 258p 369s 2z 6z 7p 8s'],
  };
  const m = craft({ ...GEN, reservedTiles: 0 }, spec);
  const h = m.hand;
  h.deadWall = h.tail - h.head - 2; // only 7z 7z are live
  assert.equal(E.liveWallCount(m), 2);
  act(m, 0, { type: 'discard', tile: T('1z') });
  assert.equal(h.turn, 1);
  act(m, 1, { type: 'discard', tile: T('7z') });
  assert.equal(E.liveWallCount(m), 0);
  const o2 = E.getLegalActions(m, 2);
  assert.equal(o2.kan.length, 0, 'no kong without a replacement tile');
  const r = act(m, 2, { type: 'discard', tile: T('7z') });
  assert.ok(E.isHandOver(m));
  assert.equal(m.result.type, 'draw');
  assert.deepEqual(m.result.winners, []);
  assert.equal(h.tail - h.head, h.deadWall, 'reserved tiles stay undrawn');
  assert.equal(m.result.dealerContinues, true);
  assert.ok(r.events.some((e) => e.e === 'handOver'));
});

test('reservedTiles setting: every exhausted hand leaves exactly that many tiles', () => {
  let draws = 0;
  for (let g = 0; g < 40; g++) {
    const m = E.createMatch({ ...GEN, reservedTiles: 60 }, `reserve-${g}`);
    E.startHand(m);
    while (!E.isHandOver(m)) {
      const s = E.getPendingSeats(m)[0];
      act(m, s, botAction(E.getView(m, s)));
    }
    if (m.result.type === 'draw') {
      draws++;
      assert.equal(m.hand.tail - m.hand.head, 60);
    }
  }
  assert.ok(draws > 0, 'some hands should exhaust the live wall');
});

// ---------------------------------------------------------------------------
// Validation

test('illegal actions are rejected with a Chinese reason and leave the match unchanged', () => {
  const m = craft(GEN, CLAIM_SPEC);
  const before = JSON.stringify(m);
  const cases = [
    [1, { type: 'discard', tile: T('4m') }],
    [0, { type: 'discard', tile: T('9m') }],
    [0, { type: 'pon' }],
    [0, { type: 'pass' }],
    [0, { type: 'hu' }],
    [0, { type: 'kan', tile: T('5m') }],
    [0, { type: 'chi', tiles: P('345m') }],
    [0, { type: 'nonsense' }],
    [0, null],
    [7, { type: 'discard', tile: T('5m') }],
  ];
  for (const [seat, a] of cases) {
    const r = E.applyAction(m, seat, a);
    assert.equal(r.ok, false, JSON.stringify(a));
    assert.match(r.error, /[一-鿿]/);
    assert.equal(JSON.stringify(m), before);
  }
});

// ---------------------------------------------------------------------------
// TAICANG scoring (examples from docs/taicang-mahjong-rules.md §7.7)

const TC = { ruleset: 'TAICANG' };

test('TAICANG 例2: 门清清一色自摸 = 6 花 × 8 = 48, three payers', () => {
  const m = craft(TC, {
    dealer: 0,
    turn: 0,
    drawn: '9m',
    indicator: T('1z'), // 东 → 财神 南
    flowers: ['6z 2x 2f 8f 1x', '', '', ''],
    hands: ['111m234m567m789m99m', null, null, null],
  });
  assert.deepEqual(m.hand.wilds, [T('2z')]);
  assert.equal(E.getLegalActions(m, 0).hu, true);
  act(m, 0, { type: 'hu' });
  const r = m.result;
  assert.equal(r.hua[0], 6);
  assert.equal(r.fan[0], 3);
  assert.equal(r.points[0], 48);
  const names = r.items[0].map((i) => i.name);
  for (const n of ['底花', '硬花', '门清', '清一色']) assert.ok(names.includes(n), n);
  assert.deepEqual(r.deltas, [144, -48, -48, -48]);
  assert.equal(r.nextDealer, 0);
});

const EX1 = {
  dealer: 0,
  indicator: T('3z'), // 西 → 财神 北
  flowers: ['', '5z 1f', '', ''],
  melds: [[], [{ type: 'chi', tiles: '345m', from: 0 }, { type: 'pon', tiles: '555s', from: 2 }], [], []],
};

test('TAICANG 例1: 小胡自摸 4 花 and the same hand on a discard', () => {
  const m = craft(TC, { ...EX1, turn: 1, drawn: '9m', hands: [null, '678p 111z 9m 9m', null, null] });
  assert.equal(E.getLegalActions(m, 1).hu, true);
  act(m, 1, { type: 'hu' });
  assert.equal(m.result.points[0], 4);
  assert.equal(m.result.fan[0], 0);
  assert.deepEqual(m.result.deltas, [-4, 12, -4, -4]);
  assert.equal(m.result.nextDealer, 1);

  const m2 = craft(TC, { ...EX1, turn: 0, drawn: '9m', hands: ['9m 1s 5p 9p 2s 3s 7p 8p 2m 6m 7s 8s 4z 4z', '678p 111z 9m', null, null] });
  act(m2, 0, { type: 'discard', tile: T('9m') });
  assert.equal(E.getLegalActions(m2, 1).hu, true, '门槛花 3 ≥ 3: may win on a discard');
  act(m2, 1, { type: 'hu' });
  assert.deepEqual(m2.result.deltas, [-4, 4, 0, 0]);
});

test('TAICANG 二花自摸三花冲: two 花 can self-draw but not win on a discard', () => {
  const ex = { ...EX1, flowers: ['', '1f', '', ''] };
  const self = craft(TC, { ...ex, turn: 1, drawn: '9m', hands: [null, '678p 111z 9m 9m', null, null] });
  assert.equal(E.getLegalActions(self, 1).hu, true, '1 硬花 + 东刻 = 2');
  const ron = craft(TC, { ...ex, turn: 0, drawn: '9m', hands: ['9m 1s 5p 9p 2s 3s 7p 8p 2m 6m 7s 8s 4z 4z', '678p 111z 9m', null, null] });
  act(ron, 0, { type: 'discard', tile: T('9m') });
  const o = E.getLegalActions(ron, 1);
  assert.ok(o === null || o.hu === false);
  const none = craft(TC, { ...ex, flowers: ['', '', '', ''], turn: 1, drawn: '9m', hands: [null, '678p 111z 9m 9m', null, null] });
  assert.equal(E.getLegalActions(none, 1).hu, false, '1 花 open hand without a pattern cannot win');
});

test('TAICANG 例4: 抢杠 — the konger pays 3 shares and deals next', () => {
  const m = craft(TC, {
    dealer: 3,
    turn: 0,
    drawn: '6p',
    indicator: T('3z'),
    flowers: ['', '6f 6z', '', ''],
    melds: [[{ type: 'pon', tiles: '666p', from: 2 }], [], [], []],
    hands: ['6p 1s 5s 9s 1m 9m 7p 8p 9p 1z 3z', '123m456m789s45p22z', null, null],
  });
  assert.equal(m.hand.hands[0].length, 11, '14 - 3 for the pon');
  const o = E.getLegalActions(m, 0);
  assert.ok(o.kanTypes.some((k) => k.type === 'bukan' && k.tile === T('6p')));
  act(m, 0, { type: 'kan', tile: T('6p') });
  assert.equal(E.getLegalActions(m, 1).hu, true);
  act(m, 1, { type: 'hu' });
  assert.equal(m.result.points[0], 6);
  assert.equal(m.result.deltas[0], -18);
  assert.equal(m.result.deltas[1], 18);
  assert.equal(m.result.robKong, true);
  assert.equal(m.result.nextDealer, 0);
});

test('TAICANG 例5: 无花果 with a 财神 — self-draw pays the cap, discard win is refused', () => {
  const spec = { dealer: 0, indicator: T('4m'), hands: [null, null, '123s456s789p23m5m2z2z', null], turn: 2, drawn: '2z' };
  const m = craft(TC, spec);
  assert.deepEqual(m.hand.wilds, [T('5m')]);
  assert.equal(E.getLegalActions(m, 2).hu, true);
  act(m, 2, { type: 'hu' });
  assert.equal(m.result.special[0], 'wuhuaguo');
  assert.ok(m.result.items[0].some((i) => i.name === '无花果' && i.value === 100));
  assert.deepEqual(m.result.deltas, [-100, -100, 300, -100]);

  const m2 = craft(TC, { ...spec, turn: 1, drawn: '2z', front: '9s', hands: [null, '2z 1m 9m 1p 9p 3s 7s 4z 4z 3p 7p 6s 8m 4m', '123s456s789p23m5m2z', null] });
  const r = act(m2, 1, { type: 'discard', tile: T('2z') });
  // 手里有财神不能吃冲: no claim window opens, seat 2 just draws its own tile.
  assert.deepEqual(r.events, [{ e: 'discard', seat: 1, tile: T('2z') }, { e: 'draw', seat: 2, replacement: false }]);
  assert.equal(m2.hand.stage, 'discard');
  assert.equal(E.getLegalActions(m2, 2).hu, false);
});

test('TAICANG 例6: 一炮多响 with the 花 gate filtering one seat', () => {
  const m = craft(TC, {
    dealer: 1,
    turn: 3,
    drawn: '8m',
    indicator: T('6z'), // 发 → 财神 白
    flowers: ['5z 3f 1x', '4f 7f', '8f', ''],
    melds: [[{ type: 'pon', tiles: '111z', from: 2 }], [{ type: 'chi', tiles: '123m', from: 0 }], [], []],
    hands: ['234m 456s 67m 99p', '567s 234p 79m 22z', '345s 678p 123p 67m 22s', '8m 1s 3s 8s 9s 5p 444z 33z 1m 9m 7p'],
  });
  act(m, 3, { type: 'discard', tile: T('8m') });
  assert.equal(E.getLegalActions(m, 0).hu, true);
  assert.equal(E.getLegalActions(m, 1), null, 'B: 门槛花 2 < 3 and no pattern');
  assert.equal(E.getLegalActions(m, 2).hu, true, 'C: 门清 is exempt');
  act(m, 0, { type: 'hu' });
  act(m, 2, { type: 'hu' });
  assert.deepEqual(m.result.winners, [0, 2]);
  assert.deepEqual(m.result.points, [5, 4]);
  assert.deepEqual(m.result.deltas, [5, 0, 4, -9]);
  assert.equal(m.result.nextDealer, 0, 'first winner after the discarder deals');
});

test('TAICANG 承包: 吃碰三口 from one seat makes that seat pay 5× on a self-draw', () => {
  const spec = {
    dealer: 0,
    turn: 1,
    drawn: '7s',
    indicator: T('3z'),
    flowers: ['', '1f 2f', '', ''],
    melds: [[], [{ type: 'pon', tiles: '111p', from: 3 }, { type: 'pon', tiles: '222s', from: 3 }, { type: 'pon', tiles: '999m', from: 3 }], [], []],
    hands: [null, '456m 7s 7s', null, null],
  };
  const m = craft(TC, spec);
  assert.equal(chengbaoSeat(m.hand.melds[1], m.settings), 3);
  act(m, 1, { type: 'hu' });
  assert.equal(m.result.points[0], 3);
  assert.equal(m.result.baoSeat, 3);
  assert.deepEqual(m.result.deltas, [0, 15, 0, -15]);
  const off = craft({ ...TC, chengbao: { enabled: false } }, spec);
  act(off, 1, { type: 'hu' });
  assert.deepEqual(off.result.deltas, [-3, 9, -3, -3]);
  assert.equal(off.settings.chengbao.threshold, 3, 'partial overrides keep the other defaults');
});

test('TAICANG 辣子: holding all four 财神 wins outright for the cap', () => {
  const m = craft(TC, { dealer: 0, turn: 0, drawn: '1s', indicator: T('9s'), hands: ['1111s 1m 5m 9m 1p 5p 9p 3s 7s 1z 3z', null, null, null] });
  assert.deepEqual(m.hand.wilds, [T('1s')]);
  assert.equal(E.getLegalActions(m, 0).hu, true);
  act(m, 0, { type: 'hu' });
  assert.equal(m.result.special[0], 'lazi');
  assert.deepEqual(m.result.deltas, [300, -100, -100, -100]);
});

test('TAICANG: a discarded 财神 cannot be claimed', () => {
  const m = craft(TC, { dealer: 0, turn: 0, drawn: '5m', indicator: T('4m'), hands: ['5m 19s 19p 1234z 28s 1m 2m 3m', null, null, null] });
  const r = act(m, 0, { type: 'discard', tile: T('5m') });
  assert.equal(r.events[1].e, 'draw');
  assert.equal(m.hand.turn, 1);
  assert.equal(m.hand.stage, 'discard');
});

test('TAICANG view: indicator, wilds, session and hidden 暗杠', () => {
  const m = E.createMatch({}, 'view');
  E.startHand(m);
  const v = E.getView(m, 2);
  assert.equal(v.game, 'taicang-mj');
  assert.equal(v.indicator, m.hand.indicator);
  assert.deepEqual(v.wilds, m.hand.wilds);
  assert.deepEqual(v.session, { handsPerSession: 8, handsPlayed: 0 });
  assert.equal(v.hand.length + (v.drawn === null ? 0 : 1), m.hand.hands[2].length);
  for (const k of ['wall', 'rng', 'seed', 'passedHu', 'responses', 'flowerMask']) assert.ok(!JSON.stringify(v).includes(`"${k}"`), k);
});

// ---------------------------------------------------------------------------
// Determinism, privacy

function playOut(match, maxActions = Infinity) {
  const log = [];
  let n = 0;
  while (!E.isHandOver(match) && n < maxActions) {
    const s = E.getPendingSeats(match)[0];
    const r = E.applyAction(match, s, botAction(E.getView(match, s)));
    assert.ok(r.ok, r.error);
    log.push(JSON.stringify(r.events));
    n++;
  }
  return log;
}

test('serialization round-trip mid-hand gives an identical continuation', () => {
  for (const ruleset of ['TAICANG', 'GENERIC']) {
    const a = E.createMatch({ ruleset }, `ser-${ruleset}`);
    E.startHand(a);
    playOut(a, 15);
    assert.ok(!E.isHandOver(a));
    const b = JSON.parse(JSON.stringify(a));
    const la = playOut(a);
    const lb = playOut(b);
    assert.deepEqual(la, lb);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    E.startHand(a);
    E.startHand(b);
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'RNG state survives serialization');
  }
});

function scrambleHidden(match, viewer, rng) {
  const h = match.hand;
  const others = [0, 1, 2, 3].filter((s) => s !== viewer);
  const pool = [];
  for (const s of others) pool.push(...h.hands[s]);
  for (let i = h.head; i < h.tail; i++) pool.push(h.wall[i]);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const s of others) {
    h.hands[s] = pool.splice(0, h.hands[s].length);
    if (h.drawn[s] !== null) h.drawn[s] = h.hands[s][h.hands[s].length - 1];
  }
  for (let i = h.head; i < h.tail; i++) h.wall[i] = pool.shift();
}

test('views never leak other seats’ concealed tiles or the wall order', () => {
  const rng = E.createRng('leak');
  let checks = 0;
  for (let g = 0; g < 12; g++) {
    const m = E.createMatch({ ruleset: g % 2 ? 'GENERIC' : 'TAICANG' }, `leak-${g}`);
    E.startHand(m);
    let step = 0;
    while (!E.isHandOver(m)) {
      if (step % 5 === 0) {
        for (let viewer = 0; viewer < 4; viewer++) {
          const before = JSON.stringify(E.getView(m, viewer));
          const copy = JSON.parse(JSON.stringify(m));
          scrambleHidden(copy, viewer, rng);
          assert.equal(JSON.stringify(E.getView(copy, viewer)), before, `view of seat ${viewer} depends on hidden tiles`);
          checks++;
        }
      }
      const s = E.getPendingSeats(m)[0];
      const r = E.applyAction(m, s, botAction(E.getView(m, s)));
      assert.ok(r.ok);
      for (const e of r.events) if (e.e === 'draw') assert.deepEqual(Object.keys(e).sort(), ['e', 'replacement', 'seat']);
      step++;
    }
  }
  assert.ok(checks > 100);
});

// ---------------------------------------------------------------------------
// Big simulation

const SIM_CONFIGS = [
  { ruleset: 'TAICANG' },
  { ruleset: 'TAICANG' },
  { ruleset: 'TAICANG', scoringModel: 'suzhou-additive', chengbao: { onDiscard: 'baojia-pays-5x' } },
  { ruleset: 'TAICANG', capHua: null, multiWin: false, passHuScope: 'same-tile', revealOneOfAnGang: true, tianDiHu: 'cap', haidiFan: 1 },
  { ruleset: 'GENERIC' },
  { ruleset: 'GENERIC', multiWin: false, passHuLock: true, allowChi: false, reservedTiles: 30 },
  { ruleset: 'GENERIC', honorsAsFlowers: true, dealerDraws: true, revealAnKan: true, thirteenOrphans: true },
  { ruleset: 'GENERIC', declareReady: true, readyRequired: true, minScore: 3, maxScore: 6 },
];
const LEVELS = ['easy', 'normal', 'hard'];

test('2000 simulated hands with 4 bots: legal, conserved, zero-sum, terminating', (t) => {
  const times = [];
  const stats = { hands: 0, wins: 0, selfDraw: 0, draws: 0, multi: 0, rob: 0, bao: 0, special: 0, actions: 0, maxActions: 0 };
  const matches = 500;
  const t0 = performance.now();
  for (let g = 0; g < matches; g++) {
    const cfg = SIM_CONFIGS[g % SIM_CONFIGS.length];
    const m = E.createMatch(cfg, `sim-${g}`);
    const levels = [0, 1, 2, 3].map((s) => LEVELS[(g + s) % 3]);
    const memory = [{}, {}, {}, {}];
    for (let hand = 0; hand < 4; hand++) {
      E.startHand(m);
      assertConserved(m, 'after deal');
      let n = 0;
      while (!E.isHandOver(m)) {
        const pending = E.getPendingSeats(m);
        assert.ok(pending.length > 0, 'playing but nobody to act');
        const seat = pending[(g + n) % pending.length];
        const view = E.getView(m, seat);
        assert.ok(view.options, 'pending seat has options');
        const a0 = performance.now();
        const action = botAction(view, memory[seat], { level: levels[seat] });
        times.push(performance.now() - a0);
        const r = E.applyAction(m, seat, action);
        if (!r.ok) assert.fail(`bot action rejected (match ${g}, hand ${hand}): ${JSON.stringify(action)} → ${r.error}`);
        n++;
        if (n > 1500) assert.fail('hand did not end');
        if (n % 3 === 0) assertConserved(m, `match ${g} hand ${hand} action ${n}`);
      }
      assertConserved(m, 'at hand end');
      const res = m.result;
      assert.equal(sum(res.deltas), 0, `zero-sum deltas ${res.deltas}`);
      assert.ok(Math.abs(sum(m.scores)) < 1e-9, 'scores stay zero-sum');
      stats.hands++;
      stats.actions += n;
      stats.maxActions = Math.max(stats.maxActions, n);
      if (res.type === 'draw') stats.draws++;
      else {
        stats.wins++;
        if (res.selfDraw) stats.selfDraw++;
        if (res.winners.length > 1) stats.multi++;
        if (res.robKong) stats.rob++;
        if (res.baoSeat !== null) stats.bao++;
        if (res.special.some(Boolean)) stats.special++;
        assert.equal(res.items.length, res.winners.length);
      }
    }
    assert.equal(m.history.length, 4);
  }
  const elapsed = performance.now() - t0;
  times.sort((a, b) => a - b);
  const pct = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const line = `hands=${stats.hands} wins=${stats.wins} (selfDraw ${stats.selfDraw}, multi ${stats.multi}, rob ${stats.rob}, 承包 ${stats.bao}, special ${stats.special}) draws=${stats.draws} actions=${stats.actions} maxActionsPerHand=${stats.maxActions} total=${(elapsed / 1000).toFixed(1)}s`;
  const timing = `bot decisions=${times.length} mean=${mean.toFixed(3)}ms p50=${pct(0.5).toFixed(3)}ms p95=${pct(0.95).toFixed(3)}ms p99=${pct(0.99).toFixed(3)}ms max=${times[times.length - 1].toFixed(2)}ms`;
  t.diagnostic(line);
  t.diagnostic(timing);
  console.log(`[taicang-mj sim] ${line}`);
  console.log(`[taicang-mj sim] ${timing}`);
  assert.equal(stats.hands, 2000);
  assert.ok(pct(0.95) < 30, 'p95 decision under 30 ms');
});

test('ruleset registry exposes hooks', () => {
  for (const rs of Object.values(RULESETS)) {
    assert.equal(typeof rs.score, 'function');
    assert.equal(typeof rs.settle, 'function');
    assert.ok(rs.name && rs.options);
  }
});
