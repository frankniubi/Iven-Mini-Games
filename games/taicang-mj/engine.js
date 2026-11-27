/**
 * 4-player Chinese mahjong rules engine (太仓麻将 and other 江南 styles).
 * Pure logic: no DOM, no timers. The match is a plain JSON object; every
 * regional difference lives in the ruleset (rules.js) as options or hooks.
 */

import { RULESETS, DEFAULT_RULESET } from './rules.js';

export const GAME_ID = 'taicang-mj';
export const SEATS = 4;
export const KIND_COUNT = 44;
export const HONOR_START = 27;
export const FLOWER_START = 34;
export const BAIDA = 42; // 印字百搭
export const BLANK = 43; // 不带框白板（大白板）
export const WIND_KINDS = [27, 28, 29, 30];
export const DRAGON_KINDS = [31, 32, 33];
export const TERMINAL_HONOR_KINDS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

// ---------------------------------------------------------------------------
// Tiles

const NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_CHARS = ['万', '条', '筒'];
const HONOR_NAMES = ['东风', '南风', '西风', '北风', '红中', '发财', '白板'];
const FLOWER_NAMES = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊', '百搭', '大白板'];
const SUIT_IDS = ['wan', 'tiao', 'tong'];

export function tileName(kind) {
  if (!Number.isInteger(kind) || kind < 0) return '暗牌';
  if (kind < 27) return NUMS[kind % 9] + SUIT_CHARS[Math.floor(kind / 9)];
  if (kind < 34) return HONOR_NAMES[kind - 27];
  if (kind < 44) return FLOWER_NAMES[kind - 34];
  return '未知';
}

/** 'wan' | 'tiao' | 'tong' | 'wind' | 'dragon' | 'flower' (34-41 花牌) | 'special' (42 百搭, 43 大白板) | null */
export function tileSuit(kind) {
  if (!Number.isInteger(kind) || kind < 0) return null;
  if (kind < 27) return SUIT_IDS[Math.floor(kind / 9)];
  if (kind < 31) return 'wind';
  if (kind < 34) return 'dragon';
  if (kind < 42) return 'flower';
  if (kind < 44) return 'special';
  return null;
}

/** 1-9 for suited tiles, 0 otherwise. */
export function tileRank(kind) {
  return kind >= 0 && kind < 27 ? (kind % 9) + 1 : 0;
}

export const isSuited = (k) => k >= 0 && k < 27;
export const isWind = (k) => k >= 27 && k < 31;
export const isHonor = (k) => k >= 27 && k < 34;
export const isTerminal = (k) => k >= 0 && k < 27 && (k % 9 === 0 || k % 9 === 8);
export const isTerminalOrHonor = (k) => isTerminal(k) || isHonor(k);

export function sortTiles(kinds) {
  return kinds.slice().sort((a, b) => (a < 0 ? 99 : a) - (b < 0 ? 99 : b));
}

/** Debug/test notation: '123m456s789p1234567z12345678f12x' (m 万, s 条, p 筒, z 字, f 花, 1x 百搭, 2x 大白板). */
export function parseTiles(str) {
  const out = [];
  let digits = [];
  for (const ch of String(str).replace(/\s+/g, '')) {
    if (ch >= '0' && ch <= '9') {
      digits.push(Number(ch));
      continue;
    }
    const base = { m: 0, s: 9, p: 18, z: 27, f: 34, x: 42 }[ch];
    if (base === undefined) throw new Error(`bad tile notation: ${str}`);
    for (const d of digits) out.push(base + d - 1);
    digits = [];
  }
  return out;
}

export function formatTiles(kinds) {
  return sortTiles(kinds).map(tileName).join(' ');
}

export function toCounts(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) if (t >= 0 && t < 34) c[t]++;
  return c;
}

/** Split concealed tiles into natural counts (kinds 0-33) and the number of 财神 (jokers). */
export function splitHand(tiles, wilds = []) {
  const counts = new Array(34).fill(0);
  let jokers = 0;
  for (const t of tiles) {
    if (wilds.includes(t)) jokers++;
    else if (t >= 0 && t < 34) counts[t]++;
  }
  return { counts, jokers };
}

/** 财神 kinds for a flipped indicator: the "next" tile (9→1, 北→东, 白→中, 春夏秋冬→梅兰竹菊, 百搭↔大白板). */
export function wildsForIndicator(kind) {
  if (!Number.isInteger(kind) || kind < 0) return [];
  if (kind < 27) return [kind - (kind % 9) + (((kind % 9) + 1) % 9)];
  if (kind < 31) return [27 + ((kind - 27 + 1) % 4)];
  if (kind < 34) return [31 + ((kind - 31 + 1) % 3)];
  if (kind < 38) return [38, 39, 40, 41];
  if (kind < 42) return [34, 35, 36, 37];
  if (kind === BAIDA) return [BLANK];
  if (kind === BLANK) return [BAIDA];
  return [];
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32; the whole state is one uint32 stored in the match)

export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rngStep(state) {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** Standalone seeded generator returning floats in [0, 1). */
export function createRng(seed) {
  let state = hashSeed(seed);
  return () => {
    const [next, value] = rngStep(state);
    state = next;
    return value;
  };
}

function matchRandom(match) {
  const [next, value] = rngStep(match.rng);
  match.rng = next;
  return value;
}

// ---------------------------------------------------------------------------
// Rulesets & settings

export function getRuleset(id) {
  return RULESETS[id] || RULESETS[DEFAULT_RULESET];
}

export function defaultSettings(rulesetId) {
  const rs = getRuleset(rulesetId || DEFAULT_RULESET);
  return { ruleset: rs.id, baseScore: 1, botLevel: 'normal', ...JSON.parse(JSON.stringify(rs.options || {})) };
}

export function normalizeSettings(settings = {}) {
  const rs = getRuleset(settings.ruleset || DEFAULT_RULESET);
  const base = defaultSettings(rs.id);
  const given = JSON.parse(JSON.stringify(settings || {}));
  const out = { ...base, ...given, ruleset: rs.id };
  // Shallow-merge nested option groups so partial overrides keep the other defaults.
  for (const k of Object.keys(base)) {
    const b = base[k];
    const g = given[k];
    if (b && g && typeof b === 'object' && typeof g === 'object' && !Array.isArray(b) && !Array.isArray(g)) out[k] = { ...b, ...g };
  }
  return out;
}

/** Copies of every kind (length 44) in the tile set described by these settings. */
export function tileCountsFor(settings = {}) {
  const rs = getRuleset(settings.ruleset);
  if (rs.tileCounts) return rs.tileCounts(settings);
  const c = new Array(KIND_COUNT).fill(0);
  for (let k = 0; k < 27; k++) c[k] = 4;
  if (settings.honors !== false) for (let k = 27; k < 34; k++) c[k] = 4;
  if (settings.flowers !== false) for (let k = 34; k < 42; k++) c[k] = 1;
  return c;
}

/** Kinds set aside as 花 and replaced from the back of the wall (before removing this hand's 财神). */
export function flowerKindsFor(settings = {}) {
  const rs = getRuleset(settings.ruleset);
  if (rs.flowerKinds) return rs.flowerKinds(settings);
  const out = [];
  if (settings.honorsAsFlowers) for (let k = 27; k < 34; k++) out.push(k);
  for (let k = 34; k < 44; k++) out.push(k);
  return out;
}

/** Kinds that can sit in a concealed hand for this tile set + 财神 list. */
export function playKindsFor(settings = {}, wilds = []) {
  const counts = tileCountsFor(settings);
  const flowers = flowerKindsFor(settings);
  const out = [];
  for (let k = 0; k < KIND_COUNT; k++) {
    if (!counts[k]) continue;
    if (flowers.includes(k) && !wilds.includes(k)) continue;
    out.push(k);
  }
  return out;
}

function shantenOpts(settings, jokers = 0) {
  return {
    sevenPairs: settings.sevenPairs !== false,
    sevenPairsFour: settings.sevenPairsFour !== false,
    thirteenOrphans: !!settings.thirteenOrphans,
    jokers,
  };
}

const reservedOf = (cfg) => Math.max(0, (cfg.reservedTiles ?? cfg.deadWall ?? 0) | 0);

// ---------------------------------------------------------------------------
// Win detection (财神 = jokers that may stand for any tile)

function sumCounts(c) {
  let n = 0;
  for (let i = 0; i < 34; i++) n += c[i];
  return n;
}

// Can naturals from index i plus j jokers all form sets? A group always uses as many
// naturals as possible: swapping a joker for an available natural never hurts.
function setsJ(c, i, j) {
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) return j % 3 === 0;
  const use = Math.min(c[i], 3);
  if (3 - use <= j) {
    c[i] -= use;
    const ok = setsJ(c, i, j - (3 - use));
    c[i] += use;
    if (ok) return true;
  }
  if (i < 27) {
    const base = i - (i % 9);
    for (let st = Math.max(base, i - 2); st <= i && st <= base + 6; st++) {
      let used = 0; // bitmask of offsets taken from naturals
      let w = 0;
      for (let p = st; p <= st + 2; p++) {
        if (p === i || (p > i && c[p] > 0)) used |= 1 << (p - st);
        else w++;
      }
      if (w > j) continue;
      for (let p = st; p <= st + 2; p++) if (used & (1 << (p - st))) c[p]--;
      const ok = setsJ(c, i, j - w);
      for (let p = st; p <= st + 2; p++) if (used & (1 << (p - st))) c[p]++;
      if (ok) return true;
    }
  }
  return false;
}

export function isStandardWin(counts, jokers = 0) {
  if ((sumCounts(counts) + jokers) % 3 !== 2) return false;
  const c = counts.slice();
  for (let p = 0; p < 34; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      const ok = setsJ(c, 0, jokers);
      c[p] += 2;
      if (ok) return true;
    } else if (c[p] === 1 && jokers >= 1) {
      c[p] -= 1;
      const ok = setsJ(c, 0, jokers - 1);
      c[p] += 1;
      if (ok) return true;
    }
  }
  return jokers >= 2 && setsJ(c, 0, jokers - 2);
}

export function isSevenPairs(counts, allowFour = true, jokers = 0) {
  if (sumCounts(counts) + jokers !== 14) return false;
  let singles = 0;
  for (let k = 0; k < 34; k++) {
    const n = counts[k];
    if (!allowFour && n > 2) return false;
    singles += n % 2;
  }
  return singles <= jokers;
}

export function isThirteenOrphans(counts, jokers = 0) {
  if (sumCounts(counts) + jokers !== 14) return false;
  let pair = false;
  let missing = 0;
  for (let k = 0; k < 34; k++) {
    const want = TERMINAL_HONOR_KINDS.includes(k);
    if (!want && counts[k]) return false;
    if (counts[k] > 2) return false;
    if (counts[k] === 2) {
      if (pair) return false;
      pair = true;
    }
    if (want && counts[k] === 0) missing++;
  }
  return missing + (pair ? 0 : 1) <= jokers;
}

function extractSets(c, i, j, sets, out, pair, pairWilds) {
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) {
    if (j % 3) return;
    const all = sets.slice();
    for (let n = 0; n < j / 3; n++) all.push({ type: 'any', tile: null, wilds: 3 });
    out.push({ pair, pairWilds, sets: all });
    return;
  }
  const use = Math.min(c[i], 3);
  if (3 - use <= j) {
    c[i] -= use;
    sets.push({ type: 'pung', tile: i, wilds: 3 - use });
    extractSets(c, i, j - (3 - use), sets, out, pair, pairWilds);
    sets.pop();
    c[i] += use;
  }
  if (i < 27) {
    const base = i - (i % 9);
    for (let st = Math.max(base, i - 2); st <= i && st <= base + 6; st++) {
      const used = [];
      let w = 0;
      for (let p = st; p <= st + 2; p++) {
        if (p === i || (p > i && c[p] > 0)) used.push(p);
        else w++;
      }
      if (w > j) continue;
      for (const p of used) c[p]--;
      sets.push({ type: 'chow', tile: st, wilds: w });
      extractSets(c, i, j - w, sets, out, pair, pairWilds);
      sets.pop();
      for (const p of used) c[p]++;
    }
  }
}

/**
 * Standard decompositions of a concealed 3n+2 hand:
 * [{ pair: kind|null, pairWilds, sets:[{ type:'pung'|'chow'|'any', tile: kind|null, wilds }] }].
 * 'any' = three 财神 forming a free set; pair null = two 财神.
 */
export function decomposeHand(counts, jokers = 0) {
  const out = [];
  if ((sumCounts(counts) + jokers) % 3 !== 2) return out;
  const c = counts.slice();
  for (let p = 0; p < 34; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      extractSets(c, 0, jokers, [], out, p, 0);
      c[p] += 2;
    } else if (c[p] === 1 && jokers >= 1) {
      c[p] -= 1;
      extractSets(c, 0, jokers - 1, [], out, p, 1);
      c[p] += 1;
    }
  }
  if (jokers >= 2) extractSets(c, 0, jokers - 2, [], out, null, 2);
  const seen = new Set();
  return out.filter((d) => {
    const key = `${d.pair}/${d.pairWilds}|${d.sets.map((s) => `${s.type}${s.tile}:${s.wilds}`).sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Ways concealed counts (+ jokers) complete with `meldCount` exposed melds; null if not a win. */
export function winForms(counts, meldCount, settings = {}, jokers = 0) {
  if (sumCounts(counts) + jokers !== 3 * (4 - meldCount) + 2) return null;
  const o = shantenOpts(settings);
  const standard = decomposeHand(counts, jokers);
  const sevenPairs = meldCount === 0 && o.sevenPairs && isSevenPairs(counts, o.sevenPairsFour, jokers);
  const thirteenOrphans = meldCount === 0 && o.thirteenOrphans && isThirteenOrphans(counts, jokers);
  if (!standard.length && !sevenPairs && !thirteenOrphans) return null;
  return { standard, sevenPairs, thirteenOrphans };
}

export function isWinningCounts(counts, meldCount, settings = {}, jokers = 0) {
  if (sumCounts(counts) + jokers !== 3 * (4 - meldCount) + 2) return false;
  const o = shantenOpts(settings);
  if (isStandardWin(counts, jokers)) return true;
  if (meldCount === 0 && o.sevenPairs && isSevenPairs(counts, o.sevenPairsFour, jokers)) return true;
  return meldCount === 0 && o.thirteenOrphans && isThirteenOrphans(counts, jokers);
}

/** tiles: concealed kinds incl. win tile; melds: array or count; wilds: 财神 kinds. */
export function isWinningHand(tiles, melds = [], settings = {}, wilds = []) {
  const meldCount = Array.isArray(melds) ? melds.length : melds;
  const { counts, jokers } = splitHand(tiles, wilds);
  return isWinningCounts(counts, meldCount, settings, jokers);
}

/** Kinds (from playKinds) that would complete a 3n+1 hand. */
export function waitsForCounts(counts, meldCount, settings = {}, jokers = 0, playKinds = null, wilds = []) {
  const out = [];
  const kinds = playKinds || Array.from({ length: 34 }, (_, k) => k);
  for (const k of kinds) {
    if (wilds.includes(k)) {
      if (isWinningCounts(counts, meldCount, settings, jokers + 1)) out.push(k);
      continue;
    }
    if (k >= 34 || counts[k] >= 4) continue;
    counts[k]++;
    if (isWinningCounts(counts, meldCount, settings, jokers)) out.push(k);
    counts[k]--;
  }
  return out;
}

export function getWaits(tiles, meldCount = 0, settings = {}, wilds = []) {
  const { counts, jokers } = splitHand(tiles, wilds);
  return waitsForCounts(counts, meldCount, settings, jokers, playKindsFor(settings, wilds), wilds);
}

function waitTypesOf(decomp, winTile) {
  const types = [];
  if (decomp.pair === winTile) types.push('single');
  for (const s of decomp.sets) {
    if (s.wilds) continue;
    if (s.type === 'pung' && s.tile === winTile) types.push('dualPon');
    if (s.type !== 'chow') continue;
    const t = s.tile;
    if (winTile === t + 1) types.push('closed');
    else if (winTile === t) types.push(t % 9 === 6 ? 'edge' : 'open');
    else if (winTile === t + 2) types.push(t % 9 === 0 ? 'edge' : 'open');
  }
  return [...new Set(types)];
}

// ---------------------------------------------------------------------------
// Shanten (向听数): per-suit Pareto sets of (sets, partial sets, pair) memoised by suit code.

const suitMemo = new Map();
const honorMemo = new Map();
const HONOR_TABLE = [
  [[0, 0, 0]],
  [[0, 0, 0]],
  [[0, 1, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
];

function pareto(list) {
  const out = [];
  for (const a of list) {
    let skip = false;
    for (const b of list) {
      if (b === a) continue;
      if (b[0] >= a[0] && b[1] >= a[1] && b[2] >= a[2] && (b[0] > a[0] || b[1] > a[1] || b[2] > a[2])) {
        skip = true;
        break;
      }
    }
    if (!skip && !out.some((x) => x[0] === a[0] && x[1] === a[1] && x[2] === a[2])) out.push(a);
  }
  return out;
}

function isZeroOpts(a) {
  return a.length === 1 && a[0][0] === 0 && a[0][1] === 0 && a[0][2] === 0;
}

function combine(a, b) {
  if (isZeroOpts(a)) return b;
  if (isZeroOpts(b)) return a;
  const acc = [];
  for (const x of a) {
    for (const y of b) {
      if (x[2] + y[2] > 1) continue;
      acc.push([Math.min(x[0] + y[0], 4), Math.min(x[1] + y[1], 4), x[2] + y[2]]);
    }
  }
  return pareto(acc);
}

function suitOpts(c9) {
  let key = 0;
  for (let i = 8; i >= 0; i--) key = key * 5 + c9[i];
  const hit = suitMemo.get(key);
  if (hit) return hit;
  let i = 0;
  while (i < 9 && c9[i] === 0) i++;
  if (i === 9) {
    const r = [[0, 0, 0]];
    suitMemo.set(key, r);
    return r;
  }
  const acc = [];
  const take = (dm, dt, dh) => {
    for (const [m, t, h] of suitOpts(c9)) {
      if (h + dh <= 1) acc.push([Math.min(m + dm, 4), Math.min(t + dt, 4), h + dh]);
    }
  };
  c9[i]--;
  take(0, 0, 0);
  c9[i]++;
  if (c9[i] >= 2) {
    c9[i] -= 2;
    take(0, 1, 0);
    take(0, 0, 1);
    c9[i] += 2;
  }
  if (c9[i] >= 3) {
    c9[i] -= 3;
    take(1, 0, 0);
    c9[i] += 3;
  }
  if (i < 7 && c9[i + 1] && c9[i + 2]) {
    c9[i]--; c9[i + 1]--; c9[i + 2]--;
    take(1, 0, 0);
    c9[i]++; c9[i + 1]++; c9[i + 2]++;
  }
  if (i < 8 && c9[i + 1]) {
    c9[i]--; c9[i + 1]--;
    take(0, 1, 0);
    c9[i]++; c9[i + 1]++;
  }
  if (i < 7 && c9[i + 2]) {
    c9[i]--; c9[i + 2]--;
    take(0, 1, 0);
    c9[i]++; c9[i + 2]++;
  }
  const r = pareto(acc);
  suitMemo.set(key, r);
  return r;
}

function honorOpts(counts) {
  let key = 0;
  for (let k = 33; k >= 27; k--) key = key * 5 + counts[k];
  const hit = honorMemo.get(key);
  if (hit) return hit;
  let r = [[0, 0, 0]];
  for (let k = 27; k < 34; k++) if (counts[k] >= 2) r = combine(r, HONOR_TABLE[counts[k]]);
  honorMemo.set(key, r);
  return r;
}

const scratch9 = new Array(9).fill(0);

export function shantenStandard(counts, meldCount = 0) {
  let opts = honorOpts(counts);
  for (let s = 0; s < 3; s++) {
    let any = false;
    for (let i = 0; i < 9; i++) {
      scratch9[i] = counts[s * 9 + i];
      if (scratch9[i]) any = true;
    }
    if (any) opts = combine(opts, suitOpts(scratch9));
  }
  let best = 8;
  for (const [m, t, h] of opts) {
    const M = Math.min(m + meldCount, 4);
    const T = Math.max(0, Math.min(t, 4 - M));
    const s = 8 - 2 * M - T - h;
    if (s < best) best = s;
  }
  return best;
}

export function shantenSevenPairs(counts, allowFour = true) {
  let pairs = 0;
  let kinds = 0;
  for (let k = 0; k < 34; k++) {
    const n = counts[k];
    if (!n) continue;
    kinds++;
    pairs += allowFour ? Math.floor(n / 2) : n >= 2 ? 1 : 0;
  }
  return 6 - Math.min(pairs, 7) + (allowFour ? 0 : Math.max(0, 7 - kinds));
}

export function shantenThirteenOrphans(counts) {
  let kinds = 0;
  let pair = 0;
  for (const k of TERMINAL_HONOR_KINDS) {
    if (counts[k]) kinds++;
    if (counts[k] >= 2) pair = 1;
  }
  return 13 - kinds - pair;
}

/**
 * -1 = complete hand, 0 = 听牌, n = tiles away from 听牌.
 * opts: { sevenPairs, sevenPairsFour, thirteenOrphans, jokers }. Each joker is a perfect tile,
 * so it lowers shanten by exactly one down to the floor for the hand size.
 */
export function shantenCounts(counts, meldCount = 0, opts = {}) {
  let s = shantenStandard(counts, meldCount);
  if (meldCount === 0) {
    if (opts.sevenPairs !== false) s = Math.min(s, shantenSevenPairs(counts, opts.sevenPairsFour !== false));
    if (opts.thirteenOrphans) s = Math.min(s, shantenThirteenOrphans(counts));
  }
  const j = opts.jokers | 0;
  if (!j) return s;
  const floor = (sumCounts(counts) + j) % 3 === 2 ? -1 : 0;
  return Math.max(floor, s - j);
}

export function shanten(tiles, meldCount = 0, opts = {}) {
  const { counts, jokers } = splitHand(tiles, opts.wilds || []);
  return shantenCounts(counts, meldCount, { ...opts, jokers: (opts.jokers | 0) + jokers });
}

// ---------------------------------------------------------------------------
// Match lifecycle

export function createMatch(settings = {}, seed) {
  const s = normalizeSettings(settings);
  const seedNum = hashSeed(seed ?? Date.now() ^ Math.floor(Math.random() * 0x7fffffff));
  const match = {
    game: GAME_ID,
    version: 1,
    settings: s,
    seed: seedNum,
    rng: seedNum,
    scores: [0, 0, 0, 0],
    handNo: 0,
    firstDealer: 0,
    dealer: 0,
    dealerStreak: 0,
    dealerPasses: 0,
    roundWind: 0,
    matchOver: false,
    phase: 'idle',
    hand: null,
    result: null,
    history: [],
    seq: 0,
    lastEvents: [],
  };
  const fd = s.firstDealer === 'random' ? Math.floor(matchRandom(match) * 4) : (s.firstDealer | 0) % 4;
  match.firstDealer = fd;
  match.dealer = fd;
  return match;
}

const emptyQuad = () => [[], [], [], []];

export function liveWallCount(matchOrHand) {
  const h = matchOrHand && matchOrHand.hand !== undefined ? matchOrHand.hand : matchOrHand;
  if (!h) return 0;
  return Math.max(0, h.tail - h.head - h.deadWall);
}

function buildWall(match) {
  const counts = tileCountsFor(match.settings);
  const wall = [];
  for (let k = 0; k < KIND_COUNT; k++) for (let n = 0; n < counts[k]; n++) wall.push(k);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(matchRandom(match) * (i + 1));
    const t = wall[i];
    wall[i] = wall[j];
    wall[j] = t;
  }
  return wall;
}

/**
 * Deal a new hand. opts.wall = exact ordered wall (draws from index 0, replacements from
 * the end); opts.indicator = kind to flip as 财神 indicator (taken from the back) — tests/replays.
 */
export function startHand(match, opts = {}) {
  const cfg = match.settings;
  const dealer = match.dealer;
  let wall;
  if (opts.wall) {
    wall = opts.wall.slice();
    const want = tileCountsFor(cfg);
    const got = new Array(KIND_COUNT).fill(0);
    for (const t of wall) got[t]++;
    if (want.some((n, k) => n !== got[k])) throw new Error('startHand: wall does not match the tile set');
  } else {
    wall = buildWall(match);
  }
  const dice = [1 + Math.floor(matchRandom(match) * 6), 1 + Math.floor(matchRandom(match) * 6)];
  let indicator = null;
  let wilds = [];
  if (cfg.caishen === 'flip-next') {
    let idx;
    if (opts.indicator != null) idx = wall.lastIndexOf(opts.indicator);
    else idx = wall.length - 1 - 2 * (Math.min(dice[0], dice[1]) - 1);
    if (idx < 0) throw new Error('startHand: indicator not in wall');
    indicator = wall.splice(idx, 1)[0];
    wilds = wildsForIndicator(indicator);
  }
  const wildMask = new Array(KIND_COUNT).fill(0);
  for (const k of wilds) wildMask[k] = 1;
  const mask = new Array(KIND_COUNT).fill(0);
  for (const k of flowerKindsFor(cfg)) if (!wildMask[k]) mask[k] = 1;
  const tileCounts = tileCountsFor(cfg);
  const h = {
    dealer,
    roundWind: 27 + (match.roundWind % 4),
    seatWinds: [0, 1, 2, 3].map((s) => 27 + ((s - dealer + 4) % 4)),
    dice,
    indicator,
    wilds,
    wildMask,
    totalWilds: wilds.reduce((n, k) => n + tileCounts[k], 0),
    playKinds: playKindsFor(cfg, wilds),
    wall,
    head: 0,
    tail: wall.length,
    deadWall: reservedOf(cfg),
    flowerMask: mask,
    hands: emptyQuad(),
    drawn: [null, null, null, null],
    melds: emptyQuad(),
    flowers: emptyQuad(),
    discards: emptyQuad(),
    turn: dealer,
    stage: 'discard',
    lastDiscard: null,
    claim: null,
    drawSource: null,
    kanDraw: false,
    flowerDraw: false,
    discardCount: 0,
    claimCount: 0,
    kanCount: 0,
    turnsTaken: [0, 0, 0, 0],
    passedHu: emptyQuad(),
    passedPon: emptyQuad(),
    noDiscard: [null, null, null, null],
    ready: [false, false, false, false],
  };
  match.hand = h;
  match.handNo += 1;
  match.phase = 'playing';
  match.result = null;
  const events = [{ e: 'deal', dealer, handNo: match.handNo, dice: dice.slice() }];
  if (indicator !== null) events.push({ e: 'indicator', tile: indicator, wilds: wilds.slice() });

  for (let i = 0; i < 4; i++) {
    const s = (dealer + i) % 4;
    for (let n = 0; n < 13; n++) h.hands[s].push(wall[h.head++]);
  }
  let dealerLast = null;
  if (!cfg.dealerDraws) {
    dealerLast = wall[h.head++];
    h.hands[dealer].push(dealerLast);
  }
  for (let i = 0; i < 4; i++) {
    const s = (dealer + i) % 4;
    const got = replaceFlowers(match, s, events);
    if (got === false) {
      endExhausted(match, events);
      finishEvents(match, events);
      return match;
    }
    if (s === dealer && got !== null && dealerLast !== null && mask[dealerLast]) dealerLast = got;
  }
  if (cfg.dealerDraws) {
    drawTile(match, dealer, 'wall', events);
  } else {
    h.drawn[dealer] = dealerLast;
    h.drawSource = 'deal';
  }
  finishEvents(match, events);
  return match;
}

function finishEvents(match, events) {
  match.seq += 1;
  match.lastEvents = events;
}

/** Move every flower out of seat's hand, refilling from the back. Returns last replacement, null if none, false if the wall ran out. */
function replaceFlowers(match, seat, events) {
  const h = match.hand;
  const hand = h.hands[seat];
  let last = null;
  for (;;) {
    const idx = hand.findIndex((t) => h.flowerMask[t]);
    if (idx < 0) return last;
    const f = hand.splice(idx, 1)[0];
    h.flowers[seat].push(f);
    events.push({ e: 'flower', seat, tile: f });
    if (liveWallCount(h) <= 0) return false;
    last = h.wall[--h.tail];
    hand.push(last);
    events.push({ e: 'draw', seat, replacement: true });
  }
}

/** source: 'wall' (front) | 'kan' (back). Ends the hand in a draw when the live wall is empty. */
function drawTile(match, seat, source, events) {
  const h = match.hand;
  if (liveWallCount(h) <= 0) {
    endExhausted(match, events);
    return false;
  }
  const back = source !== 'wall';
  const t = back ? h.wall[--h.tail] : h.wall[h.head++];
  h.hands[seat].push(t);
  h.turn = seat;
  h.stage = 'discard';
  h.drawSource = source;
  h.kanDraw = source === 'kan';
  h.flowerDraw = false;
  h.passedHu[seat] = [];
  h.passedPon[seat] = [];
  events.push({ e: 'draw', seat, replacement: back });
  let drawn = t;
  if (h.flowerMask[t]) {
    const got = replaceFlowers(match, seat, events);
    if (got === false) {
      endExhausted(match, events);
      return false;
    }
    drawn = got;
    h.flowerDraw = true;
  }
  h.drawn[seat] = drawn;
  return true;
}

function removeTiles(hand, kind, n) {
  for (let i = 0; i < n; i++) {
    const idx = hand.indexOf(kind);
    if (idx < 0) throw new Error(`tile ${kind} missing`);
    hand.splice(idx, 1);
  }
}

// ---------------------------------------------------------------------------
// Score context & legal actions

function emptyOptions() {
  return { discard: false, hu: false, pon: false, kan: [], chi: [], pass: false, discardTiles: [], readyDiscards: [], kanTypes: [] };
}

function specialWinFor(match, seat, tiles, selfDraw) {
  const h = match.hand;
  const rs = getRuleset(match.settings.ruleset);
  if (!selfDraw || !rs.specialWin) return null;
  const wildCount = tiles.reduce((n, t) => n + (h.wildMask[t] ? 1 : 0), 0);
  return rs.specialWin({ settings: match.settings, seat, wildCount, totalWilds: h.totalWilds, concealed: tiles.slice(), wilds: h.wilds.slice() }) || null;
}

/** Everything a ruleset scorer may need about one winning hand (null if it is not a win). */
function scoreCtxFor(match, seat, winTile, selfDraw, fromSeat, robKong) {
  const h = match.hand;
  const cfg = match.settings;
  const concealed = h.hands[seat].slice();
  if (!selfDraw) concealed.push(winTile);
  const { counts, jokers } = splitHand(concealed, h.wilds);
  const melds = h.melds[seat].map((m) => ({ ...m, tiles: m.tiles.slice() }));
  const forms = winForms(counts, melds.length, cfg, jokers);
  const special = specialWinFor(match, seat, concealed, selfDraw);
  if (!forms && !special) return null;
  const winIsWild = !!h.wildMask[winTile];
  const before = counts.slice();
  let jBefore = jokers;
  if (winIsWild) jBefore--;
  else if (winTile < 34) before[winTile]--;
  const waits = forms ? waitsForCounts(before, melds.length, cfg, jBefore, h.playKinds, h.wilds) : [];
  const decompositions = forms ? forms.standard.map((d) => ({ ...d, waitTypes: winIsWild ? [] : waitTypesOf(d, winTile) })) : [];
  const waitTypes = [...new Set(decompositions.flatMap((d) => d.waitTypes))];
  if (forms && (forms.sevenPairs || forms.thirteenOrphans)) waitTypes.push('single');
  let naturalWin = false;
  if (jokers > 0 && h.wilds.every((w) => w < 34)) naturalWin = isWinningCounts(toCounts(concealed), melds.length, cfg, 0);
  const live = liveWallCount(h);
  return {
    settings: cfg,
    ruleset: cfg.ruleset,
    baseScore: cfg.baseScore,
    seat,
    dealer: h.dealer,
    isDealer: seat === h.dealer,
    dealerStreak: match.dealerStreak,
    seatWind: h.seatWinds[seat],
    roundWind: h.roundWind,
    concealed: sortTiles(concealed),
    counts,
    wildCount: jokers,
    wilds: h.wilds.slice(),
    indicator: h.indicator,
    winTileIsWild: winIsWild,
    naturalWin,
    special,
    melds,
    flowers: h.flowers[seat].slice(),
    allFlowers: h.flowers.map((f) => f.slice()),
    winTile,
    selfDraw,
    fromSeat: selfDraw ? null : fromSeat,
    kongReplacement: selfDraw && h.kanDraw,
    flowerReplacement: selfDraw && h.flowerDraw,
    lastTile: live === 0,
    robKong: !!robKong,
    discardCount: h.discardCount,
    claimCount: h.claimCount,
    seatDiscards: h.turnsTaken[seat],
    firstTurn: h.turnsTaken[seat] === 0 && h.claimCount === 0,
    ready: h.ready[seat],
    concealedHand: melds.every((m) => m.type === 'ankan'),
    decompositions,
    sevenPairs: !!(forms && forms.sevenPairs),
    thirteenOrphans: !!(forms && forms.thirteenOrphans),
    waits,
    waitTypes,
    wallCount: live,
    kanCount: h.kanCount,
  };
}

function canHu(match, seat, tile, selfDraw, fromSeat, robKong) {
  const h = match.hand;
  const cfg = match.settings;
  if (tile == null) return false;
  if (cfg.readyRequired && !h.ready[seat]) return false;
  const tiles = h.hands[seat].slice();
  if (!selfDraw) tiles.push(tile);
  const { counts, jokers } = splitHand(tiles, h.wilds);
  if (!isWinningCounts(counts, h.melds[seat].length, cfg, jokers) && !specialWinFor(match, seat, tiles, selfDraw)) return false;
  const ctx = scoreCtxFor(match, seat, tile, selfDraw, fromSeat, robKong);
  if (!ctx) return false;
  const sc = getRuleset(cfg.ruleset).score(ctx);
  return !!(sc && sc.canWin);
}

function passedHuBlocks(match, seat, tile) {
  const cfg = match.settings;
  const list = match.hand.passedHu[seat];
  if (!cfg.passHuLock || !list.length) return false;
  return cfg.passHuScope === 'same-tile' ? list.includes(tile) : true;
}

function meldAllowed(h, cfg, kind) {
  return !h.wildMask[kind] || !!cfg.caishenInMelds;
}

function ownTurnOptions(match, seat) {
  const h = match.hand;
  const cfg = match.settings;
  const o = emptyOptions();
  const hand = h.hands[seat];
  const meldCount = h.melds[seat].length;
  o.discard = true;
  const locked = h.ready[seat] && h.drawn[seat] != null;
  let tiles = locked ? [h.drawn[seat]] : [...new Set(hand)].sort((a, b) => a - b);
  if (!locked && h.noDiscard[seat] != null && tiles.length > 1) tiles = tiles.filter((t) => t !== h.noDiscard[seat]);
  o.discardTiles = tiles;
  if (h.drawSource && canHu(match, seat, h.drawn[seat], true, null, false)) o.hu = true;
  if (cfg.allowKan !== false && liveWallCount(h) > 0) {
    const raw = toCounts(hand);
    const cands = [];
    for (let k = 0; k < 34; k++) if (raw[k] === 4 && meldAllowed(h, cfg, k)) cands.push({ tile: k, type: 'ankan' });
    for (const m of h.melds[seat]) {
      if (m.type === 'pon' && raw[m.tiles[0]] >= 1 && meldAllowed(h, cfg, m.tiles[0])) cands.push({ tile: m.tiles[0], type: 'bukan' });
    }
    for (const c of cands) {
      if (h.ready[seat]) {
        // A declared hand may only kong the drawn tile and only if the waits stay the same.
        if (c.tile !== h.drawn[seat]) continue;
        const pre = hand.slice();
        pre.splice(pre.indexOf(c.tile), 1);
        const post = hand.filter((t) => t !== c.tile || c.type === 'bukan');
        if (c.type === 'bukan') post.splice(post.indexOf(c.tile), 1);
        const a = splitHand(pre, h.wilds);
        const b = splitHand(post, h.wilds);
        const w1 = waitsForCounts(a.counts, meldCount, cfg, a.jokers, h.playKinds, h.wilds).join();
        const w2 = waitsForCounts(b.counts, meldCount + (c.type === 'ankan' ? 1 : 0), cfg, b.jokers, h.playKinds, h.wilds).join();
        if (!w1 || w1 !== w2) continue;
      }
      o.kan.push(c.tile);
      o.kanTypes.push(c);
    }
  }
  if (cfg.declareReady && !h.ready[seat] && !(cfg.readyConcealedOnly && h.melds[seat].some((m) => m.type !== 'ankan'))) {
    const { counts, jokers } = splitHand(hand, h.wilds);
    for (const d of o.discardTiles) {
      const wild = !!h.wildMask[d];
      if (wild) {
        if (waitsForCounts(counts, meldCount, cfg, jokers - 1, h.playKinds, h.wilds).length) o.readyDiscards.push(d);
        continue;
      }
      if (d >= 34) continue;
      counts[d]--;
      if (waitsForCounts(counts, meldCount, cfg, jokers, h.playKinds, h.wilds).length) o.readyDiscards.push(d);
      counts[d]++;
    }
  }
  return o;
}

function claimOptionsFor(match, seat, from, tile) {
  const h = match.hand;
  const cfg = match.settings;
  const o = emptyOptions();
  o.pass = true;
  if (!passedHuBlocks(match, seat, tile) && canHu(match, seat, tile, false, from, false)) o.hu = true;
  const hand = h.hands[seat];
  const live = liveWallCount(h);
  const callOk = !h.ready[seat] && (live > 0 || cfg.claimOnLastTile) && meldAllowed(h, cfg, tile);
  if (callOk) {
    let n = 0;
    for (const t of hand) if (t === tile) n++;
    const ponLocked = cfg.passPengLock && cfg.passPengLock !== 'off' && h.passedPon[seat].includes(tile);
    if (cfg.allowPon !== false && n >= 2 && !ponLocked) o.pon = true;
    if (cfg.allowKan !== false && n >= 3 && live > 0) {
      o.kan.push(tile);
      o.kanTypes.push({ tile, type: 'mingkan' });
    }
    if (cfg.allowChi !== false && seat === (from + 1) % 4 && isSuited(tile)) {
      const r = tile % 9;
      const has = (k) => hand.includes(k) && meldAllowed(h, cfg, k);
      if (r >= 2 && has(tile - 2) && has(tile - 1)) o.chi.push([tile - 2, tile - 1, tile]);
      if (r >= 1 && r <= 7 && has(tile - 1) && has(tile + 1)) o.chi.push([tile - 1, tile, tile + 1]);
      if (r <= 6 && has(tile + 1) && has(tile + 2)) o.chi.push([tile, tile + 1, tile + 2]);
    }
  }
  return o.hu || o.pon || o.kan.length || o.chi.length ? o : null;
}

function robOptionsFor(match, seat, from, tile) {
  if (passedHuBlocks(match, seat, tile)) return null;
  if (!canHu(match, seat, tile, false, from, true)) return null;
  const o = emptyOptions();
  o.hu = true;
  o.pass = true;
  return o;
}

export function getPendingSeats(match) {
  const h = match && match.hand;
  if (!h || match.phase !== 'playing') return [];
  if (h.stage === 'discard') return [h.turn];
  if (h.stage === 'claim' && h.claim) {
    const out = [];
    for (let d = 1; d < 4; d++) {
      const s = (h.claim.from + d) % 4;
      if (h.claim.options[s] && !h.claim.responses[s]) out.push(s);
    }
    return out;
  }
  return [];
}

export function getLegalActions(match, seat) {
  const h = match && match.hand;
  if (!h || match.phase !== 'playing') return null;
  if (h.stage === 'discard') return seat === h.turn ? ownTurnOptions(match, seat) : null;
  if (h.stage === 'claim' && h.claim) {
    const o = h.claim.options[seat];
    if (!o || h.claim.responses[seat]) return null;
    return JSON.parse(JSON.stringify(o));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Actions

function sameTiles(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}

function validate(match, seat, action) {
  if (!match || !match.hand) return { error: '对局还没有开始' };
  if (match.phase !== 'playing') return { error: '这一局已经结束' };
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) return { error: '座位无效' };
  if (!action || typeof action.type !== 'string') return { error: '无效的操作' };
  const o = getLegalActions(match, seat);
  if (!o) return { error: '现在还没轮到你操作' };
  const a = { type: action.type };
  switch (action.type) {
    case 'discard':
      if (!o.discard) return { error: '现在不能出牌' };
      if (!o.discardTiles.includes(action.tile)) {
        if (match.hand.ready[seat] && match.hand.hands[seat].includes(action.tile)) return { error: '报听后只能打出摸到的牌' };
        if (match.hand.hands[seat].includes(action.tile)) return { error: '刚吃进的牌不能马上打出' };
        return { error: '手里没有这张牌' };
      }
      a.tile = action.tile;
      if (action.ready) {
        if (!o.readyDiscards.includes(action.tile)) return { error: '打出这张牌后不能听牌，不能报听' };
        a.ready = true;
      }
      return { action: a, options: o };
    case 'hu':
      if (!o.hu) return { error: '现在不能胡牌' };
      return { action: a, options: o };
    case 'pon':
      if (!o.pon) return { error: '现在不能碰' };
      return { action: a, options: o };
    case 'kan': {
      if (!o.kan.length) return { error: '现在不能杠' };
      const tile = action.tile ?? (o.kan.length === 1 ? o.kan[0] : undefined);
      if (!o.kan.includes(tile)) return { error: '不能杠这张牌' };
      a.tile = tile;
      return { action: a, options: o };
    }
    case 'chi': {
      if (!o.chi.length) return { error: '现在不能吃' };
      const tiles = action.tiles ?? (o.chi.length === 1 ? o.chi[0] : undefined);
      const hit = o.chi.find((c) => sameTiles(tiles, c));
      if (!hit) return { error: '不能这样吃' };
      a.tiles = hit.slice();
      return { action: a, options: o };
    }
    case 'pass':
      if (!o.pass) return { error: '现在不能选择过' };
      return { action: a, options: o };
    default:
      return { error: '无效的操作' };
  }
}

export function applyAction(match, seat, action) {
  let v;
  try {
    v = validate(match, seat, action);
  } catch (err) {
    return { ok: false, error: `操作无效：${err && err.message}` };
  }
  if (v.error) return { ok: false, error: v.error };
  const backup = JSON.stringify(match);
  try {
    const events = [];
    perform(match, seat, v.action, v.options, events);
    finishEvents(match, events);
    return { ok: true, events };
  } catch (err) {
    const restored = JSON.parse(backup);
    for (const k of Object.keys(match)) delete match[k];
    Object.assign(match, restored);
    return { ok: false, error: `内部错误：${err && err.message}` };
  }
}

function perform(match, seat, a, o, events) {
  const h = match.hand;
  if (h.stage === 'discard') {
    if (a.type === 'discard') {
      // Declining a self-drawn win also counts as 过胡 until the next draw.
      if (o.hu && match.settings.passHuLock) h.passedHu[seat] = [h.drawn[seat]];
      return doDiscard(match, seat, a.tile, !!a.ready, events);
    }
    if (a.type === 'hu') return finishWin(match, [seat], null, true, h.drawn[seat], false, events);
    if (a.type === 'kan') {
      const t = o.kanTypes.find((k) => k.tile === a.tile);
      if (t.type === 'ankan') return doAnKan(match, seat, a.tile, events);
      return declareBuKan(match, seat, a.tile, events);
    }
    throw new Error('bad own-turn action');
  }
  h.claim.responses[seat] = a;
  maybeResolveClaims(match, events);
  return undefined;
}

function doDiscard(match, seat, tile, ready, events) {
  const h = match.hand;
  removeTiles(h.hands[seat], tile, 1);
  h.discards[seat].push(tile);
  h.drawn[seat] = null;
  h.noDiscard[seat] = null;
  h.drawSource = null;
  h.kanDraw = false;
  h.flowerDraw = false;
  h.lastDiscard = { seat, tile };
  h.discardCount++;
  h.turnsTaken[seat]++;
  const ev = { e: 'discard', seat, tile };
  if (ready) {
    h.ready[seat] = true;
    ev.ready = true;
  }
  events.push(ev);
  if (h.wildMask[tile] && !match.settings.caishenDiscardClaimable) return drawTile(match, (seat + 1) % 4, 'wall', events);
  return openClaimWindow(match, seat, tile, false, events);
}

function openClaimWindow(match, from, tile, rob, events) {
  const h = match.hand;
  const options = [null, null, null, null];
  let any = false;
  for (let d = 1; d < 4; d++) {
    const s = (from + d) % 4;
    options[s] = rob ? robOptionsFor(match, s, from, tile) : claimOptionsFor(match, s, from, tile);
    if (options[s]) any = true;
  }
  if (!any) {
    if (rob) return completeBuKan(match, from, tile, events);
    return drawTile(match, (from + 1) % 4, 'wall', events);
  }
  h.stage = 'claim';
  h.turn = from;
  h.claim = { from, tile, rob, options, responses: [null, null, null, null] };
  return undefined;
}

const RANK = { hu: 3, pon: 2, kan: 2, chi: 1, pass: 0 };

function multiAllowed(cfg, rob) {
  if (rob && cfg.qianggang && typeof cfg.qianggang.multi === 'boolean') return cfg.qianggang.multi;
  return cfg.multiWin !== false;
}

function maybeResolveClaims(match, events) {
  const h = match.hand;
  const c = h.claim;
  const cfg = match.settings;
  const multi = multiAllowed(cfg, c.rob);
  const order = [1, 2, 3].map((d) => (c.from + d) % 4);
  const dist = (s) => (s - c.from + 4) % 4;
  let best = null;
  for (const s of order) {
    const r = c.responses[s];
    if (!r || r.type === 'pass') continue;
    if (!best || RANK[r.type] > best.rank) best = { rank: RANK[r.type], seat: s, action: r };
  }
  // Wait only for seats whose answer could still change the outcome.
  for (const u of order) {
    const o = c.options[u];
    if (!o || c.responses[u]) continue;
    const pot = o.hu ? 3 : o.pon || o.kan.length ? 2 : o.chi.length ? 1 : 0;
    if (o.hu && multi) return;
    if (!best || pot > best.rank) return;
    if (pot === 3 && best.rank === 3 && dist(u) < dist(best.seat)) return;
  }
  for (const s of order) {
    const r = c.responses[s];
    const o = c.options[s];
    if (!o || !r) continue;
    if (cfg.passHuLock && o.hu && r.type !== 'hu') h.passedHu[s] = h.passedHu[s].concat([c.tile]);
    if (o.pon && r.type !== 'pon' && r.type !== 'hu') h.passedPon[s] = h.passedPon[s].concat([c.tile]);
  }
  h.claim = null;
  if (best && best.rank === 3) {
    const winners = multi ? order.filter((s) => c.responses[s] && c.responses[s].type === 'hu') : [best.seat];
    return finishWin(match, winners, c.from, false, c.tile, c.rob, events);
  }
  if (c.rob) return completeBuKan(match, c.from, c.tile, events);
  if (!best) return drawTile(match, (c.from + 1) % 4, 'wall', events);
  const seat = best.seat;
  const a = best.action;
  h.discards[c.from].pop();
  h.lastDiscard = null;
  h.claimCount++;
  h.drawn = [null, null, null, null];
  if (a.type === 'pon') {
    removeTiles(h.hands[seat], c.tile, 2);
    h.melds[seat].push({ type: 'pon', tiles: [c.tile, c.tile, c.tile], from: c.from, claimed: c.tile });
    events.push({ e: 'claim', seat, type: 'pon', tiles: [c.tile, c.tile, c.tile], from: c.from });
    startClaimedTurn(h, seat);
    return undefined;
  }
  if (a.type === 'kan') {
    removeTiles(h.hands[seat], c.tile, 3);
    const tiles = [c.tile, c.tile, c.tile, c.tile];
    h.melds[seat].push({ type: 'mingkan', tiles, from: c.from, claimed: c.tile });
    h.kanCount++;
    events.push({ e: 'claim', seat, type: 'kan', tiles: tiles.slice(), from: c.from });
    events.push({ e: 'kan', seat, kind: 'mingkan', tile: c.tile });
    startClaimedTurn(h, seat);
    return drawTile(match, seat, 'kan', events);
  }
  for (const t of a.tiles) if (t !== c.tile) removeTiles(h.hands[seat], t, 1);
  h.melds[seat].push({ type: 'chi', tiles: a.tiles.slice(), from: c.from, claimed: c.tile });
  events.push({ e: 'claim', seat, type: 'chi', tiles: a.tiles.slice(), from: c.from });
  startClaimedTurn(h, seat);
  if (cfg.chiDiscardRestriction) h.noDiscard[seat] = c.tile;
  return undefined;
}

function startClaimedTurn(h, seat) {
  h.turn = seat;
  h.stage = 'discard';
  h.drawSource = null;
  h.kanDraw = false;
  h.flowerDraw = false;
}

function anKanEventTile(cfg, k) {
  return cfg.revealAnKan || cfg.revealOneOfAnGang ? k : null;
}

function doAnKan(match, seat, k, events) {
  const h = match.hand;
  removeTiles(h.hands[seat], k, 4);
  h.melds[seat].push({ type: 'ankan', tiles: [k, k, k, k], from: null });
  h.kanCount++;
  h.drawn[seat] = null;
  events.push({ e: 'kan', seat, kind: 'ankan', tile: anKanEventTile(match.settings, k) });
  return drawTile(match, seat, 'kan', events);
}

function declareBuKan(match, seat, k, events) {
  const h = match.hand;
  h.drawn[seat] = null;
  h.drawSource = null;
  events.push({ e: 'kan', seat, kind: 'bukan', tile: k });
  if (match.settings.robKong !== false) return openClaimWindow(match, seat, k, true, events);
  return completeBuKan(match, seat, k, events);
}

function completeBuKan(match, seat, k, events) {
  const h = match.hand;
  removeTiles(h.hands[seat], k, 1);
  const meld = h.melds[seat].find((m) => m.type === 'pon' && m.tiles[0] === k);
  meld.type = 'bukan';
  meld.tiles = [k, k, k, k];
  h.kanCount++;
  h.drawn[seat] = null;
  return drawTile(match, seat, 'kan', events);
}

// ---------------------------------------------------------------------------
// Hand end

function revealHands(h) {
  return h.hands.map((x) => sortTiles(x));
}

function tenpaiSeats(match) {
  const h = match.hand;
  const cfg = match.settings;
  return [0, 1, 2, 3].map((s) => {
    const { counts, jokers } = splitHand(h.hands[s], h.wilds);
    const mc = h.melds[s].length;
    const waits = (c, j) => waitsForCounts(c, mc, cfg, j, h.playKinds, h.wilds).length > 0;
    if (h.hands[s].length % 3 !== 2) return waits(counts, jokers);
    // Hand ended on this seat's own turn: tenpai if some discard leaves a wait.
    if (jokers && waits(counts, jokers - 1)) return true;
    for (let k = 0; k < 34; k++) {
      if (!counts[k]) continue;
      counts[k]--;
      const ok = waits(counts, jokers);
      counts[k]++;
      if (ok) return true;
    }
    return false;
  });
}

function finishWin(match, winners, loser, selfDraw, winTile, robKong, events) {
  const h = match.hand;
  const cfg = match.settings;
  const rs = getRuleset(cfg.ruleset);
  const details = winners.map((w) => {
    const ctx = scoreCtxFor(match, w, winTile, selfDraw, loser, robKong);
    const sc = rs.score(ctx);
    return { seat: w, score: sc, ctx };
  });
  for (const w of winners) events.push({ e: 'hu', seat: w, from: selfDraw ? null : loser, selfDraw, robbed: !!robKong });
  const hands = revealHands(h);
  if (!selfDraw) {
    for (const w of winners) hands[w] = sortTiles(hands[w].concat([winTile]));
    if (robKong) {
      const i = hands[loser].indexOf(winTile);
      if (i >= 0) hands[loser].splice(i, 1);
    }
  }
  const st = rs.settle({
    type: 'win',
    settings: cfg,
    baseScore: cfg.baseScore,
    dealer: h.dealer,
    dealerStreak: match.dealerStreak,
    seatWinds: h.seatWinds.slice(),
    roundWind: h.roundWind,
    handNo: match.handNo,
    winners: details.map((d) => ({ seat: d.seat, ...d.score, items: d.score.items, total: d.score.total, ctx: d.ctx })),
    loser: selfDraw ? null : loser,
    selfDraw,
    robKong: !!robKong,
    winTile,
    melds: h.melds,
    flowers: h.flowers,
    scores: match.scores.slice(),
  });
  const pick = (key) => details.map((d) => (d.score[key] === undefined ? null : d.score[key]));
  const result = {
    type: 'win',
    winners: winners.slice(),
    loser: selfDraw ? null : loser,
    selfDraw,
    winTile,
    items: details.map((d) => d.score.items),
    total: details.map((d) => d.score.total),
    hua: pick('hua'),
    fan: pick('fan'),
    points: pick('points'),
    special: pick('special'),
    baoSeat: st.baoSeat ?? null,
    details: details.map((d) => ({
      seat: d.seat,
      items: d.score.items,
      total: d.score.total,
      hua: d.score.hua ?? null,
      fan: d.score.fan ?? null,
      points: d.score.points ?? null,
      special: d.score.special ?? null,
      baoSeat: (st.baoSeats && st.baoSeats[d.seat]) ?? null,
    })),
    deltas: [0, 0, 0, 0],
    hands,
    robKong: !!robKong,
    robbed: !!robKong,
    indicator: h.indicator,
    wilds: h.wilds.slice(),
    handNo: match.handNo,
    dealer: h.dealer,
  };
  closeHand(match, result, st, events);
}

function endExhausted(match, events) {
  const h = match.hand;
  if (match.phase !== 'playing') return;
  const cfg = match.settings;
  const rs = getRuleset(cfg.ruleset);
  const tenpai = tenpaiSeats(match);
  const st = rs.settle({
    type: 'draw',
    settings: cfg,
    baseScore: cfg.baseScore,
    dealer: h.dealer,
    dealerStreak: match.dealerStreak,
    seatWinds: h.seatWinds.slice(),
    roundWind: h.roundWind,
    handNo: match.handNo,
    winners: [],
    loser: null,
    selfDraw: false,
    robKong: false,
    winTile: null,
    tenpai,
    melds: h.melds,
    flowers: h.flowers,
    scores: match.scores.slice(),
  });
  const result = {
    type: 'draw',
    winners: [],
    loser: null,
    selfDraw: false,
    winTile: null,
    items: [],
    total: [],
    hua: [],
    fan: [],
    points: [],
    special: [],
    baoSeat: null,
    details: [],
    deltas: [0, 0, 0, 0],
    hands: revealHands(h),
    tenpai,
    robKong: false,
    robbed: false,
    indicator: h.indicator,
    wilds: h.wilds.slice(),
    handNo: match.handNo,
    dealer: h.dealer,
  };
  closeHand(match, result, st, events);
}

function closeHand(match, result, st, events) {
  const h = match.hand;
  const deltas = (st.deltas || [0, 0, 0, 0]).map((d) => Math.round(d * 100) / 100 + 0);
  result.deltas = deltas;
  for (let s = 0; s < 4; s++) match.scores[s] = Math.round((match.scores[s] + deltas[s]) * 100) / 100 + 0;
  let next = st.nextDealer;
  if (!Number.isInteger(next)) next = st.dealerContinues ? h.dealer : (h.dealer + 1) % 4;
  result.dealerContinues = next === h.dealer;
  result.nextDealer = next;
  if (next === h.dealer) {
    match.dealerStreak += 1;
  } else {
    match.dealerStreak = 0;
    match.dealerPasses += 1;
    match.roundWind = Math.floor(match.dealerPasses / 4) % 4;
  }
  match.dealer = next;
  const per = match.settings.handsPerSession;
  if (Number.isInteger(per) && per > 0 && match.handNo >= per) match.matchOver = true;
  h.stage = 'over';
  h.claim = null;
  h.drawn = [null, null, null, null];
  match.phase = 'over';
  match.result = result;
  match.history.push({
    handNo: result.handNo,
    dealer: result.dealer,
    type: result.type,
    winners: result.winners.slice(),
    loser: result.loser,
    selfDraw: result.selfDraw,
    total: result.total.slice(),
    deltas: deltas.slice(),
  });
  events.push({ e: 'handOver', result });
}

export function isHandOver(match) {
  return !!match && match.phase === 'over';
}

/** True once handsPerSession hands have been played (and the last one is over). */
export function isMatchOver(match) {
  return !!match && match.phase !== 'playing' && !!match.matchOver;
}

// ---------------------------------------------------------------------------
// Views (what one seat may see; safe to send over the network)

function publicMeld(m, own, cfg, over) {
  const out = { type: m.type, tiles: m.tiles.slice(), from: m.from ?? null };
  if (m.claimed !== undefined) out.claimed = m.claimed;
  if (m.type === 'ankan' && !own && !over && !cfg.revealAnKan) {
    out.tiles = cfg.revealOneOfAnGang ? [-1, m.tiles[0], -1, -1] : [-1, -1, -1, -1];
  }
  return out;
}

function sessionInfo(match) {
  const per = match.settings.handsPerSession;
  return { handsPerSession: Number.isInteger(per) && per > 0 ? per : null, handsPlayed: match.history.length };
}

export function getView(match, seat) {
  const h = match.hand;
  const cfg = match.settings;
  const base = {
    game: GAME_ID,
    seat,
    handNo: match.handNo,
    phase: match.phase,
    dealer: h ? h.dealer : match.dealer,
    roundWind: h ? h.roundWind : 27 + (match.roundWind % 4),
    seatWinds: h ? h.seatWinds.slice() : [0, 1, 2, 3].map((s) => 27 + ((s - match.dealer + 4) % 4)),
  };
  const extra = {
    dealerStreak: match.dealerStreak,
    rulesetName: getRuleset(cfg.ruleset).name,
    session: sessionInfo(match),
    matchOver: !!match.matchOver,
  };
  if (!h) {
    return {
      ...base,
      wallCount: 0,
      hand: [],
      drawn: null,
      counts: [0, 0, 0, 0],
      melds: emptyQuad(),
      flowers: emptyQuad(),
      discards: emptyQuad(),
      lastDiscard: null,
      turn: match.dealer,
      stage: 'over',
      options: null,
      scores: match.scores.slice(),
      settings: cfg,
      seq: match.seq,
      result: null,
      indicator: null,
      wilds: [],
      dice: null,
      ready: [false, false, false, false],
      claim: null,
      waits: [],
      ...extra,
    };
  }
  const own = sortTiles(h.hands[seat]);
  const drawn = h.drawn[seat];
  if (drawn != null) own.splice(own.indexOf(drawn), 1);
  let waits = [];
  if (h.hands[seat].length % 3 === 1 && match.phase === 'playing') {
    const { counts, jokers } = splitHand(h.hands[seat], h.wilds);
    waits = waitsForCounts(counts, h.melds[seat].length, cfg, jokers, h.playKinds, h.wilds);
  }
  const over = match.phase === 'over';
  return {
    ...base,
    wallCount: liveWallCount(h),
    hand: own,
    drawn: drawn ?? null,
    counts: h.hands.map((x) => x.length),
    melds: h.melds.map((ms, s) => ms.map((m) => publicMeld(m, s === seat, cfg, over))),
    flowers: h.flowers.map((f) => f.slice()),
    discards: h.discards.map((d) => d.slice()),
    lastDiscard: h.lastDiscard ? { ...h.lastDiscard } : null,
    turn: h.turn,
    stage: h.stage,
    options: getLegalActions(match, seat),
    scores: match.scores.slice(),
    settings: cfg,
    seq: match.seq,
    result: match.result,
    indicator: h.indicator,
    wilds: h.wilds.slice(),
    dice: h.dice.slice(),
    ready: h.ready.slice(),
    claim: h.stage === 'claim' && h.claim ? { seat: h.claim.from, tile: h.claim.tile, rob: h.claim.rob } : null,
    waits,
    ...extra,
  };
}
