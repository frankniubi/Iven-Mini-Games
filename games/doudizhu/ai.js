/**
 * 斗地主 bot. Sees only its own view (own hand + public info) and returns a legal action.
 * - Bidding: hand strength from controls (jokers, 2s, bombs) and how many turns the hand needs.
 * - Play: the hand is decomposed into the fewest turns (engine.rankPlan); a candidate play is scored
 *   by how much it improves what is left, minus the cost of spending control cards, plus tactical
 *   terms (stop an opponent who is nearly out, feed / don't overtake the partner, run out a forced win).
 * - 'easy' ignores structure and partnership; 'hard' adds a sampled perfect-information endgame search.
 */

import {
  rankOf,
  countRanks,
  analyzeAll,
  resolvePlay,
  comboSize,
  isBombType,
  rankPlan,
  rankPlays,
  pickCards,
  subtractRanks,
  hintPlays,
} from './engine.js';

const LEVELS = ['easy', 'normal', 'hard'];
const FULL_DECK = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1];
const PASS = { type: 'pass' };

// Bid thresholds on bidStrength(); the landlord also gets 3 unseen bottom cards.
const BID = { call: 4.5, rob: 7, robFinal: 8, score1: 4, score2: 6, score3: 8 };

/**
 * Choose an action for view.seat. `memory` is a per-seat plain object kept by the host for the hand;
 * opts.level ('easy' | 'normal' | 'hard', default view.settings.botLevel), opts.rng () => [0,1).
 */
export function botAction(view, memory = {}, opts = {}) {
  if (!view || view.seat < 0 || view.turn !== view.seat) return null;
  const level = LEVELS.includes(opts.level) ? opts.level : LEVELS.includes(view.settings?.botLevel) ? view.settings.botLevel : 'normal';
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  const mem = memory && typeof memory === 'object' ? memory : {};
  if (mem.handNo !== view.handNo) {
    for (const k of Object.keys(mem)) delete mem[k];
    mem.handNo = view.handNo;
  }
  if (view.phase === 'bidding') return bidAction(view, level, rng);
  if (view.phase !== 'playing') return null;
  let action = null;
  try {
    action = playAction(view, level, rng);
  } catch (err) {
    action = null;
  }
  return isLegalPlay(view, action) ? action : fallbackPlay(view);
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

/** Rough hand strength: ≈ 6–7 is a fair landlord hand. */
export function bidStrength(cnt) {
  let s = 0;
  if (cnt[13] && cnt[14]) s += 8;
  else s += cnt[14] * 4 + cnt[13] * 3;
  s += cnt[12] * 2;
  for (let r = 0; r < 13; r++) if (cnt[r] === 4) s += r === 12 ? 4 : 5;
  s += cnt[11] * 0.6;
  s -= (rankPlan(cnt).turns - 6) * 0.9;
  return s;
}

function bidAction(view, level, rng) {
  const b = view.bidding;
  const noise = level === 'easy' ? 3.5 : level === 'normal' ? 1 : 0.5;
  let s = bidStrength(countRanks(view.hand)) + (rng() * 2 - 1) * noise;
  if (level === 'easy') s += 1; // easy bots overbid
  // repeated redeals make everyone less picky; the last seat of the round eventually must take it
  const redeals = view.redeals || 0;
  s += Math.min(redeals, 4) * 1.2;
  const lastChance = redeals >= 3 && b.history.length === 2;
  if (view.bidMode === 'score') {
    let want = s >= BID.score3 ? 3 : s >= BID.score2 ? 2 : s >= BID.score1 ? 1 : 0;
    if (lastChance && b.highScore === 0 && want === 0) want = 1;
    return { type: 'bid', score: want > b.highScore ? want : 0 };
  }
  if (b.stage === 'call') return { type: s >= BID.call || lastChance ? 'call' : 'nocall' };
  const threshold = view.seat === b.caller ? BID.robFinal : BID.rob;
  return { type: s >= threshold ? 'rob' : 'norob' };
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function buildCtx(view, level) {
  const me = view.seat;
  const ll = view.landlord;
  const isLL = me === ll;
  const cnt = countRanks(view.hand);
  const out = FULL_DECK.slice();
  for (let r = 0; r < 15; r++) out[r] -= cnt[r];
  for (const id of view.playedCards) out[rankOf(id)]--;
  const enemies = isLL ? [(me + 1) % 3, (me + 2) % 3] : [ll];
  const counts = view.counts;
  const enemyCounts = enemies.map((s) => counts[s]);
  return {
    view,
    level,
    me,
    ll,
    isLL,
    mate: isLL ? -1 : 3 - me - ll,
    enemies,
    counts,
    hand: view.hand,
    cnt,
    total: view.hand.length,
    out,
    maxEnemy: Math.max(...enemyCounts),
    minEnemy: Math.min(...enemyCounts),
  };
}

/** Could cards outstanding (held by others) beat `combo`, using at most maxCards cards? Conservative. */
function threatens(combo, out, maxCards) {
  if (combo.type === 'rocket') return false;
  if (maxCards >= 2 && out[13] && out[14]) return true;
  if (maxCards >= 4) {
    for (let r = 0; r < 13; r++) if (out[r] === 4 && (combo.type !== 'bomb' || r > combo.rank)) return true;
  }
  if (combo.type === 'bomb' || combo.type === 'four2' || combo.type === 'four2pairs') return false;
  if (comboSize(combo) > maxCards) return false;
  const R = combo.rank;
  switch (combo.type) {
    case 'single':
      for (let r = R + 1; r <= 14; r++) if (out[r] >= 1) return true;
      return false;
    case 'pair':
      for (let r = R + 1; r <= 12; r++) if (out[r] >= 2) return true;
      return false;
    case 'trio':
    case 'trio1':
    case 'trio2':
      for (let r = R + 1; r <= 12; r++) if (out[r] >= 3) return true;
      return false;
    default: {
      const need = combo.type === 'straight' ? 1 : combo.type === 'pairStraight' ? 2 : 3;
      const L = combo.length;
      for (let top = R + 1; top <= 11; top++) {
        let ok = top - L + 1 >= 0;
        for (let r = top - L + 1; ok && r <= top; r++) if (out[r] < need) ok = false;
        if (ok) return true;
      }
      return false;
    }
  }
}

function isSafe(ctx, combo) {
  return !threatens(combo, ctx.out, ctx.maxEnemy);
}

function unsafeCount(ctx, plan) {
  let n = 0;
  for (const g of plan.groups) if (!isSafe(ctx, g.combo)) n++;
  return n;
}

function usesBomb(combo) {
  return isBombType(combo) || combo.type === 'four2' || combo.type === 'four2pairs';
}

// Extra cost of spending cards that win tricks (2s, jokers, bombs).
function controlCost(play) {
  const t = play.combo.type;
  if (t === 'rocket') return 16;
  if (t === 'bomb' || t === 'four2' || t === 'four2pairs') return 10 + play.combo.rank * 0.3;
  let c = 0;
  for (const r of play.ranks) c += r === 14 ? 6 : r === 13 ? 5 : r === 12 ? 3 : 0;
  return c;
}

// Plan value (engine.rankPlan) carried by the control cards in a play.
function controlValue(play) {
  const t = play.combo.type;
  if (t === 'rocket') return 20;
  if (t === 'bomb' || t === 'four2' || t === 'four2pairs') return 11 + play.combo.rank * 0.5;
  let v = 0;
  for (const r of play.ranks) v += r >= 12 ? r - 10 : 0;
  return v;
}

function toAction(ctx, ranks) {
  const cards = pickCards(ctx.hand, ranks);
  return cards ? { type: 'play', cards } : null;
}

function isLegalPlay(view, action) {
  if (!action || typeof action !== 'object') return false;
  const last = view.trick.last;
  if (action.type === 'pass') return !!last;
  if (action.type !== 'play' || !Array.isArray(action.cards) || !action.cards.length) return false;
  const inHand = new Set(view.hand);
  if (!action.cards.every((id) => inHand.has(id))) return false;
  return !!resolvePlay(action.cards, last ? last.combo : null);
}

function fallbackPlay(view) {
  const last = view.trick.last;
  if (last) {
    const hint = hintPlays(view.hand, last.combo)[0];
    return hint ? { type: 'play', cards: hint } : PASS;
  }
  return { type: 'play', cards: [view.hand[view.hand.length - 1]] };
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

function playAction(view, level, rng) {
  const ctx = buildCtx(view, level);
  const last = view.trick.last;
  // the whole hand in one go always wins
  if (analyzeAll(ctx.hand).length && (!last || resolvePlay(ctx.hand, last.combo))) {
    return { type: 'play', cards: ctx.hand.slice() };
  }
  if (level === 'easy') return easyPlay(ctx, rng);
  if (level === 'hard') {
    const found = endgameSearch(ctx, rng);
    if (found) return found;
  }
  return last ? chooseFollow(ctx) : chooseLead(ctx);
}

function chooseLead(ctx) {
  const { cnt } = ctx;
  const plan = rankPlan(cnt);
  // forced win: every group but one is unbeatable → play the unbeatable ones first
  const unsafe = plan.groups.filter((g) => !isSafe(ctx, g.combo));
  if (unsafe.length <= 1 && plan.groups.length > 1) {
    const safe = plan.groups.filter((g) => isSafe(ctx, g.combo));
    safe.sort((a, b) => usesBomb(a.combo) - usesBomb(b.combo) || b.ranks.length - a.ranks.length);
    if (safe.length) return toAction(ctx, safe[0].ranks);
  }

  const cands = leadCandidates(cnt, plan);
  let best = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    const sc = scoreLead(ctx, plan, c);
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
    }
  }
  return toAction(ctx, best.ranks);
}

function leadCandidates(cnt, plan) {
  const seen = new Set();
  const out = [];
  const add = (p) => {
    const key = p.ranks.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };
  for (const g of plan.groups) add(g);
  for (const p of rankPlays(cnt, null)) {
    const t = p.combo.type;
    if (t === 'single' || t === 'pair' || t === 'trio' || t === 'trio1' || t === 'trio2') add(p);
  }
  return out;
}

function scoreLead(ctx, plan, c) {
  const combo = c.combo;
  const size = c.ranks.length;
  const after = rankPlan(subtractRanks(ctx.cnt, c.ranks));
  let sc = after.score - plan.score + Math.min(size - 1, 6) * 0.5;
  if (usesBomb(combo)) sc -= 20;
  else if (plan.turns > 2 && isSafe(ctx, combo)) sc -= 2; // keep control for later
  for (const e of ctx.enemies) {
    const n = ctx.counts[e];
    if (n > 4 || size > n || !threatens(combo, ctx.out, n)) continue;
    // an opponent close to going out could answer this: avoid it, or at least lead high
    sc -= size === n || n <= 2 ? 26 - combo.rank * 1.8 : 3;
  }
  if (!ctx.isLL) {
    const m = ctx.counts[ctx.mate];
    if (m === 1 && combo.type === 'single') sc += 12 - combo.rank * 0.6;
    if (m === 2 && combo.type === 'pair') sc += 10 - combo.rank * 0.5;
  }
  return sc;
}

function chooseFollow(ctx) {
  const { view, cnt } = ctx;
  const last = view.trick.last;
  const prev = last.combo;
  const from = last.seat;
  const plays = rankPlays(cnt, prev);
  if (!plays.length) return PASS;
  const plan0 = rankPlan(cnt);
  const fromMate = !ctx.isLL && from === ctx.mate;

  if (fromMate) return followPartner(ctx, plays, plan0, prev);

  const ctrlScale = Math.max(0, Math.min(1, (ctx.minEnemy - 2) / 8));
  const lastDefender = !ctx.isLL && view.trick.actions[ctx.mate] === 'pass';
  const oneCardEnemy = ctx.enemies.some((e) => ctx.counts[e] === 1);
  // passing lets an opponent who is nearly out keep the lead
  const nFrom = ctx.counts[from];
  let danger = nFrom <= 2 ? 16 : nFrom <= 4 ? 10 : nFrom <= 6 ? 4 : 0;
  if (!ctx.isLL && !lastDefender) danger *= 0.6; // partner still gets a say
  let best = PASS;
  let bestScore = -danger;
  for (const p of plays) {
    const after = rankPlan(subtractRanks(cnt, p.ranks));
    let sc = after.score - plan0.score;
    // control cards are worth less the closer an opponent is to going out
    sc += controlValue(p) * (1 - ctrlScale) - controlCost(p) * ctrlScale;
    if (usesBomb(p.combo)) sc -= 3; // doubles the stake
    if (lastDefender) sc += 2;
    for (const e of ctx.enemies) {
      const n = ctx.counts[e];
      if (n <= 2 && !threatens(p.combo, ctx.out, n)) sc += 4;
    }
    if (oneCardEnemy && p.combo.type === 'single') sc += p.combo.rank * 0.3;
    if (isSafe(ctx, p.combo) && unsafeCount(ctx, after) <= 1) sc += 12; // take the lead and run out
    if (sc > bestScore) {
      bestScore = sc;
      best = p;
    }
  }
  return best === PASS ? PASS : toAction(ctx, best.ranks);
}

// Partner is winning the trick: pass unless overtaking lets us run out, or a cheap "顶牌" pushes the landlord.
function followPartner(ctx, plays, plan0, prev) {
  const { view } = ctx;
  for (const p of plays) {
    if (usesBomb(p.combo)) continue;
    const after = rankPlan(subtractRanks(ctx.cnt, p.ranks));
    if (isSafe(ctx, p.combo) && unsafeCount(ctx, after) === 0) return toAction(ctx, p.ranks);
  }
  const landlordNext = (ctx.me + 1) % 3 === ctx.ll;
  const weakLead = (prev.type === 'single' || prev.type === 'pair') && prev.rank <= 6;
  if (landlordNext && weakLead && ctx.counts[ctx.mate] > 2 && ctx.counts[ctx.ll] > 2 && view.trick.leader === ctx.mate) {
    for (const p of plays) {
      const r = p.combo.rank;
      if (r < 8 || r > 11) continue;
      const after = rankPlan(subtractRanks(ctx.cnt, p.ranks));
      if (after.turns < plan0.turns) return toAction(ctx, p.ranks);
    }
  }
  return PASS;
}

// ---------------------------------------------------------------------------
// Easy: no structure, no partnership, random passes
// ---------------------------------------------------------------------------

function easyPlay(ctx, rng) {
  const { view, hand } = ctx;
  const last = view.trick.last;
  if (!last) {
    if (rng() < 0.55) return { type: 'play', cards: [hand[hand.length - 1]] };
    const hints = hintPlays(hand, null);
    return { type: 'play', cards: hints[Math.floor(rng() * Math.min(3, hints.length))] };
  }
  const hints = hintPlays(hand, last.combo);
  if (!hints.length) return PASS;
  if (!ctx.isLL && last.seat === ctx.mate && rng() < 0.5) return PASS;
  const plain = hints.filter((h) => !usesBomb(resolvePlay(h, last.combo)));
  if (plain.length) {
    if (rng() < 0.15) return PASS;
    // weakest by rank only, even if it splits a pair or a straight
    plain.sort((a, b) => resolvePlay(a, last.combo).rank - resolvePlay(b, last.combo).rank);
    return { type: 'play', cards: plain[0] };
  }
  return rng() < 0.3 ? { type: 'play', cards: hints[0] } : PASS;
}

// ---------------------------------------------------------------------------
// Hard: sampled perfect-information endgame search (AND/OR over landlord-wins)
// ---------------------------------------------------------------------------

const SEARCH_MAX_CARDS = 20; // all three hands together
const SEARCH_SAMPLES = 6;
const SEARCH_BUDGET = 40000; // total nodes per decision, split over samples and root moves

function endgameSearch(ctx, rng) {
  const { view } = ctx;
  const counts = view.counts;
  if (counts[0] + counts[1] + counts[2] > SEARCH_MAX_CARDS) return null;
  const last = view.trick.last;
  const prev = last ? last.combo : null;
  const rootMoves = rankPlays(ctx.cnt, prev);
  if (last) rootMoves.push(null); // pass
  if (rootMoves.length <= 1) return null;

  const myWins = new Array(rootMoves.length).fill(0);
  const perMove = Math.max(150, Math.floor(SEARCH_BUDGET / (SEARCH_SAMPLES * rootMoves.length)));
  for (let k = 0; k < SEARCH_SAMPLES; k++) {
    const hands = sampleHands(ctx, rng);
    if (!hands) return null;
    const st = { ll: ctx.ll, nodes: 0, limit: perMove, memo: new Map() };
    for (let i = 0; i < rootMoves.length; i++) {
      st.nodes = 0;
      const state = applySearchMove(hands, ctx.me, last ? { seat: last.seat, combo: prev } : null, rootMoves[i]);
      let v = state.done ? state.winner === ctx.ll : solve(st, state.hands, state.turn, state.last);
      if (v === null) v = 0.5;
      else v = v ? 1 : 0;
      myWins[i] += ctx.isLL ? v : 1 - v;
    }
  }
  let bestI = -1;
  let best = -1;
  for (let i = 0; i < rootMoves.length; i++) {
    if (myWins[i] > best + 1e-9) {
      best = myWins[i];
      bestI = i;
    }
  }
  const worst = Math.min(...myWins);
  if (best - worst < 0.5) return null; // no move clearly better: use the heuristic player
  // prefer the heuristic choice when it is among the best moves
  const normal = last ? chooseFollow(ctx) : chooseLead(ctx);
  const normalKey = normal && normal.type === 'play' ? normal.cards.map(rankOf).sort((a, b) => a - b).join(',') : 'pass';
  for (let i = 0; i < rootMoves.length; i++) {
    const key = rootMoves[i] ? rootMoves[i].ranks.slice().sort((a, b) => a - b).join(',') : 'pass';
    if (key === normalKey && myWins[i] >= best - 1e-9) return normal;
  }
  const m = rootMoves[bestI];
  return m ? toAction(ctx, m.ranks) : PASS;
}

// Deal the outstanding cards to the other two seats (landlord keeps the unplayed bottom cards).
function sampleHands(ctx, rng) {
  const { view } = ctx;
  const hands = [null, null, null];
  hands[ctx.me] = ctx.cnt.slice();
  const pool = [];
  const out = ctx.out.slice();
  const fixed = new Array(15).fill(0);
  if (!ctx.isLL) {
    const played = new Set(view.playedCards);
    for (const id of view.bottom) {
      if (played.has(id)) continue;
      fixed[rankOf(id)]++;
      out[rankOf(id)]--;
    }
  }
  for (let r = 0; r < 15; r++) for (let i = 0; i < out[r]; i++) pool.push(r);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  let idx = 0;
  for (let s = 0; s < 3; s++) {
    if (s === ctx.me) continue;
    const h = s === ctx.ll ? fixed.slice() : new Array(15).fill(0);
    let need = view.counts[s] - h.reduce((a, b) => a + b, 0);
    if (need < 0) return null;
    while (need-- > 0) {
      if (idx >= pool.length) return null;
      h[pool[idx++]]++;
    }
    hands[s] = h;
  }
  return idx === pool.length ? hands : null;
}

function handSize(cnt) {
  let n = 0;
  for (let r = 0; r < 15; r++) n += cnt[r];
  return n;
}

// move: {ranks, combo} or null (pass). last: {seat, combo} or null.
function applySearchMove(hands, seat, last, move) {
  const next = (seat + 1) % 3;
  if (!move) {
    const newLast = next === last.seat ? null : last;
    return { hands, turn: next, last: newLast, done: false };
  }
  const h = subtractRanks(hands[seat], move.ranks);
  const nh = hands.slice();
  nh[seat] = h;
  if (handSize(h) === 0) return { done: true, hands: nh, winner: seat };
  return { hands: nh, turn: next, last: { seat, combo: move.combo }, done: false };
}

// Returns true (landlord side wins), false (farmers win) or null (budget exhausted).
function solve(st, hands, turn, last) {
  if (st.nodes++ > st.limit) return null;
  const key = `${hands.map(codeOf).join(',')}|${turn}|${last ? `${last.seat}${last.combo.type}${last.combo.rank}.${last.combo.length}` : '-'}`;
  const memo = st.memo.get(key);
  if (memo !== undefined) return memo;
  const isLLTurn = turn === st.ll;
  const cnt = hands[turn];
  const total = handSize(cnt);
  const moves = rankPlays(cnt, last ? last.combo : null);
  // try hand-emptying moves first, then larger plays; pass last
  moves.sort((a, b) => (b.ranks.length === total) - (a.ranks.length === total) || b.ranks.length - a.ranks.length);
  if (last) moves.push(null);
  let sawUnknown = false;
  let result = !isLLTurn; // OR for landlord (default false), AND for farmers (default true)
  for (const m of moves) {
    let v;
    if (m && m.ranks.length === total) v = isLLTurn;
    else {
      const s = applySearchMove(hands, turn, last, m);
      v = solve(st, s.hands, s.turn, s.last);
    }
    if (v === null) {
      sawUnknown = true;
      continue;
    }
    if (isLLTurn && v) {
      result = true;
      sawUnknown = false;
      break;
    }
    if (!isLLTurn && !v) {
      result = false;
      sawUnknown = false;
      break;
    }
  }
  if (sawUnknown) return null;
  st.memo.set(key, result);
  return result;
}

function codeOf(cnt) {
  let key = 0;
  for (let r = 14; r >= 0; r--) key = key * 5 + cnt[r];
  return key;
}
