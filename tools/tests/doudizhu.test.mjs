// 斗地主 engine + bot tests. Run: node --test tools/tests/doudizhu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../games/doudizhu/engine.js';
import { botAction } from '../../games/doudizhu/ai.js';

// ---------- helpers ----------

/** 'K K 3 sj bj' → card ids (distinct suits per rank). */
function C(str) {
  const used = new Array(15).fill(0);
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      if (t === 'sj') return 52;
      if (t === 'bj') return 53;
      const r = E.RANK_LABELS.indexOf(t);
      if (r < 0 || r > 12) throw new Error(`bad card ${t}`);
      if (used[r] > 3) throw new Error(`too many ${t}`);
      return r * 4 + used[r]++;
    });
}

const kinds = (s) =>
  E.analyzeAll(C(s))
    .map((c) => `${c.type}:${E.RANK_LABELS[c.rank]}:${c.length}`)
    .sort();
const combo = (s) => E.analyzeCards(C(s));

function mulberry32(a) {
  return () => {
    let t = (a = (a + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Deterministic bot rng that depends only on match state, so a cloned match replays identically.
const decisionRng = (seed, m, seat) => mulberry32((seed * 7919 + m.seq * 31 + seat * 1000003) >>> 0);

const json = (x) => JSON.stringify(x);

function allCards(m) {
  const cards = [...m.hands.flat(), ...m.playedCards];
  if (m.landlord < 0) cards.push(...m.bottom);
  return cards;
}

/** Bid so that the first bidder becomes landlord (no robbing), then optionally replace the hands. */
function rig({ ll, f1, f2, settings, seed = 'rig' }) {
  const m = E.createMatch(settings, seed);
  E.startHand(m);
  const L = m.firstBidder;
  if (m.settings.bidMode === 'score') assert.ok(E.applyAction(m, L, { type: 'bid', score: 1 }).ok);
  else assert.ok(E.applyAction(m, L, { type: 'call' }).ok);
  while (m.phase === 'bidding') {
    const s = m.turn;
    assert.ok(E.applyAction(m, s, m.settings.bidMode === 'score' ? { type: 'bid', score: 0 } : { type: 'norob' }).ok);
  }
  assert.equal(m.landlord, L);
  if (ll !== undefined) {
    m.hands[L] = E.sortCards(C(ll));
    m.hands[(L + 1) % 3] = E.sortCards(C(f1));
    m.hands[(L + 2) % 3] = E.sortCards(C(f2));
  }
  return { m, L, F1: (L + 1) % 3, F2: (L + 2) % 3 };
}

/** Play `cards` (rank string) choosing matching ids from the seat's hand. */
function playRanks(m, seat, s) {
  const want = C(s).map(E.rankOf);
  const hand = m.hands[seat].slice();
  const cards = [];
  for (const r of want) {
    const i = hand.findIndex((id) => E.rankOf(id) === r);
    assert.ok(i >= 0, `seat ${seat} lacks ${s}`);
    cards.push(hand.splice(i, 1)[0]);
  }
  return E.applyAction(m, seat, { type: 'play', cards });
}

// ---------- cards ----------

test('card helpers', () => {
  assert.equal(E.GAME_ID, 'doudizhu');
  assert.equal(E.SEATS, 3);
  assert.equal(E.rankOf(0), 0);
  assert.equal(E.rankOf(51), 12);
  assert.equal(E.rankOf(52), 13);
  assert.equal(E.rankOf(53), 14);
  assert.equal(E.suitOf(5), 1);
  assert.equal(E.cardText(0), '♠3');
  assert.equal(E.cardText(29), '♥10');
  assert.equal(E.cardText(44), '♠A');
  assert.equal(E.cardText(51), '♦2');
  assert.equal(E.cardText(52), '小王');
  assert.equal(E.cardText(53), '大王');
  assert.deepEqual(E.sortCards([0, 53, 47, 5, 52, 44]), [53, 52, 44, 47, 5, 0]);
  assert.deepEqual(E.defaultSettings(), { bidMode: 'rob', baseScore: 1, botLevel: 'normal' });
});

// ---------- combos ----------

test('analyzeCards recognises every combo type', () => {
  const cases = [
    ['5', 'single', '5', 1, '单张'],
    ['bj', 'single', '大王', 1, '单张'],
    ['9 9', 'pair', '9', 1, '对子'],
    ['2 2', 'pair', '2', 1, '对子'],
    ['7 7 7', 'trio', '7', 1, '三张'],
    ['7 7 7 3', 'trio1', '7', 1, '三带一'],
    ['2 2 2 sj', 'trio1', '2', 1, '三带一'],
    ['7 7 7 3 3', 'trio2', '7', 1, '三带二'],
    ['3 4 5 6 7', 'straight', '7', 5, '顺子'],
    ['10 J Q K A', 'straight', 'A', 5, '顺子'],
    ['3 4 5 6 7 8 9 10 J Q K A', 'straight', 'A', 12, '顺子'],
    ['3 3 4 4 5 5', 'pairStraight', '5', 3, '连对'],
    ['Q Q K K A A', 'pairStraight', 'A', 3, '连对'],
    ['8 8 8 9 9 9', 'plane', '9', 2, '飞机'],
    ['8 8 8 9 9 9 3 K', 'plane1', '9', 2, '飞机带翅膀'],
    ['8 8 8 9 9 9 3 3', 'plane1', '9', 2, '飞机带翅膀'],
    ['8 8 8 9 9 9 3 3 K K', 'plane2', '9', 2, '飞机带翅膀'],
    ['3 3 3 3 5 6', 'four2', '3', 1, '四带二'],
    ['3 3 3 3 5 5', 'four2', '3', 1, '四带二'],
    ['3 3 3 3 sj 6', 'four2', '3', 1, '四带二'],
    ['3 3 3 3 5 5 6 6', 'four2pairs', '3', 1, '四带两对'],
    ['6 6 6 6', 'bomb', '6', 1, '炸弹'],
    ['sj bj', 'rocket', '大王', 1, '王炸'],
  ];
  for (const [s, type, rank, length, name] of cases) {
    const c = combo(s);
    assert.ok(c, `${s} should be valid`);
    assert.equal(c.type, type, s);
    assert.equal(E.RANK_LABELS[c.rank], rank, s);
    assert.equal(c.length, length, s);
    assert.equal(c.name, name, s);
    assert.equal(E.comboSize(c), C(s).length, s);
  }
  assert.equal(combo('8 8 8 9 9 9 3 K').wings, 1);
  assert.equal(combo('8 8 8 9 9 9 3 3 K K').wings, 2);
  assert.equal(combo('7 7 7').wings, 0);
});

test('invalid sets and edge cases', () => {
  const invalid = [
    '3 4',
    '3 3 4',
    '3 4 5 6', // straight too short
    'J Q K A 2', // 2 cannot be in a straight
    '10 J Q K A sj',
    'K K A A 2 2', // no 2 in pair straights
    '3 3 4 4', // pair straight needs 3 pairs
    'A A A 2 2 2', // no 2 in planes
    'K K K A A A 2 2 2 3 4 5',
    '3 3 3 5 5 5', // not consecutive
    'sj sj'.replace('sj sj', '3 sj'),
    '3 3 3 sj bj', // jokers are not a pair
    '3 3 3 3 sj bj', // 四带二 cannot carry both jokers
    '3 3 3 4 4 4 sj bj', // plane wings cannot be both jokers
    '3 3 3 3 4', // four + one
    '3 3 3 4 4 4 5', // plane with a partial wing
    '3 3 3 4 4 4 5 5 6', // mixed wings
  ];
  for (const s of invalid) {
    assert.equal(combo(s), null, s);
    assert.deepEqual(E.analyzeAll(C(s)), [], s);
  }
  // 三带一 with a same-rank single is a bomb
  assert.deepEqual(kinds('3 3 3 3'), ['bomb:3:1']);
  // ambiguous planes
  assert.deepEqual(kinds('3 3 3 4 4 4 5 5 5 6 6 6'), ['plane1:5:3', 'plane1:6:3', 'plane:6:4']);
  assert.equal(combo('3 3 3 4 4 4 5 5 5 6 6 6').type, 'plane');
  assert.equal(combo('3 3 3 4 4 4 5 5 5 6 6 6').length, 4);
  // 四带两对 vs plane with single wings
  assert.deepEqual(kinds('3 3 3 3 4 4 4 4'), ['four2pairs:3:1', 'four2pairs:4:1', 'plane1:4:2']);
  assert.equal(combo('3 3 3 3 4 4 4 4').type, 'plane1');
  // 15 cards: 666/777 cannot be split into pairs, so only the 5-trio plane
  assert.deepEqual(kinds('3 3 3 4 4 4 5 5 5 6 6 6 7 7 7'), ['plane:7:5']);
  // a four of a kind may serve as two pair wings
  assert.deepEqual(kinds('3 3 3 4 4 4 5 5 5 6 6 6 6 7 7'), ['plane2:5:3']);
  // 20 cards: 5-trio plane with single wings vs 4-trio plane with pairs
  assert.deepEqual(kinds('3 3 3 4 4 4 5 5 5 6 6 6 7 7 7 8 8 9 9 10'), ['plane1:7:5']);
  assert.deepEqual(kinds('3 3 3 4 4 4 5 5 5 6 6 6 7 7 7 7 8 8 9 9'), ['plane1:7:5', 'plane2:6:4']);
  assert.equal(combo('3 3 3 4 4 4 5 5 5 6 6 6 7 7 7 7 8 8 9 9').type, 'plane1');
  // bad input never throws
  for (const bad of [null, undefined, 'abc', [], [1, 1], [54], [-1], [1.5], [{}], ['3']]) {
    assert.deepEqual(E.analyzeAll(bad), []);
    assert.equal(E.analyzeCards(bad), null);
  }
});

test('canBeat matrix', () => {
  const rows = [
    ['4', '3', true],
    ['3', '4', false],
    ['3', '3', false],
    ['2', 'A', true],
    ['sj', '2', true],
    ['bj', 'sj', true],
    ['4 4', '3', false], // different type
    ['4 4', '3 3', true],
    ['4 4 4 9', '3 3 3 K', true],
    ['4 4 4 9 9', '3 3 3 K', false], // wing kind differs
    ['4 5 6 7 8', '3 4 5 6 7', true],
    ['4 5 6 7 8 9', '3 4 5 6 7', false], // length differs
    ['4 4 5 5 6 6', '3 3 4 4 5 5', true],
    ['5 5 5 6 6 6 3 4', '4 4 4 5 5 5 9 9', true],
    ['5 5 5 6 6 6 3 3 4 4', '4 4 4 5 5 5 9 K', false],
    ['3 3 3 3', '2', true], // bomb over anything
    ['3 3 3 3', '3 4 5 6 7 8 9 10 J Q K A', true],
    ['4 4 4 4', '3 3 3 3', true],
    ['3 3 3 3', '4 4 4 4', false],
    ['2 2 2 2', 'sj bj', false],
    ['sj bj', '2 2 2 2', true],
    ['A', '3 3 3 3', false],
    ['5 5 5 5 3 4', '4 4 4 4 9 10', true],
    ['5 5 5 5 3 4', '4 4 4 4', false], // 四带二 is not a bomb
    ['4 4 4 4', '5 5 5 5 3 4', true],
  ];
  for (const [a, b, want] of rows) assert.equal(E.canBeat(combo(a), combo(b)), want, `${a} over ${b}`);
  assert.equal(E.canBeat(combo('3'), null), true);
  assert.equal(E.canBeat(null, combo('3')), false);
});

test('hintPlays: concrete ordering', () => {
  const hand = C('3 4 5 6 7 9 9 J Q Q K K K 2 sj');
  const hints = E.hintPlays(hand, combo('5'));
  const first = hints[0].map(E.rankOf);
  assert.deepEqual(first, [8], 'J is the cheapest single that breaks nothing');
  const ranks = hints.map((h) => E.RANK_LABELS[E.rankOf(h[0])]);
  assert.ok(ranks.indexOf('J') < ranks.indexOf('6'), 'breaking the straight comes later');
  // bombs and rocket last
  const h2 = E.hintPlays(C('3 3 3 3 5 5 6 7 7 7 9 sj bj'), combo('4 4 4 8'));
  const types = h2.map((h) => E.analyzeCards(h).type);
  assert.deepEqual(types, ['trio1', 'trio1', 'bomb', 'rocket']);
  assert.deepEqual(h2[0].map(E.rankOf).sort((a, b) => a - b), [3, 4, 4, 4]);
  // nothing beats a rocket
  assert.deepEqual(E.hintPlays(C('2 2 2 2 sj'), combo('sj bj')), []);
  // leading: whole hand first when it is one combo, else weakest group first
  assert.deepEqual(E.hintPlays(C('3 3 3 4'), null)[0].map(E.rankOf).sort(), [0, 0, 0, 1]);
  const lead = E.hintPlays(C('3 4 5 6 7 J J 2 sj bj'), null);
  assert.equal(E.analyzeCards(lead[0]).type, 'straight');
  assert.equal(E.analyzeCards(lead[lead.length - 1]).type, 'rocket');
});

test('hintPlays: random hands give only valid beating plays, complete and ordered', () => {
  const rng = mulberry32(7);
  const deck = Array.from({ length: 54 }, (_, i) => i);
  let checked = 0;
  for (let iter = 0; iter < 600; iter++) {
    const d = shuffle(deck.slice(), rng);
    const hand = d.slice(0, 1 + Math.floor(rng() * 10));
    // a random previous combo from another random hand
    const other = d.slice(20, 40);
    const leads = E.rankPlays(E.countRanks(other), null);
    const pick = leads[Math.floor(rng() * leads.length)];
    const prev = iter % 5 === 0 ? null : pick.combo;
    const hints = E.hintPlays(hand, prev);
    const seen = new Set();
    let lastHeavy = 0;
    for (const h of hints) {
      assert.ok(h.every((id) => hand.includes(id)), 'hint uses own cards');
      const c = E.resolvePlay(h, prev);
      assert.ok(c, `hint ${h} must be playable on ${json(prev)}`);
      assert.ok(E.canBeat(c, prev));
      const key = h.slice().sort((a, b) => a - b).join();
      assert.ok(!seen.has(key), 'no duplicate hints');
      seen.add(key);
      const heavy = c.type === 'rocket' ? 3 : c.type === 'bomb' ? 2 : 0;
      if (prev) {
        assert.ok(heavy >= lastHeavy, 'bombs and rocket come last');
        lastHeavy = heavy;
      }
    }
    // completeness: brute force over subsets says whether any beating play exists
    if (prev) {
      let exists = false;
      for (let mask = 1; mask < 1 << hand.length && !exists; mask++) {
        const sub = hand.filter((_, i) => mask & (1 << i));
        if (E.resolvePlay(sub, prev)) exists = true;
      }
      assert.equal(hints.length > 0, exists, `hand ${hand} prev ${json(prev)}`);
      checked++;
    }
  }
  assert.ok(checked > 400);
});

// ---------- bidding ----------

test('rob mode: all refuse → redeal with next first bidder', () => {
  const m = E.createMatch({}, 'redeal');
  E.startHand(m);
  const first = m.firstBidder;
  const before = json(m.hands);
  assert.deepEqual(E.getLegalActions(m, first), { bid: [{ type: 'call' }, { type: 'nocall' }] });
  assert.equal(E.getLegalActions(m, (first + 1) % 3), null);
  let events = [];
  for (let i = 0; i < 3; i++) {
    const r = E.applyAction(m, m.turn, { type: 'nocall' });
    assert.ok(r.ok);
    events = r.events;
  }
  assert.deepEqual(events.map((e) => e.e), ['bid', 'redeal']);
  assert.equal(events[1].firstBidder, (first + 1) % 3);
  assert.equal(m.firstBidder, (first + 1) % 3);
  assert.equal(m.turn, m.firstBidder);
  assert.equal(m.phase, 'bidding');
  assert.equal(m.redeals, 1);
  assert.notEqual(json(m.hands), before);
  assert.equal(new Set(allCards(m)).size, 54);
  assert.deepEqual(E.getView(m, 0).bidding.history, []);
});

test('rob mode: call with no robbers, robbing, final rob and multiplier', () => {
  // nobody robs → caller is landlord at ×1
  {
    const m = E.createMatch({}, 'r1');
    E.startHand(m);
    const f = m.firstBidder;
    assert.ok(E.applyAction(m, f, { type: 'call' }).ok);
    assert.deepEqual(E.getLegalActions(m, (f + 1) % 3).bid, [{ type: 'rob' }, { type: 'norob' }]);
    assert.ok(E.applyAction(m, (f + 1) % 3, { type: 'norob' }).ok);
    const r = E.applyAction(m, (f + 2) % 3, { type: 'norob' });
    assert.ok(r.ok);
    assert.deepEqual(r.events.map((e) => e.e), ['bid', 'landlord']);
    assert.equal(r.events[1].seat, f);
    assert.equal(m.landlord, f);
    assert.equal(m.multiplier, 1);
    assert.equal(m.hands[f].length, 20);
    assert.equal(m.turn, f);
    assert.equal(m.phase, 'playing');
    const v = E.getView(m, (f + 1) % 3);
    assert.deepEqual(v.bottom, m.bottom);
    assert.equal(v.bidding.stage, 'done');
    assert.deepEqual(E.getLegalActions(m, f), { canPass: false, mustLead: true, prev: null });
  }
  // everyone robs, caller robs back: ×8, caller is landlord
  {
    const m = E.createMatch({}, 'r2');
    E.startHand(m);
    const f = m.firstBidder;
    E.applyAction(m, f, { type: 'call' });
    assert.equal(E.applyAction(m, (f + 1) % 3, { type: 'rob' }).events[0].multiplier, 2);
    E.applyAction(m, (f + 2) % 3, { type: 'rob' });
    assert.equal(m.turn, f, 'caller gets the final say');
    assert.equal(E.getView(m, f).bidding.candidate, (f + 2) % 3);
    assert.equal(E.applyAction(m, (f + 1) % 3, { type: 'rob' }).ok, false);
    E.applyAction(m, f, { type: 'rob' });
    assert.equal(m.landlord, f);
    assert.equal(m.multiplier, 8);
  }
  // one robber, caller declines: robber is landlord at ×2
  {
    const m = E.createMatch({}, 'r3');
    E.startHand(m);
    const f = m.firstBidder;
    E.applyAction(m, f, { type: 'call' });
    E.applyAction(m, (f + 1) % 3, { type: 'rob' });
    E.applyAction(m, (f + 2) % 3, { type: 'norob' });
    assert.equal(m.turn, f);
    E.applyAction(m, f, { type: 'norob' });
    assert.equal(m.landlord, (f + 1) % 3);
    assert.equal(m.multiplier, 2);
  }
  // a player who refused to call gets no rob chance
  {
    const m = E.createMatch({}, 'r4');
    E.startHand(m);
    const f = m.firstBidder;
    E.applyAction(m, f, { type: 'nocall' });
    E.applyAction(m, (f + 1) % 3, { type: 'call' });
    assert.equal(m.turn, (f + 2) % 3);
    E.applyAction(m, (f + 2) % 3, { type: 'rob' });
    assert.equal(m.turn, (f + 1) % 3, 'back to the caller, the refuser is skipped');
    E.applyAction(m, (f + 1) % 3, { type: 'norob' });
    assert.equal(m.landlord, (f + 2) % 3);
    assert.equal(m.multiplier, 2);
    const hist = E.getView(m, 0).bidding.history;
    assert.equal(hist.filter((h) => h.seat === f).length, 1);
  }
  // last seat calls after two refusals: no one left to rob
  {
    const m = E.createMatch({}, 'r5');
    E.startHand(m);
    const f = m.firstBidder;
    E.applyAction(m, f, { type: 'nocall' });
    E.applyAction(m, (f + 1) % 3, { type: 'nocall' });
    const r = E.applyAction(m, (f + 2) % 3, { type: 'call' });
    assert.deepEqual(r.events.map((e) => e.e), ['bid', 'landlord']);
    assert.equal(m.landlord, (f + 2) % 3);
  }
});

test('score mode bidding', () => {
  {
    const m = E.createMatch({ bidMode: 'score' }, 's1');
    E.startHand(m);
    const f = m.firstBidder;
    assert.deepEqual(E.getLegalActions(m, f).bid.map((a) => a.score), [0, 1, 2, 3]);
    assert.ok(E.applyAction(m, f, { type: 'bid', score: 1 }).ok);
    assert.deepEqual(E.getLegalActions(m, (f + 1) % 3).bid.map((a) => a.score), [0, 2, 3]);
    const bad = E.applyAction(m, (f + 1) % 3, { type: 'bid', score: 1 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /高于/);
    assert.equal(E.applyAction(m, (f + 1) % 3, { type: 'call' }).ok, false);
    E.applyAction(m, (f + 1) % 3, { type: 'bid', score: 2 });
    E.applyAction(m, (f + 2) % 3, { type: 'bid', score: 0 });
    assert.equal(m.landlord, (f + 1) % 3);
    assert.equal(m.multiplier, 2);
    assert.equal(E.getView(m, f).bidding.highScore, 2);
  }
  {
    const m = E.createMatch({ bidMode: 'score' }, 's2');
    E.startHand(m);
    const f = m.firstBidder;
    E.applyAction(m, f, { type: 'bid', score: 0 });
    const r = E.applyAction(m, (f + 1) % 3, { type: 'bid', score: 3 });
    assert.deepEqual(r.events.map((e) => e.e), ['bid', 'landlord'], '3 ends bidding at once');
    assert.equal(m.landlord, (f + 1) % 3);
    assert.equal(m.multiplier, 3);
  }
  {
    const m = E.createMatch({ bidMode: 'score' }, 's3');
    E.startHand(m);
    const f = m.firstBidder;
    E.applyAction(m, f, { type: 'bid', score: 0 });
    E.applyAction(m, (f + 1) % 3, { type: 'bid', score: 0 });
    const r = E.applyAction(m, (f + 2) % 3, { type: 'bid', score: 0 });
    assert.deepEqual(r.events.map((e) => e.e), ['bid', 'redeal']);
    assert.equal(m.firstBidder, (f + 1) % 3);
    assert.equal(m.phase, 'bidding');
  }
});

// ---------- play ----------

test('trick flow: must lead, must beat, two passes win the trick', () => {
  const { m, L, F1, F2 } = rig({ ll: '3 3 5 9 9 K', f1: '4 4 8 Q', f2: '6 7 A 2' });
  assert.equal(E.applyAction(m, L, { type: 'pass' }).ok, false);
  assert.match(E.applyAction(m, L, { type: 'pass' }).error, /首家/);
  assert.equal(E.applyAction(m, F1, { type: 'pass' }).error, '还没轮到你');
  assert.ok(playRanks(m, L, '3 3').ok);
  assert.equal(playRanks(m, F1, '8').ok, false, 'single on a pair');
  assert.deepEqual(E.getLegalActions(m, F1), { canPass: true, mustLead: false, prev: combo('3 3') });
  assert.ok(playRanks(m, F1, '4 4').ok);
  assert.ok(E.applyAction(m, F2, { type: 'pass' }).ok);
  const r = E.applyAction(m, L, { type: 'pass' });
  assert.ok(r.ok);
  assert.deepEqual(r.events, [{ e: 'pass', seat: L }, { e: 'trickWon', seat: F1 }]);
  assert.equal(m.turn, F1);
  assert.equal(m.trick.last, null);
  assert.deepEqual(m.trick.actions, [null, null, null]);
  assert.equal(m.trick.leader, F1);
  assert.ok(playRanks(m, F1, '8').ok);
  assert.equal(playRanks(m, F2, '7').ok, false);
  assert.match(playRanks(m, F2, '7').error, /管不上/);
  assert.ok(playRanks(m, F2, '2').ok);
  assert.deepEqual(E.getView(m, L).trick.actions[F2].cards.map(E.rankOf), [12]);
  assert.equal(E.getView(m, L).trick.actions[F1].combo.type, 'single');
});

test('applyAction never throws and leaves the match untouched on bad input', () => {
  const { m, L } = rig({});
  const snapshot = json(m);
  const bad = [
    [L, null],
    [L, undefined],
    [L, 'play'],
    [L, {}],
    [L, { type: 'play' }],
    [L, { type: 'play', cards: [] }],
    [L, { type: 'play', cards: 'abc' }],
    [L, { type: 'play', cards: [999] }],
    [L, { type: 'play', cards: [m.hands[L][0], m.hands[L][0]] }],
    [L, { type: 'play', cards: [m.hands[(L + 1) % 3][0]] }],
    [L, { type: 'play', cards: [m.hands[L][0], m.hands[L][19]], as: 'pair' }],
    [L, { type: 'call' }],
    [L, { type: 'bid', score: 9 }],
    [L, { type: 'pass' }],
    [(L + 1) % 3, { type: 'pass' }],
    [7, { type: 'pass' }],
    [-1, { type: 'pass' }],
    ['x', { type: 'pass' }],
  ];
  for (const [seat, action] of bad) {
    const r = E.applyAction(m, seat, action);
    assert.equal(r.ok, false, json(action));
    assert.equal(typeof r.error, 'string');
    assert.ok(/[一-龥]/.test(r.error), 'Chinese error message');
  }
  assert.equal(json(m), snapshot);
  assert.equal(E.applyAction(null, 0, { type: 'pass' }).ok, false);
  const fresh = E.createMatch({}, 'idle');
  assert.equal(E.applyAction(fresh, 0, { type: 'call' }).ok, false);
  assert.deepEqual(E.getPendingSeats(fresh), []);
});

test('bombs double, spring doubles, settlement is zero-sum', () => {
  // spring: landlord bombs then runs out; farmers never play
  const { m, L, F1, F2 } = rig({ ll: '3 4 5 6 7 9 9 9 9', f1: 'A A 2 K', f2: 'Q Q J 10', settings: { baseScore: 3 } });
  m.scores = [0, 0, 0];
  let r = playRanks(m, L, '9 9 9 9');
  assert.equal(r.events[0].combo.type, 'bomb');
  assert.equal(m.multiplier, 2);
  assert.equal(m.bombsPlayed, 1);
  E.applyAction(m, F1, { type: 'pass' });
  E.applyAction(m, F2, { type: 'pass' });
  r = playRanks(m, L, '3 4 5 6 7');
  assert.ok(E.isHandOver(m));
  const res = m.result;
  assert.equal(res.winnerSide, 'landlord');
  assert.equal(res.winner, L);
  assert.equal(res.spring, true);
  assert.equal(res.antiSpring, false);
  assert.equal(res.multiplier, 4);
  assert.equal(res.deltas[L], 2 * 3 * 4);
  assert.equal(res.deltas[F1], -12);
  assert.equal(res.deltas[F2], -12);
  assert.deepEqual(m.scores, res.deltas);
  assert.deepEqual(r.events.map((e) => e.e), ['play', 'handOver']);
  assert.deepEqual(E.getPendingSeats(m), []);
  assert.equal(E.getLegalActions(m, L), null);
  assert.deepEqual(res.hands[F1].map(E.rankOf).sort(), [10, 11, 11, 12].sort());
  assert.equal(E.getView(m, F1).phase, 'over');
});

test('anti-spring and rocket; no spring once a farmer has played', () => {
  {
    // landlord leads once, farmers take over and win: 反春
    const { m, L, F1, F2 } = rig({ ll: '3 5 5 8 8 K', f1: '2 6 6', f2: 'sj bj 4 4' });
    playRanks(m, L, '3');
    playRanks(m, F1, '2');
    E.applyAction(m, F2, { type: 'pass' });
    E.applyAction(m, L, { type: 'pass' });
    playRanks(m, F1, '6 6');
    assert.ok(E.isHandOver(m));
    assert.equal(m.result.winnerSide, 'farmers');
    assert.equal(m.result.winner, F1);
    assert.equal(m.result.antiSpring, true);
    assert.equal(m.result.multiplier, 2);
    assert.equal(m.result.deltas[L], -4);
    assert.equal(m.result.deltas[F1] + m.result.deltas[F2] + m.result.deltas[L], 0);
  }
  {
    // landlord leads twice before losing: no anti-spring. Rocket doubles.
    const { m, L, F1, F2 } = rig({ ll: '3 4 8 8 K', f1: '5 9 9', f2: 'sj bj 7' });
    playRanks(m, L, '3');
    E.applyAction(m, F1, { type: 'pass' });
    E.applyAction(m, F2, { type: 'pass' });
    playRanks(m, L, '4');
    playRanks(m, F1, '5');
    const r = playRanks(m, F2, 'sj bj');
    assert.equal(r.events[0].combo.type, 'rocket');
    assert.equal(m.multiplier, 2);
    E.applyAction(m, L, { type: 'pass' });
    E.applyAction(m, F1, { type: 'pass' });
    playRanks(m, F2, '7');
    assert.equal(m.result.winnerSide, 'farmers');
    assert.equal(m.result.antiSpring, false);
    assert.equal(m.result.multiplier, 2);
  }
  {
    // landlord wins after a farmer played: no spring
    const { m, L, F1, F2 } = rig({ ll: '3 9 9', f1: '5 6', f2: '4 8' });
    playRanks(m, L, '3');
    playRanks(m, F1, '5');
    E.applyAction(m, F2, { type: 'pass' });
    playRanks(m, L, '9 9'.split(' ')[0]);
    E.applyAction(m, F1, { type: 'pass' });
    E.applyAction(m, F2, { type: 'pass' });
    playRanks(m, L, '9');
    assert.equal(m.result.winnerSide, 'landlord');
    assert.equal(m.result.spring, false);
    assert.equal(m.result.multiplier, 1);
  }
});

test('leading ambiguous cards: preferred reading, or the one asked for with `as`', () => {
  const { m, L, F1 } = rig({ ll: '3 3 3 3 4 4 4 4 9', f1: '5 5 5 5 6 6 6 6 K', f2: 'Q' });
  const cards = m.hands[L].filter((id) => E.rankOf(id) <= 1);
  const r = E.applyAction(m, L, { type: 'play', cards, as: 'four2pairs' });
  assert.ok(r.ok);
  assert.equal(r.events[0].combo.type, 'four2pairs');
  assert.equal(r.events[0].combo.rank, 1);
  // following may use any reading that beats the trick
  const f = m.hands[F1].filter((id) => E.rankOf(id) <= 3);
  const r2 = E.applyAction(m, F1, { type: 'play', cards: f });
  assert.ok(r2.ok);
  assert.equal(r2.events[0].combo.type, 'four2pairs');
});

// ---------- simulation ----------

function runHand(m, levels, seed, opts = {}) {
  const mem = [{}, {}, {}];
  const stats = opts.stats;
  let actions = 0;
  let llMultiplier = 0;
  let bombs = 0;
  let robs = 0;
  let high = 0;
  while (!E.isHandOver(m)) {
    const pending = E.getPendingSeats(m);
    assert.equal(pending.length, 1);
    const seat = pending[0];
    const view = E.getView(m, seat);
    const rng = decisionRng(seed, m, seat);
    const t0 = performance.now();
    const action = botAction(view, mem[seat], { level: levels[seat], rng });
    const dt = performance.now() - t0;
    if (stats) {
      stats.n++;
      stats.total += dt;
      if (dt > stats.max) stats.max = dt;
    }
    if (opts.checkEvents) checkEventsArePublic(m, seat, action);
    const res = E.applyAction(m, seat, action);
    assert.ok(res.ok, `bot ${levels[seat]} action ${json(action)} rejected: ${res.error}`);
    for (const ev of res.events) {
      if (ev.e === 'redeal') {
        robs = 0;
        high = 0;
      }
      if (ev.e === 'bid' && ev.action.type === 'rob') robs++;
      if (ev.e === 'bid' && ev.action.type === 'bid') high = Math.max(high, ev.action.score);
      if (ev.e === 'landlord') llMultiplier = ev.multiplier;
      if (ev.e === 'play' && (ev.combo.type === 'bomb' || ev.combo.type === 'rocket')) bombs++;
    }
    actions++;
    assert.ok(actions <= 300, 'hand must end within 300 actions');
    const cards = allCards(m);
    assert.equal(cards.length, 54);
    assert.equal(new Set(cards).size, 54);
    if (opts.checkViews) checkViewsHide(m, seed + actions);
  }
  const r = m.result;
  assert.equal(r.deltas[0] + r.deltas[1] + r.deltas[2], 0);
  const expectedLL = m.settings.bidMode === 'score' ? high : 2 ** robs;
  assert.equal(llMultiplier, expectedLL, 'multiplier when the landlord is decided');
  assert.equal(r.multiplier, llMultiplier * 2 ** bombs * (r.spring || r.antiSpring ? 2 : 1));
  assert.equal(r.bombs, bombs);
  assert.equal(m.hands[r.winner].length, 0);
  return { actions, result: r };
}

// Re-deal every card hidden from `seat` among the other holders: the view must not change.
function checkViewsHide(m, salt) {
  if (m.phase === 'over') return;
  const rng = mulberry32(salt);
  for (let seat = 0; seat < 3; seat++) {
    const c = JSON.parse(json(m));
    const others = [0, 1, 2].filter((s) => s !== seat);
    const pool = others.flatMap((s) => c.hands[s]);
    const withBottom = c.landlord < 0;
    if (withBottom) pool.push(...c.bottom);
    shuffle(pool, rng);
    let i = 0;
    for (const s of others) {
      const n = c.hands[s].length;
      c.hands[s] = E.sortCards(pool.slice(i, i + n));
      i += n;
    }
    if (withBottom) c.bottom = E.sortCards(pool.slice(i));
    c.rng = (c.rng + 12345) >>> 0;
    const a = json(E.getView(m, seat));
    assert.equal(json(E.getView(c, seat)), a, 'view leaks hidden cards');
    assert.ok(!/"rng"|"hands"/.test(a));
  }
}

// Events go to every client: they must be identical whatever the hidden cards of the other seats are.
function checkEventsArePublic(m, seat, action) {
  const c = JSON.parse(json(m));
  const others = [0, 1, 2].filter((s) => s !== seat);
  const pool = shuffle(others.flatMap((s) => c.hands[s]), mulberry32(m.seq + 99));
  let i = 0;
  for (const s of others) {
    const n = c.hands[s].length;
    c.hands[s] = E.sortCards(pool.slice(i, i + n));
    i += n;
  }
  const strip = (r) => r.events.map((e) => (e.e === 'handOver' ? { ...e, result: { ...e.result, hands: null } } : e));
  const a = E.applyAction(JSON.parse(json(m)), seat, action);
  const b = E.applyAction(c, seat, action);
  assert.equal(json(strip(b)), json(strip(a)), 'events depend on hidden cards');
}

test('3000 simulated bot hands: legal actions, conservation, zero-sum, bounded length', (t) => {
  const levelSets = [
    ['normal', 'normal', 'normal'],
    ['easy', 'normal', 'hard'],
    ['hard', 'hard', 'easy'],
    ['easy', 'easy', 'easy'],
    ['normal', 'hard', 'normal'],
    ['hard', 'hard', 'hard'],
  ];
  const stats = { n: 0, total: 0, max: 0 };
  const perLevel = {};
  let maxActions = 0;
  let llWins = 0;
  let springs = 0;
  let redeals = 0;
  const totals = [0, 0, 0];
  const HANDS = 3000;
  for (let h = 0; h < HANDS; h++) {
    const levels = levelSets[h % levelSets.length];
    const settings = { bidMode: h % 2 ? 'score' : 'rob', baseScore: [1, 2, 5][h % 3], botLevel: levels[0] };
    const m = E.createMatch(settings, `sim-${h}-${(h * 2654435761) >>> 0}`);
    E.startHand(m);
    const { actions, result } = runHand(m, levels, h, { stats, checkViews: h < 60, checkEvents: h < 60 });
    maxActions = Math.max(maxActions, actions);
    if (result.winnerSide === 'landlord') llWins++;
    if (result.spring || result.antiSpring) springs++;
    redeals += m.redeals;
    for (let s = 0; s < 3; s++) {
      totals[s] += result.deltas[s];
      perLevel[levels[s]] = perLevel[levels[s]] || [0, 0];
      perLevel[levels[s]][0] += result.deltas[s];
      perLevel[levels[s]][1]++;
    }
    assert.equal(m.scores.reduce((a, b) => a + b, 0), 0);
  }
  assert.equal(totals[0] + totals[1] + totals[2], 0);
  const avg = stats.total / stats.n;
  const summary =
    `${HANDS} hands, ${stats.n} bot decisions: avg ${avg.toFixed(3)} ms, max ${stats.max.toFixed(1)} ms; ` +
    `max actions/hand ${maxActions}; landlord won ${((llWins / HANDS) * 100).toFixed(1)}%; ` +
    `spring/anti-spring ${springs}; redeals ${redeals}; avg delta/hand by level ` +
    Object.entries(perLevel)
      .map(([k, [sum, n]]) => `${k} ${(sum / n).toFixed(3)}`)
      .join(', ');
  t.diagnostic(summary);
  console.log(`[doudizhu] ${summary}`);
  assert.ok(avg < 30, 'average decision under 30 ms');
  assert.ok(stats.max < 500, 'worst decision well bounded');
});

test('serialization round-trip mid-hand resumes identically', () => {
  for (let k = 0; k < 40; k++) {
    const levels = [['normal', 'hard', 'easy'], ['hard', 'hard', 'hard']][k % 2];
    const m = E.createMatch({ bidMode: k % 3 ? 'rob' : 'score' }, 900 + k);
    E.startHand(m);
    const stop = 1 + Math.floor(mulberry32(k)() * 30);
    const mem = [{}, {}, {}];
    for (let i = 0; i < stop && !E.isHandOver(m); i++) {
      const seat = m.turn;
      const a = botAction(E.getView(m, seat), mem[seat], { level: levels[seat], rng: decisionRng(k, m, seat) });
      assert.ok(E.applyAction(m, seat, a).ok);
    }
    const copy = JSON.parse(json(m));
    const memCopy = JSON.parse(json(mem));
    const finish = (match, memory) => {
      const log = [];
      while (!E.isHandOver(match)) {
        const seat = match.turn;
        const a = botAction(E.getView(match, seat), memory[seat], { level: levels[seat], rng: decisionRng(k, match, seat) });
        const r = E.applyAction(match, seat, a);
        assert.ok(r.ok);
        log.push(r.events);
      }
      // the next hand must deal identically too
      E.startHand(match);
      return json({ log, match });
    };
    assert.equal(finish(copy, memCopy), finish(m, mem));
  }
  // same seed → same deal
  const a = E.startHand(E.createMatch({}, 'same'));
  const b = E.startHand(E.createMatch({}, 'same'));
  assert.deepEqual(a.hands, b.hands);
  assert.equal(a.firstBidder, b.firstBidder);
});

test('views are compact and hide every other hand before the hand is over', () => {
  const m = E.createMatch({}, 'views');
  assert.equal(E.getView(m, 0).phase, 'idle');
  E.startHand(m);
  for (let seat = 0; seat < 3; seat++) {
    const v = E.getView(m, seat);
    assert.deepEqual(v.hand, m.hands[seat]);
    assert.deepEqual(v.counts, [17, 17, 17]);
    assert.deepEqual(v.bottom, []);
    assert.equal(v.landlord, -1);
    assert.equal(v.result, null);
    for (const key of ['game', 'seat', 'handNo', 'phase', 'hand', 'counts', 'turn', 'firstBidder', 'landlord', 'bottom', 'bidMode', 'multiplier', 'baseScore', 'bidding', 'trick', 'playedCards', 'bombsPlayed', 'scores', 'settings', 'seq', 'result']) {
      assert.ok(key in v, key);
    }
    const s = json(v);
    assert.ok(s.length < 1500, `view is compact (${s.length} bytes)`);
    for (let other = 0; other < 3; other++) {
      if (other === seat) continue;
      const parsed = JSON.parse(s);
      const cardsShown = [...parsed.hand, ...parsed.bottom, ...parsed.playedCards];
      for (const id of m.hands[other]) assert.ok(!cardsShown.includes(id));
    }
  }
  assert.deepEqual(E.getView(m, -1).hand, []);
  checkViewsHide(m, 1);
  // a full bot hand with the permutation check at every step
  runHand(m, ['normal', 'hard', 'easy'], 5, { checkViews: true, checkEvents: true });
  const over = E.getView(m, 0);
  assert.equal(over.phase, 'over');
  assert.equal(over.result.hands.length, 3);
});

test('bot basics: null when not its turn, respects bid modes', () => {
  const m = E.createMatch({ bidMode: 'score' }, 'botbasic');
  E.startHand(m);
  const notTurn = (m.turn + 1) % 3;
  assert.equal(botAction(E.getView(m, notTurn), {}, {}), null);
  const a = botAction(E.getView(m, m.turn), {}, { rng: mulberry32(1) });
  assert.equal(a.type, 'bid');
  assert.ok([0, 1, 2, 3].includes(a.score));
  // bot finishes when the whole hand is one combo
  const { m: m2, L } = rig({ ll: '3 3 3 4 4', f1: '5', f2: '6' });
  const act = botAction(E.getView(m2, L), {}, { level: 'normal', rng: mulberry32(2) });
  assert.equal(act.cards.length, 5);
});

test('bot tactics: forced win, stopping a nearly-out opponent, partner play', () => {
  // both jokers are gone and farmers hold 3 cards: the bomb is unbeatable, cash it before the last single
  {
    const { m, L } = rig({ ll: '2 2 2 2 4', f1: '3 5 6', f2: '7 8 9' });
    const view = E.getView(m, L);
    view.playedCards = [52, 53];
    const act = botAction(view, {}, { level: 'normal', rng: mulberry32(3) });
    assert.equal(E.analyzeCards(act.cards).type, 'bomb', 'cash the unbeatable bomb before the last single');
  }
  // farmer must stop a landlord with one card left, even with a bomb
  {
    const { m, L, F1 } = rig({ ll: '9 K', f1: '5 5 5 5 6 7 8', f2: '3 4 10 J' });
    playRanks(m, L, '9');
    const act = botAction(E.getView(m, F1), {}, { level: 'normal', rng: mulberry32(4) });
    assert.equal(act.type, 'play');
  }
  // farmer does not overtake a partner whom the landlord already let through
  {
    const { m, L, F1, F2 } = rig({ ll: '3 4 5 6 7 8 9 10 J Q K A 2', f1: '9 J J Q Q K', f2: '8 10 A 2 2' });
    playRanks(m, L, '3 4 5 6 7');
    E.applyAction(m, F1, { type: 'pass' });
    E.applyAction(m, F2, { type: 'pass' });
    playRanks(m, L, '8');
    playRanks(m, F1, '9');
    E.applyAction(m, F2, { type: 'pass' });
    E.applyAction(m, L, { type: 'pass' });
    playRanks(m, F1, 'J');
    const act = botAction(E.getView(m, F2), {}, { level: 'normal', rng: mulberry32(5) });
    assert.deepEqual(act, { type: 'pass' }, 'landlord comes after F2: do not take the partner\'s trick with a control card');
  }
  // leading against a landlord with one card left: lead the pair, not a single
  {
    const { m, L, F1, F2 } = rig({ ll: '3 K', f1: '4 4 6 9 A', f2: '10 J Q' });
    playRanks(m, L, '3');
    playRanks(m, F1, 'A');
    E.applyAction(m, F2, { type: 'pass' });
    E.applyAction(m, L, { type: 'pass' });
    assert.equal(m.turn, F1);
    const act = botAction(E.getView(m, F1), {}, { level: 'normal', rng: mulberry32(6) });
    assert.equal(E.analyzeCards(act.cards).type, 'pair');
  }
  // the partner has one card left: feed it the smallest single
  {
    const { m, L, F1, F2 } = rig({ ll: '3 9 9 J Q K', f1: '5 7 7 8 8', f2: '4' });
    playRanks(m, L, '3');
    playRanks(m, F1, '5');
    E.applyAction(m, F2, { type: 'pass' });
    E.applyAction(m, L, { type: 'pass' });
    const act = botAction(E.getView(m, F1), {}, { level: 'normal', rng: mulberry32(7) });
    assert.equal(act.type, 'play');
    assert.ok(E.analyzeCards(act.cards).type !== 'single' || E.rankOf(act.cards[0]) <= 4);
  }
});

test("AI strength: 'normal' clearly beats 'easy' (duplicate deals)", (t) => {
  const configs = [];
  for (let rot = 0; rot < 3; rot++) {
    configs.push([0, 1, 2].map((s) => (s === rot ? 'normal' : 'easy')));
    configs.push([0, 1, 2].map((s) => (s === rot ? 'easy' : 'normal')));
  }
  const sum = { normal: 0, easy: 0 };
  const n = { normal: 0, easy: 0 };
  const llWins = { normal: [0, 0], easy: [0, 0] };
  const DEALS = 150;
  for (let d = 0; d < DEALS; d++) {
    for (const levels of configs) {
      const m = E.createMatch({ bidMode: d % 2 ? 'score' : 'rob' }, `strength-${d}`);
      E.startHand(m);
      const { result } = runHand(m, levels, d);
      for (let s = 0; s < 3; s++) {
        sum[levels[s]] += result.deltas[s];
        n[levels[s]]++;
      }
      const rec = llWins[levels[result.landlord]];
      rec[0]++;
      if (result.winnerSide === 'landlord') rec[1]++;
    }
  }
  const normalAvg = sum.normal / n.normal;
  const easyAvg = sum.easy / n.easy;
  const msg =
    `normal avg ${normalAvg.toFixed(3)} vs easy avg ${easyAvg.toFixed(3)} per seat-hand over ${DEALS * 6} hands; ` +
    `landlord win rate normal ${((llWins.normal[1] / llWins.normal[0]) * 100).toFixed(1)}%, easy ${((llWins.easy[1] / llWins.easy[0]) * 100).toFixed(1)}%`;
  t.diagnostic(msg);
  console.log(`[doudizhu] ${msg}`);
  assert.ok(normalAvg - easyAvg > 0.5, msg);
  assert.ok(llWins.normal[1] / llWins.normal[0] > llWins.easy[1] / llWins.easy[0]);
});
