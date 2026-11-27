/**
 * 斗地主 (Dou Di Zhu) rules engine, classic 欢乐斗地主 rules.
 * Cards are ints 0..53: rank = id >> 2 for id < 52 (0..12 = 3..A,2), suit = id % 4 (♠♥♣♦); 52 小王, 53 大王.
 * Pure logic (no DOM, no timers). A match is plain JSON including its PRNG state, so a serialized
 * match resumes identically. Views returned by getView() never contain another seat's hidden cards.
 */

export const GAME_ID = 'doudizhu';
export const SEATS = 3;
export const BID_MODES = ['rob', 'score'];
export const BOT_LEVELS = ['easy', 'normal', 'hard'];
export const RANK_LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'];

const SUIT_SYMBOLS = ['♠', '♥', '♣', '♦'];

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export function rankOf(id) {
  return id < 52 ? id >> 2 : id - 39;
}

export function suitOf(id) {
  return id < 52 ? id % 4 : -1;
}

/** Display order: descending rank, then suit ♠♥♣♦. */
export function sortCards(ids) {
  return ids.slice().sort((a, b) => rankOf(b) - rankOf(a) || suitOf(a) - suitOf(b));
}

export function cardText(id) {
  if (id === 52) return '小王';
  if (id === 53) return '大王';
  return SUIT_SYMBOLS[id % 4] + RANK_LABELS[id >> 2];
}

/** Rank histogram (length 15) of a card list. */
export function countRanks(ids) {
  const cnt = new Array(15).fill(0);
  for (const id of ids) cnt[rankOf(id)]++;
  return cnt;
}

function isCardList(ids) {
  if (!Array.isArray(ids)) return false;
  const seen = new Set();
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 0 || id > 53 || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------

const COMBO_NAMES = {
  single: '单张',
  pair: '对子',
  trio: '三张',
  trio1: '三带一',
  trio2: '三带二',
  straight: '顺子',
  pairStraight: '连对',
  plane: '飞机',
  plane1: '飞机带翅膀',
  plane2: '飞机带翅膀',
  four2: '四带二',
  four2pairs: '四带两对',
  bomb: '炸弹',
  rocket: '王炸',
};

// wings: 0 none, 1 single cards, 2 pairs
const WING_KIND = { trio1: 1, trio2: 2, plane1: 1, plane2: 2, four2: 1, four2pairs: 2 };

export function makeCombo(type, rank, length = 1) {
  return { type, rank, length, wings: WING_KIND[type] || 0, name: COMBO_NAMES[type] };
}

/** Number of cards a combo consists of. */
export function comboSize(combo) {
  const L = combo.length;
  switch (combo.type) {
    case 'single': return 1;
    case 'pair': case 'rocket': return 2;
    case 'trio': return 3;
    case 'trio1': case 'bomb': return 4;
    case 'trio2': return 5;
    case 'straight': return L;
    case 'pairStraight': return 2 * L;
    case 'plane': return 3 * L;
    case 'plane1': return 4 * L;
    case 'plane2': return 5 * L;
    case 'four2': return 6;
    case 'four2pairs': return 8;
    default: return 0;
  }
}

export function isBombType(combo) {
  return !!combo && (combo.type === 'bomb' || combo.type === 'rocket');
}

/** Every valid interpretation of a rank histogram holding n cards. */
export function analyzeCounts(cnt, n) {
  const out = [];
  if (!(n > 0)) return out;
  let distinct = 0;
  let maxC = 0;
  let lo = -1;
  let hi = -1;
  for (let r = 0; r < 15; r++) {
    const c = cnt[r];
    if (!c) continue;
    distinct++;
    if (c > maxC) maxC = c;
    if (lo < 0) lo = r;
    hi = r;
  }
  // every present rank has exactly k cards, ranks are consecutive and stop at A
  const uniformRun = (k) => {
    if (hi > 11 || hi - lo + 1 !== distinct) return false;
    for (let r = lo; r <= hi; r++) if (cnt[r] !== k) return false;
    return true;
  };
  if (n === 1) out.push(makeCombo('single', lo));
  else if (n === 2) {
    if (cnt[13] && cnt[14]) out.push(makeCombo('rocket', 14));
    else if (distinct === 1) out.push(makeCombo('pair', lo));
  } else if (n === 3) {
    if (distinct === 1) out.push(makeCombo('trio', lo));
  } else if (n === 4) {
    if (distinct === 1) out.push(makeCombo('bomb', lo));
    else if (maxC === 3) out.push(makeCombo('trio1', cnt.indexOf(3)));
  } else if (n === 5 && distinct === 2 && maxC === 3) {
    out.push(makeCombo('trio2', cnt.indexOf(3)));
  }
  if (n >= 5 && maxC === 1 && uniformRun(1)) out.push(makeCombo('straight', hi, n));
  if (n >= 6 && n % 2 === 0 && maxC === 2 && uniformRun(2)) out.push(makeCombo('pairStraight', hi, n / 2));
  if (n >= 6 && n % 3 === 0 && maxC === 3 && uniformRun(3)) out.push(makeCombo('plane', hi, n / 3));
  if (n >= 8 && n % 4 === 0) planesWithWings(cnt, n / 4, 1, out);
  if (n >= 10 && n % 5 === 0) planesWithWings(cnt, n / 5, 2, out);
  if (n === 6 || n === 8) {
    for (let r = 0; r < 13; r++) {
      if (cnt[r] !== 4) continue;
      if (n === 6 && !(cnt[13] && cnt[14])) out.push(makeCombo('four2', r));
      if (n === 8 && evenRest(cnt, r, 4, 0)) out.push(makeCombo('four2pairs', r));
    }
  }
  return out;
}

// True when, after removing `take` cards from each rank in [from, from+len), every rank count is even and no jokers remain.
function evenRest(cnt, from, take, len) {
  if (cnt[13] || cnt[14]) return false;
  const end = len ? from + len : from + 1;
  for (let r = 0; r < 13; r++) {
    const rest = cnt[r] - (r >= from && r < end ? (len ? 3 : take) : 0);
    if (rest % 2) return false;
  }
  return true;
}

function planesWithWings(cnt, k, kind, out) {
  for (let s = 0; s + k - 1 <= 11; s++) {
    let ok = true;
    for (let r = s; r < s + k; r++) {
      if (cnt[r] < 3) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (kind === 1) {
      // exactly k loose cards remain (n = 4k); they may not be both jokers
      if (!(cnt[13] && cnt[14])) out.push(makeCombo('plane1', s + k - 1, k));
    } else if (evenRest(cnt, s, 3, k)) {
      out.push(makeCombo('plane2', s + k - 1, k));
    }
  }
}

// Preferred reading when leading: rocket > bomb > longest plane > others (highest rank).
function leadPreference(c) {
  if (c.type === 'rocket') return 4e6;
  if (c.type === 'bomb') return 3e6 + c.rank;
  if (c.type === 'plane' || c.type === 'plane1' || c.type === 'plane2') return 2e6 + c.length * 100 + c.rank;
  return c.rank;
}

function pickPreferred(list) {
  let best = null;
  for (const c of list) if (!best || leadPreference(c) > leadPreference(best)) best = c;
  return best;
}

/** Every valid interpretation of a set of cards ([] when invalid). */
export function analyzeAll(ids) {
  if (!isCardList(ids) || !ids.length) return [];
  return analyzeCounts(countRanks(ids), ids.length);
}

/** Preferred interpretation (as when leading), or null when the cards are not a legal combo. */
export function analyzeCards(ids) {
  return pickPreferred(analyzeAll(ids));
}

export function canBeat(combo, prevCombo) {
  if (!combo) return false;
  if (!prevCombo) return true;
  if (combo.type === 'rocket') return prevCombo.type !== 'rocket';
  if (prevCombo.type === 'rocket') return false;
  if (combo.type === 'bomb') return prevCombo.type !== 'bomb' || combo.rank > prevCombo.rank;
  if (prevCombo.type === 'bomb') return false;
  return combo.type === prevCombo.type && combo.length === prevCombo.length && combo.rank > prevCombo.rank;
}

/** The interpretation of `ids` the engine records when they are played on `prevCombo` (null = illegal). */
export function resolvePlay(ids, prevCombo) {
  const all = analyzeAll(ids);
  if (!prevCombo) return pickPreferred(all);
  const ok = all.filter((c) => canBeat(c, prevCombo));
  const same = ok.filter((c) => c.type === prevCombo.type);
  return pickPreferred(same.length ? same : ok);
}

// ---------------------------------------------------------------------------
// Play enumeration (rank level). A play is { ranks: [r…], combo }.
// ---------------------------------------------------------------------------

const CHAIN_NEED = { straight: 1, pairStraight: 2, plane: 3, plane1: 3, plane2: 3 };
const CHAIN_MIN = { straight: 5, pairStraight: 3, plane: 2, plane1: 2, plane2: 2 };
const LEAD_TYPES = ['single', 'pair', 'trio', 'trio1', 'trio2', 'straight', 'pairStraight', 'plane', 'plane1', 'plane2', 'four2', 'four2pairs', 'bomb', 'rocket'];

/** cnt minus the given ranks (new array). */
export function subtractRanks(cnt, ranks) {
  const out = cnt.slice();
  for (const r of ranks) out[r]--;
  return out;
}

// Up to two wing choices: structure-friendly (loose cards first) and lowest-rank.
function wingSets(cnt, body, k, kind) {
  const units = [];
  for (let r = 0; r < 15; r++) {
    const c = cnt[r];
    if (!c || body.includes(r)) continue;
    if (kind === 1) {
      const p = c === 4 ? 200 + r : r >= 13 ? 150 + r : r === 12 ? 100 + c : (c - 1) * 20 + r;
      const q = c === 4 ? 200 + r : r;
      for (let i = 0; i < c; i++) units.push({ r, p, q });
    } else {
      if (r > 12 || c < 2) continue;
      const p = c === 4 ? 200 + r : r === 12 ? 100 + c : (c - 2) * 20 + r;
      const q = c === 4 ? 200 + r : r;
      units.push({ r, p, q });
      if (c === 4) units.push({ r, p, q });
    }
  }
  const pick = (key) => {
    const sorted = units.slice().sort((a, b) => a[key] - b[key] || a.r - b.r);
    const res = [];
    let jokers = 0;
    for (const u of sorted) {
      if (res.length === k) break;
      if (u.r >= 13 && ++jokers > 1) continue;
      res.push(u.r);
    }
    if (res.length < k) return null;
    return kind === 1 ? res : res.flatMap((r) => [r, r]);
  };
  const out = [];
  const a = pick('p');
  const b = pick('q');
  if (a) out.push(a);
  if (b && (!a || b.join() !== a.join())) out.push(b);
  return out;
}

function playsOfType(cnt, type, length, above, out) {
  const push = (ranks, rank, len = 1) => out.push({ ranks, combo: makeCombo(type, rank, len) });
  switch (type) {
    case 'single':
      for (let r = above + 1; r <= 14; r++) if (cnt[r] >= 1) push([r], r);
      break;
    case 'pair':
      for (let r = above + 1; r <= 12; r++) if (cnt[r] >= 2) push([r, r], r);
      break;
    case 'trio':
      for (let r = above + 1; r <= 12; r++) if (cnt[r] >= 3) push([r, r, r], r);
      break;
    case 'trio1':
    case 'trio2':
      for (let r = above + 1; r <= 12; r++) {
        if (cnt[r] < 3) continue;
        for (const w of wingSets(cnt, [r], 1, type === 'trio1' ? 1 : 2)) push([r, r, r, ...w], r);
      }
      break;
    case 'straight':
    case 'pairStraight':
    case 'plane':
    case 'plane1':
    case 'plane2': {
      const need = CHAIN_NEED[type];
      if (length < CHAIN_MIN[type]) break;
      for (let top = Math.max(above + 1, length - 1); top <= 11; top++) {
        const s = top - length + 1;
        let ok = true;
        for (let r = s; r <= top; r++) {
          if (cnt[r] < need) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const body = [];
        const run = [];
        for (let r = s; r <= top; r++) {
          run.push(r);
          for (let i = 0; i < need; i++) body.push(r);
        }
        if (type === 'plane1' || type === 'plane2') {
          for (const w of wingSets(cnt, run, length, type === 'plane1' ? 1 : 2)) push(body.concat(w), top, length);
        } else {
          push(body, top, length);
        }
      }
      break;
    }
    case 'four2':
    case 'four2pairs':
      for (let r = above + 1; r <= 12; r++) {
        if (cnt[r] !== 4) continue;
        for (const w of wingSets(cnt, [r], 2, type === 'four2' ? 1 : 2)) push([r, r, r, r, ...w], r);
      }
      break;
    case 'bomb':
      for (let r = above + 1; r <= 12; r++) if (cnt[r] === 4) push([r, r, r, r], r);
      break;
    case 'rocket':
      if (cnt[13] && cnt[14] && above < 14) push([13, 14], 14);
      break;
    default:
  }
}

/** All leads (prev null) or all plays beating prevCombo, at rank level. */
export function rankPlays(cnt, prevCombo = null) {
  const out = [];
  if (!prevCombo) {
    for (const type of LEAD_TYPES) {
      if (CHAIN_NEED[type]) {
        const per = comboSize(makeCombo(type, 0, 1));
        for (let L = CHAIN_MIN[type]; L * per <= 20 && L <= 12; L++) playsOfType(cnt, type, L, -1, out);
      } else {
        playsOfType(cnt, type, 1, -1, out);
      }
    }
    return out;
  }
  const t = prevCombo.type;
  if (t !== 'bomb' && t !== 'rocket') playsOfType(cnt, t, prevCombo.length, prevCombo.rank, out);
  if (t !== 'rocket') playsOfType(cnt, 'bomb', 1, t === 'bomb' ? prevCombo.rank : -1, out);
  playsOfType(cnt, 'rocket', 1, -1, out);
  return out;
}

/** Map a rank multiset onto concrete card ids from `hand` (null if impossible). */
export function pickCards(hand, ranks) {
  const used = new Set();
  const out = [];
  for (const r of ranks) {
    const id = hand.find((x) => rankOf(x) === r && !used.has(x));
    if (id === undefined) return null;
    used.add(id);
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hand decomposition: fewest turns, weakest groups. Shared by hints and the bot.
// ---------------------------------------------------------------------------

export const TURN_COST = 7;
const NODE_BUDGET = 2500;
const planCache = new Map();

function rankValue(r) {
  return r - 10; // 3 → -10 … K → 0, A 1, 2 2, 小王 3, 大王 4
}

function planGroup(type, rank, length, ranks, value) {
  return { combo: makeCombo(type, rank, length), ranks, value };
}

/**
 * Best decomposition of a rank histogram: { score, turns, groups:[{combo, ranks, value}] }.
 * score = Σ group value − TURN_COST × turns. Rocket and bombs stay whole; chains are searched,
 * leftovers become trios/pairs/singles and trios take the lowest loose singles or pairs as wings.
 * Results are cached and shared: treat them as read-only.
 */
export function rankPlan(cnt) {
  let key = 0;
  for (let r = 14; r >= 0; r--) key = key * 5 + cnt[r];
  let plan = planCache.get(key);
  if (!plan) {
    plan = buildPlan(cnt);
    if (planCache.size >= 200000) planCache.clear();
    planCache.set(key, plan);
  }
  return plan;
}

/** Card-level decomposition of a hand (handy for auto-arranging): [{cards, combo}]. */
export function planHand(hand) {
  if (!isCardList(hand)) return [];
  return rankPlan(countRanks(hand)).groups.map((g) => ({ cards: pickCards(hand, g.ranks), combo: g.combo }));
}

function buildPlan(cnt0) {
  const cnt = cnt0.slice(0, 15);
  const fixed = [];
  if (cnt[13] && cnt[14]) {
    fixed.push(planGroup('rocket', 14, 1, [13, 14], 20));
    cnt[13] = 0;
    cnt[14] = 0;
  }
  for (let r = 0; r < 13; r++) {
    if (cnt[r] === 4) {
      fixed.push(planGroup('bomb', r, 1, [r, r, r, r], 11 + r * 0.5));
      cnt[r] = 0;
    }
  }
  const st = { nodes: 0, chains: [], bestScore: -Infinity, bestChains: [], bestCnt: cnt.slice() };
  searchChains(cnt, 0, st);
  const rest = settle(st.bestCnt, st.bestChains, true);
  let score = rest.score;
  for (const g of fixed) score += g.value - TURN_COST;
  return { score, turns: rest.turns + fixed.length, groups: rest.groups.concat(fixed) };
}

function searchChains(cnt, minIdx, st) {
  st.nodes++;
  const v = settle(cnt, st.chains, false).score;
  if (v > st.bestScore) {
    st.bestScore = v;
    st.bestChains = st.chains.slice();
    st.bestCnt = cnt.slice();
  }
  if (st.nodes >= NODE_BUDGET) return;
  for (let kind = 1; kind <= 3; kind++) {
    const minLen = kind === 1 ? 5 : kind === 2 ? 3 : 2;
    for (let s = 0; s + minLen <= 12; s++) {
      if (cnt[s] < kind) continue;
      let e = s;
      while (e <= 11 && cnt[e] >= kind) e++;
      for (let L = minLen; s + L <= e; L++) {
        const idx = (kind * 12 + s) * 13 + L;
        if (idx < minIdx) continue;
        for (let r = s; r < s + L; r++) cnt[r] -= kind;
        st.chains.push({ kind, s, L });
        searchChains(cnt, idx, st);
        st.chains.pop();
        for (let r = s; r < s + L; r++) cnt[r] += kind;
      }
    }
  }
}

// Score chains + leftovers (with wings attached). Builds group objects only when asked.
function settle(cnt, chains, build) {
  let score = 0;
  let turns = 0;
  const groups = build ? [] : null;
  const carriers = [];
  for (const ch of chains) {
    const top = ch.s + ch.L - 1;
    score += rankValue(top) + 1;
    turns++;
    if (ch.kind === 3) carriers.push({ s: ch.s, L: ch.L, value: rankValue(top) + 1 });
    else if (build) {
      const ranks = [];
      for (let r = ch.s; r <= top; r++) for (let i = 0; i < ch.kind; i++) ranks.push(r);
      groups.push(planGroup(ch.kind === 1 ? 'straight' : 'pairStraight', top, ch.L, ranks, rankValue(top) + 1));
    }
  }
  const singles = [];
  const pairs = [];
  for (let r = 0; r < 15; r++) {
    const c = cnt[r];
    if (!c) continue;
    score += rankValue(r);
    turns++;
    if (c === 3) carriers.push({ s: r, L: 0, value: rankValue(r) });
    else if (c === 2) pairs.push(r);
    else singles.push(r);
  }
  // wings: lowest loose singles or pairs (never 2s or jokers) go to planes first, then trios low to high
  const ws = singles.filter((r) => r <= 11);
  const wp = pairs.filter((r) => r <= 11);
  const usedS = new Set();
  const usedP = new Set();
  let si = 0;
  let pi = 0;
  for (const c of carriers) {
    const need = c.L || 1;
    const sOK = ws.length - si >= need;
    const pOK = wp.length - pi >= need;
    let wings = null;
    let kind = 0;
    if (sOK && (!pOK || ws[si + need - 1] <= wp[pi + need - 1])) {
      wings = ws.slice(si, si + need);
      si += need;
      kind = 1;
      for (const r of wings) usedS.add(r);
    } else if (pOK) {
      wings = wp.slice(pi, pi + need);
      pi += need;
      kind = 2;
      for (const r of wings) usedP.add(r);
    }
    if (wings) {
      for (const r of wings) score -= rankValue(r);
      turns -= need;
    }
    if (build) {
      const ranks = [];
      const top = c.L ? c.s + c.L - 1 : c.s;
      for (let r = c.s; r <= top; r++) ranks.push(r, r, r);
      if (wings) for (const r of wings) kind === 1 ? ranks.push(r) : ranks.push(r, r);
      const base = c.L ? 'plane' : 'trio';
      const type = kind ? base + kind : base;
      groups.push(planGroup(type, top, c.L || 1, ranks, c.value));
    }
  }
  if (build) {
    for (const r of pairs) if (!usedP.has(r)) groups.push(planGroup('pair', r, 1, [r, r], rankValue(r)));
    for (const r of singles) if (!usedS.has(r)) groups.push(planGroup('single', r, 1, [r], rankValue(r)));
  }
  return { score: score - TURN_COST * turns, turns, groups };
}

// ---------------------------------------------------------------------------
// Hints (提示)
// ---------------------------------------------------------------------------

function heaviness(combo) {
  if (combo.type === 'rocket') return 3;
  if (combo.type === 'bomb') return 2;
  if (combo.type === 'four2' || combo.type === 'four2pairs') return 1;
  return 0;
}

/**
 * Suggested plays (card id arrays) beating prevCombo, or good leads when prevCombo is null.
 * Weakest first; plays that keep pairs/trios/chains intact come before ones that break them;
 * bombs and the rocket come last.
 */
export function hintPlays(hand, prevCombo = null) {
  if (!isCardList(hand) || !hand.length) return [];
  const cnt = countRanks(hand);
  const items = [];
  let whole = null;
  if (!prevCombo) {
    const all = analyzeCounts(cnt, hand.length);
    if (all.length) whole = hand.slice();
    for (const g of rankPlan(cnt).groups) items.push({ ranks: g.ranks, combo: g.combo, tier: 0 });
  } else {
    const base = rankPlan(cnt).turns;
    for (const p of rankPlays(cnt, prevCombo)) {
      const after = rankPlan(subtractRanks(cnt, p.ranks)).turns;
      items.push({ ranks: p.ranks, combo: p.combo, tier: after >= base ? 1 : 0 });
    }
  }
  const wingSum = (it) => it.ranks.reduce((a, r) => a + r, 0);
  items.sort(
    (a, b) =>
      heaviness(a.combo) - heaviness(b.combo) ||
      a.tier - b.tier ||
      a.combo.rank - b.combo.rank ||
      b.ranks.length - a.ranks.length ||
      wingSum(a) - wingSum(b),
  );
  const out = [];
  const seen = new Set();
  const add = (cards) => {
    if (!cards) return;
    const key = cards.slice().sort((x, y) => x - y).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(sortCards(cards));
  };
  if (whole) add(whole);
  for (const it of items) add(pickCards(hand, it.ranks));
  return out;
}

// ---------------------------------------------------------------------------
// Match state machine
// ---------------------------------------------------------------------------

export function defaultSettings() {
  return { bidMode: 'rob', baseScore: 1, botLevel: 'normal' };
}

function normalizeSettings(settings) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const out = { ...defaultSettings(), ...src };
  if (!BID_MODES.includes(out.bidMode)) out.bidMode = 'rob';
  if (!(Number.isFinite(out.baseScore) && out.baseScore > 0)) out.baseScore = 1;
  if (!BOT_LEVELS.includes(out.botLevel)) out.botLevel = 'normal';
  return out;
}

function hashSeed(seed) {
  const str = seed === undefined || seed === null ? `${Math.random()}:${Date.now()}` : String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32; the state lives in match.rng so a JSON round-trip resumes the same sequence
function nextRandom(match) {
  let t = (match.rng = (match.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function freshBidding(mode) {
  return {
    stage: mode === 'score' ? 'score' : 'call',
    history: [],
    candidate: -1,
    highScore: 0,
    caller: -1,
    refused: [false, false, false],
    queue: [],
    robbed: false,
    final: false,
    bids: 0,
  };
}

function freshTrick(leader) {
  return { leader, last: null, actions: [null, null, null] };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function createMatch(settings, seed) {
  return {
    game: GAME_ID,
    version: 1,
    settings: normalizeSettings(settings),
    rng: hashSeed(seed),
    scores: [0, 0, 0],
    handNo: 0,
    seq: 0,
    phase: 'idle',
    hands: [[], [], []],
    bottom: [],
    firstBidder: -1,
    landlord: -1,
    turn: -1,
    multiplier: 1,
    redeals: 0,
    bidding: freshBidding('rob'),
    trick: freshTrick(-1),
    playedCards: [],
    playedBy: [[], [], []],
    playCounts: [0, 0, 0],
    bombsPlayed: 0,
    result: null,
  };
}

function deal(match, firstBidder) {
  const deck = [];
  for (let i = 0; i < 54; i++) deck.push(i);
  for (let i = 53; i > 0; i--) {
    const j = Math.floor(nextRandom(match) * (i + 1));
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
  match.hands = [sortCards(deck.slice(0, 17)), sortCards(deck.slice(17, 34)), sortCards(deck.slice(34, 51))];
  match.bottom = sortCards(deck.slice(51));
  match.firstBidder = firstBidder;
  match.turn = firstBidder;
  match.landlord = -1;
  match.multiplier = 1;
  match.bidding = freshBidding(match.settings.bidMode);
  match.trick = freshTrick(-1);
  match.playedCards = [];
  match.playedBy = [[], [], []];
  match.playCounts = [0, 0, 0];
  match.bombsPlayed = 0;
  match.result = null;
  match.phase = 'bidding';
}

/** Shuffle and deal a new hand; a random (seeded) seat bids first. Abandons any hand in progress. */
export function startHand(match) {
  match.handNo += 1;
  match.redeals = 0;
  match.seq += 1;
  deal(match, Math.floor(nextRandom(match) * 3));
  return match;
}

export function isHandOver(match) {
  return match.phase === 'over';
}

export function getPendingSeats(match) {
  if ((match.phase === 'bidding' || match.phase === 'playing') && match.turn >= 0) return [match.turn];
  return [];
}

export function getLegalActions(match, seat) {
  if (!getPendingSeats(match).includes(seat)) return null;
  if (match.phase === 'bidding') {
    const b = match.bidding;
    if (match.settings.bidMode === 'score') {
      const bid = [{ type: 'bid', score: 0 }];
      for (let s = b.highScore + 1; s <= 3; s++) bid.push({ type: 'bid', score: s });
      return { bid };
    }
    if (b.stage === 'call') return { bid: [{ type: 'call' }, { type: 'nocall' }] };
    return { bid: [{ type: 'rob' }, { type: 'norob' }], final: b.final };
  }
  const last = match.trick.last;
  return { canPass: !!last, mustLead: !last, prev: last ? clone(last.combo) : null };
}

function fail(error) {
  return { ok: false, error };
}

/**
 * Apply one action for `seat`. Returns { ok:true, events } or { ok:false, error } (match untouched).
 * Bidding: {type:'call'|'nocall'|'rob'|'norob'} or {type:'bid', score}. Play: {type:'play', cards, as?}
 * (`as` optionally picks the combo type when leading ambiguous cards) or {type:'pass'}.
 */
export function applyAction(match, seat, action) {
  try {
    if (!match || typeof match !== 'object' || !Array.isArray(match.hands)) return fail('对局不存在');
    if (match.phase === 'over') return fail('本局已结束');
    if (match.phase !== 'bidding' && match.phase !== 'playing') return fail('对局尚未开始');
    if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) return fail('座位无效');
    if (seat !== match.turn) return fail('还没轮到你');
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') return fail('无效操作');
    const events = [];
    const error = match.phase === 'bidding' ? applyBid(match, seat, action, events) : applyPlay(match, seat, action, events);
    if (error) return fail(error);
    match.seq += 1;
    return { ok: true, events };
  } catch (err) {
    return fail('无效操作');
  }
}

// Validation happens before any mutation; a returned string is the error.
function applyBid(match, seat, action, events) {
  const b = match.bidding;
  const type = action.type;
  const record = (act) => {
    b.history.push({ seat, action: act });
    events.push({ e: 'bid', seat, action: { ...act }, multiplier: match.multiplier });
  };

  if (match.settings.bidMode === 'score') {
    if (type !== 'bid') return '请选择叫分（不叫选 0 分）';
    const score = action.score;
    if (!Number.isInteger(score) || score < 0 || score > 3) return '叫分只能是 0~3 分';
    if (score > 0 && score <= b.highScore) return `叫分必须高于 ${b.highScore} 分`;
    b.bids += 1;
    if (score > 0) {
      b.highScore = score;
      b.candidate = seat;
      match.multiplier = score;
    }
    record({ type: 'bid', score });
    if (score === 3) return settleLandlord(match, seat, events);
    if (b.bids >= SEATS) {
      if (b.highScore > 0) return settleLandlord(match, b.candidate, events);
      return redeal(match, events);
    }
    match.turn = (seat + 1) % SEATS;
    return null;
  }

  if (b.stage === 'call') {
    if (type !== 'call' && type !== 'nocall') return '请选择叫地主或不叫';
    if (type === 'call') {
      b.caller = seat;
      b.candidate = seat;
      match.multiplier = 1;
      record({ type: 'call' });
      // everyone after the caller who has not refused gets one chance to rob
      b.queue = [];
      for (let i = 1; i < SEATS; i++) {
        const s = (seat + i) % SEATS;
        if (!b.refused[s]) b.queue.push(s);
      }
      if (!b.queue.length) return settleLandlord(match, seat, events);
      b.stage = 'rob';
      match.turn = b.queue[0];
      return null;
    }
    b.refused[seat] = true;
    record({ type: 'nocall' });
    const next = (seat + 1) % SEATS;
    if (next === match.firstBidder) return redeal(match, events);
    match.turn = next;
    return null;
  }

  if (b.stage === 'rob') {
    if (type !== 'rob' && type !== 'norob') return '请选择抢地主或不抢';
    if (type === 'rob') {
      match.multiplier *= 2;
      b.robbed = true;
      b.candidate = seat;
    }
    record({ type });
    if (b.final) return settleLandlord(match, b.candidate, events);
    b.queue.shift();
    if (b.queue.length) {
      match.turn = b.queue[0];
      return null;
    }
    if (b.robbed) {
      b.final = true; // the original caller gets the last word
      match.turn = b.caller;
      return null;
    }
    return settleLandlord(match, b.caller, events);
  }
  return '当前不能叫地主';
}

function redeal(match, events) {
  const first = (match.firstBidder + 1) % SEATS;
  match.redeals += 1;
  deal(match, first);
  events.push({ e: 'redeal', firstBidder: first });
  return null;
}

function settleLandlord(match, seat, events) {
  const b = match.bidding;
  match.landlord = seat;
  b.stage = 'done';
  b.candidate = seat;
  b.queue = [];
  if (match.settings.bidMode === 'score') match.multiplier = b.highScore;
  match.hands[seat] = sortCards(match.hands[seat].concat(match.bottom));
  match.phase = 'playing';
  match.turn = seat;
  match.trick = freshTrick(seat);
  events.push({ e: 'landlord', seat, bottom: match.bottom.slice(), multiplier: match.multiplier });
  return null;
}

function applyPlay(match, seat, action, events) {
  const trick = match.trick;
  if (action.type === 'pass') {
    if (!trick.last) return '你是首家，必须出牌';
    trick.actions[seat] = 'pass';
    events.push({ e: 'pass', seat });
    const next = (seat + 1) % SEATS;
    if (next === trick.last.seat) {
      match.trick = freshTrick(next);
      events.push({ e: 'trickWon', seat: next });
    }
    match.turn = next;
    return null;
  }
  if (action.type !== 'play') return '无效操作';
  const cards = action.cards;
  if (!Array.isArray(cards) || !cards.length) return '请选择要出的牌';
  if (!isCardList(cards)) return '牌面无效';
  const hand = match.hands[seat];
  const inHand = new Set(hand);
  if (!cards.every((id) => inHand.has(id))) return '你没有这些牌';
  const all = analyzeAll(cards);
  if (!all.length) return '不符合出牌规则';
  let combo;
  if (!trick.last) {
    const wanted = typeof action.as === 'string' ? all.filter((c) => c.type === action.as) : all;
    if (!wanted.length) return '这手牌不能按所选牌型出';
    combo = pickPreferred(wanted);
  } else {
    const prev = trick.last.combo;
    combo = resolvePlay(cards, prev);
    if (!combo) {
      const sameShape = all.some((c) => c.type === prev.type && c.length === prev.length);
      return sameShape ? '牌太小，管不上' : `牌型不符，请出更大的${prev.name}或炸弹`;
    }
  }

  const sorted = sortCards(cards);
  const played = new Set(cards);
  match.hands[seat] = hand.filter((id) => !played.has(id));
  match.playedCards.push(...sorted);
  match.playedBy[seat].push(...sorted);
  match.playCounts[seat] += 1;
  if (isBombType(combo)) {
    match.bombsPlayed += 1;
    match.multiplier *= 2;
  }
  trick.last = { seat, cards: sorted.slice(), combo: { ...combo } };
  trick.actions[seat] = { cards: sorted.slice(), combo: { ...combo } };
  events.push({ e: 'play', seat, cards: sorted, combo: { ...combo }, left: match.hands[seat].length, multiplier: match.multiplier });
  if (!match.hands[seat].length) return finishHand(match, seat, events);
  match.turn = (seat + 1) % SEATS;
  return null;
}

function finishHand(match, winner, events) {
  const ll = match.landlord;
  const landlordWins = winner === ll;
  let spring = false;
  let antiSpring = false;
  if (landlordWins) spring = match.playCounts.every((n, s) => s === ll || n === 0);
  else antiSpring = match.playCounts[ll] === 1;
  if (spring || antiSpring) match.multiplier *= 2;
  const unit = match.settings.baseScore * match.multiplier;
  const deltas = [0, 1, 2].map((s) => {
    if (s === ll) return (landlordWins ? 2 : -2) * unit;
    return (landlordWins ? -1 : 1) * unit;
  });
  for (let s = 0; s < SEATS; s++) match.scores[s] += deltas[s];
  match.result = {
    winnerSide: landlordWins ? 'landlord' : 'farmers',
    winner,
    landlord: ll,
    spring,
    antiSpring,
    multiplier: match.multiplier,
    baseScore: match.settings.baseScore,
    bombs: match.bombsPlayed,
    deltas,
    hands: match.hands.map((h) => h.slice()),
  };
  match.phase = 'over';
  match.turn = -1;
  events.push({ e: 'handOver', result: clone(match.result) });
  return null;
}

/**
 * Personalized, JSON-compact view for `seat` (-1 = spectator). Before the hand is over the only
 * non-public cards in it are `hand`, and only the viewer's own.
 */
export function getView(match, seat) {
  const s = Number.isInteger(seat) && seat >= 0 && seat < SEATS ? seat : -1;
  const b = match.bidding;
  return {
    game: GAME_ID,
    seat: s,
    handNo: match.handNo,
    phase: match.phase,
    hand: s >= 0 ? match.hands[s].slice() : [],
    counts: match.hands.map((h) => h.length),
    turn: match.turn,
    firstBidder: match.firstBidder,
    landlord: match.landlord,
    bottom: match.landlord >= 0 ? match.bottom.slice() : [],
    bidMode: match.settings.bidMode,
    multiplier: match.multiplier,
    baseScore: match.settings.baseScore,
    bidding: {
      stage: b.stage,
      history: clone(b.history),
      candidate: b.candidate,
      highScore: b.highScore,
      caller: b.caller,
      final: b.final,
    },
    trick: clone(match.trick),
    playedCards: match.playedCards.slice(),
    playedBy: match.playedBy.map((p) => p.slice()),
    bombsPlayed: match.bombsPlayed,
    scores: match.scores.slice(),
    settings: clone(match.settings),
    seq: match.seq,
    redeals: match.redeals,
    result: match.result ? clone(match.result) : null,
  };
}
