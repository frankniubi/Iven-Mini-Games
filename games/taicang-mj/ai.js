/**
 * Mahjong bot. Sees only its own view (getView output) and returns a legal action.
 * Discards: minimise shanten, then maximise effective tiles (进张) over unseen copies,
 * keep 财神, shed isolated honours/terminals early, and defend when someone looks close.
 */

import { shantenCounts, splitHand, tileCountsFor, flowerKindsFor, getRuleset, isSuited, isWind, createRng } from './engine.js';

const suitOf = (k) => (k < 27 ? Math.floor(k / 9) : -1);

export function botAction(view, memory = {}, opts = {}) {
  const o = view && view.options;
  if (!o) return null;
  const level = opts.level || (view.settings && view.settings.botLevel) || 'normal';
  const rng = opts.rng || createRng(`${view.handNo}:${view.seq}:${view.seat}`);
  if (o.hu) return { type: 'hu' };
  try {
    const A = analyse(view, level);
    if (o.discard) return ownTurn(view, o, A, level, rng);
    return claimTurn(view, o, A, level, rng);
  } catch {
    // Never leave a seat stuck: fall back to the simplest legal move.
    if (o.discard) return { type: 'discard', tile: view.drawn != null && o.discardTiles.includes(view.drawn) ? view.drawn : o.discardTiles[o.discardTiles.length - 1] };
    return { type: 'pass' };
  }
}

// ---------------------------------------------------------------------------

function analyse(view, level) {
  const seat = view.seat;
  const cfg = view.settings || {};
  const wilds = view.wilds || [];
  const tiles = view.hand.concat(view.drawn != null ? [view.drawn] : []);
  const { counts, jokers } = splitHand(tiles, wilds);
  const meldCount = view.melds[seat].length;
  const full = tileCountsFor(cfg);
  const flowerSet = new Set(flowerKindsFor(cfg));
  const visible = new Array(34).fill(0);
  for (const t of tiles) if (t < 34) visible[t]++;
  for (const ms of view.melds) for (const m of ms) for (const t of m.tiles) if (t >= 0 && t < 34) visible[t]++;
  for (const d of view.discards) for (const t of d) if (t < 34) visible[t]++;
  if (view.indicator != null && view.indicator < 34) visible[view.indicator]++;
  const unseen = new Array(34).fill(0);
  const playable = [];
  for (let k = 0; k < 34; k++) {
    if (wilds.includes(k)) continue;
    if (flowerSet.has(k) || !full[k]) continue;
    unseen[k] = Math.max(0, full[k] - visible[k]);
    playable.push(k);
  }
  const sopts = { sevenPairs: cfg.sevenPairs !== false, sevenPairsFour: cfg.sevenPairsFour !== false, thirteenOrphans: !!cfg.thirteenOrphans };
  const rs = getRuleset(cfg.ruleset);
  const hint = rs.aiHint || {};
  return {
    seat,
    cfg,
    wilds,
    tiles,
    counts,
    jokers,
    meldCount,
    visible,
    unseen,
    playable,
    sopts,
    hint,
    threats: level === 'easy' ? [] : findThreats(view, cfg, hint, level),
  };
}

function sh(A, counts, mc, j) {
  return shantenCounts(counts, mc, { ...A.sopts, jokers: j });
}

function relevantKinds(A, counts, jokers) {
  if (jokers > 0) return A.playable;
  const out = [];
  for (const k of A.playable) {
    if (counts[k]) {
      out.push(k);
      continue;
    }
    if (!isSuited(k)) continue;
    const r = k % 9;
    if ((r >= 1 && counts[k - 1]) || (r >= 2 && counts[k - 2]) || (r <= 7 && counts[k + 1]) || (r <= 6 && counts[k + 2])) out.push(k);
  }
  return out;
}

function ukeire(A, counts, mc, j, s, kinds) {
  let u = 0;
  for (const k of kinds) {
    if (!A.unseen[k] || counts[k] >= 4) continue;
    counts[k]++;
    if (sh(A, counts, mc, j) < s) u += A.unseen[k];
    counts[k]--;
  }
  return u;
}

/** Best discard from a 3n+2 shape: { tile, s, u } (naturals only). */
function bestDiscardOf(A, counts, mc, j) {
  let best = null;
  const kinds = relevantKinds(A, counts, j);
  for (let d = 0; d < 34; d++) {
    if (!counts[d]) continue;
    counts[d]--;
    const s = sh(A, counts, mc, j);
    if (!best || s <= best.s) {
      const u = ukeire(A, counts, mc, j, s, kinds);
      if (!best || s < best.s || u > best.u) best = { tile: d, s, u };
    }
    counts[d]++;
  }
  return best || { tile: null, s: sh(A, counts, mc, j), u: 0 };
}

// ---------------------------------------------------------------------------
// Defense

function visibleHuaOf(view, p) {
  let hua = view.flowers[p].length;
  for (const m of view.melds[p]) {
    const k = m.tiles.find((t) => t >= 0);
    if (m.type === 'ankan') hua += 2;
    else if (m.type === 'mingkan' || m.type === 'bukan') hua += k !== undefined && isWind(k) ? 2 : 1;
    else if (m.type === 'pon' && k !== undefined && isWind(k)) hua += 1;
  }
  return hua;
}

function findThreats(view, cfg, hint, level) {
  const out = [];
  const late = view.wallCount < 16;
  for (let p = 0; p < 4; p++) {
    if (p === view.seat) continue;
    const melds = view.melds[p];
    const n = melds.length;
    let w = 0;
    if (view.ready && view.ready[p]) w = 1;
    if (n >= 3) w = Math.max(w, 1);
    else if (n === 2 && view.wallCount < 40) w = Math.max(w, 0.5);
    if (late) w = Math.max(w, 0.35);
    if (!w) continue;
    const suits = new Set();
    for (const m of melds) {
      const k = m.tiles.find((t) => t >= 0);
      if (k !== undefined && isSuited(k)) suits.add(suitOf(k));
    }
    const flushSuit = n >= 2 && suits.size === 1 ? [...suits][0] : null;
    // 二花自摸三花冲: an open hand short of 花 can only ron with a pattern (flush, all pungs).
    if (hint.minHuaGate && n > 0 && flushSuit === null && level !== 'easy') {
      const allPon = melds.every((m) => m.type !== 'chi');
      if (visibleHuaOf(view, p) < (cfg.minHuaDiscard ?? 3) && !allPon) w *= 0.35;
    }
    out.push({ seat: p, w, flushSuit });
  }
  return out;
}

function dangerOf(view, A, k, level) {
  if (!A.threats.length) return 0;
  if (A.wilds.includes(k) && !A.cfg.caishenDiscardClaimable) return 0;
  let worst = 0;
  for (const t of A.threats) {
    const river = view.discards[t.seat];
    if (river.includes(k)) continue;
    let d;
    if (!isSuited(k)) {
      const v = A.visible[k];
      d = v >= 3 ? 0.05 : v === 2 ? 0.3 : 0.6;
    } else {
      const r = k % 9;
      d = r === 0 || r === 8 ? 0.55 : r === 1 || r === 7 ? 0.75 : 1;
      if ((r >= 3 && river.includes(k - 3)) || (r <= 5 && river.includes(k + 3))) d *= 0.6;
      if (level === 'hard' && A.visible[k] >= 3) d *= 0.7;
      if (t.flushSuit !== null) d *= suitOf(k) === t.flushSuit ? 1.6 : 0.3;
    }
    worst = Math.max(worst, d * t.w);
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Own turn

function isValueTile(A, view, k) {
  if (A.cfg.ruleset === 'TAICANG') return isWind(k);
  return (k >= 31 && k <= 33) || k === view.seatWinds[A.seat] || k === view.roundWind;
}

function ownTurn(view, o, A, level, rng) {
  const { counts, meldCount: mc } = A;
  let J = A.jokers;
  const cands = [];
  const kinds = relevantKinds(A, counts, J);
  for (const d of o.discardTiles) {
    const wild = A.wilds.includes(d);
    let s;
    let u;
    if (wild) {
      s = sh(A, counts, mc, J - 1);
      u = ukeire(A, counts, mc, J - 1, s, kinds);
    } else {
      if (d >= 34 || !counts[d]) continue;
      counts[d]--;
      s = sh(A, counts, mc, J);
      u = ukeire(A, counts, mc, J, s, kinds);
      counts[d]++;
    }
    cands.push({ tile: d, s, u, wild });
  }
  if (!cands.length) return { type: 'discard', tile: o.discardTiles[0] };
  const bestS = Math.min(...cands.map((c) => c.s));

  // Kongs: take them when they do not set the hand back.
  for (const kt of o.kanTypes || []) {
    if (level === 'easy' && rng() < 0.3) break;
    const c2 = counts.slice();
    let s2;
    if (kt.type === 'ankan') {
      c2[kt.tile] -= 4;
      s2 = sh(A, c2, mc + 1, J);
    } else {
      c2[kt.tile] -= 1;
      s2 = sh(A, c2, mc, J);
    }
    if (s2 <= bestS) return { type: 'kan', tile: kt.tile };
  }

  const maxW = A.threats.reduce((m, t) => Math.max(m, t.w), 0);
  let dangerWeight = 0;
  if (maxW > 0) dangerWeight = (bestS >= 2 ? 3000 : bestS === 1 ? 400 : 150) * maxW * (level === 'hard' ? 1.3 : 1);
  const early = view.wallCount > 40;
  const flushSuit = level === 'hard' ? flushTarget(A) : null;

  for (const c of cands) {
    let score = -c.s * 1000 + c.u * 4;
    if (c.wild && A.hint.keepWilds !== false) score -= 100000;
    const k = c.tile;
    if (!c.wild && k < 34) {
      const isolated = counts[k] === 1 && !(isSuited(k) && neighbours(counts, k));
      if (isolated && !isSuited(k)) score += isValueTile(A, view, k) && !early ? 2 : 6;
      else if (isolated && (k % 9 === 0 || k % 9 === 8)) score += 3;
      if (flushSuit !== null) score += suitOf(k) === flushSuit ? -12 : isSuited(k) ? 10 : 0;
    }
    score -= dangerWeight * dangerOf(view, A, k, level);
    c.score = score;
  }
  cands.sort((a, b) => b.score - a.score || a.tile - b.tile);
  let pick = cands[0];
  if (level === 'easy') {
    const tied = cands.filter((c) => c.s === bestS && !c.wild);
    if (tied.length && rng() < 0.35) pick = tied[Math.floor(rng() * tied.length)];
  }
  const action = { type: 'discard', tile: pick.tile };
  if (A.cfg.declareReady && o.readyDiscards && o.readyDiscards.includes(pick.tile) && (A.cfg.readyRequired || level !== 'easy')) action.ready = true;
  return action;
}

function neighbours(counts, k) {
  const r = k % 9;
  return (r >= 1 && counts[k - 1]) || (r >= 2 && counts[k - 2]) || (r <= 7 && counts[k + 1]) || (r <= 6 && counts[k + 2]);
}

function flushTarget(A) {
  const per = [0, 0, 0];
  let total = 0;
  for (let k = 0; k < 27; k++) {
    per[suitOf(k)] += A.counts[k];
    total += A.counts[k];
  }
  const best = per.indexOf(Math.max(...per));
  return total >= 8 && per[best] >= total - 2 ? best : null;
}

// ---------------------------------------------------------------------------
// Claims

function openHandOk(view, A, claimKind, claimType) {
  if (!A.hint.minHuaGate) return true;
  const cfg = A.cfg;
  const seat = A.seat;
  const concealedNow = view.melds[seat].every((m) => m.type === 'ankan');
  let hua = visibleHuaOf(view, seat);
  if (claimType === 'pon' && isWind(claimKind)) hua += 1;
  if (claimType === 'kan') hua += isWind(claimKind) ? 2 : 1;
  for (let k = 27; k < 31; k++) if (A.counts[k] >= 3 || (A.counts[k] === 2 && k !== claimKind)) hua += A.counts[k] >= 3 ? 1 : 0.5;
  // Never throw away a closed 无花果 chase or 门清 exemption for a hand that cannot reach 2 花.
  if (concealedNow && view.flowers[seat].length === 0 && hua < 1) return false;
  if (hua >= (cfg.minHuaSelfDraw ?? 2)) return true;
  // Patterns that lift the 花 gate: flush or all pungs.
  const per = [0, 0, 0];
  let suited = 0;
  for (let k = 0; k < 27; k++) {
    per[suitOf(k)] += A.counts[k];
    suited += A.counts[k];
  }
  for (const m of view.melds[seat]) {
    const k = m.tiles.find((t) => t >= 0);
    if (k !== undefined && isSuited(k)) {
      per[suitOf(k)] += 3;
      suited += 3;
    }
  }
  if (isSuited(claimKind)) {
    per[suitOf(claimKind)] += 1;
    suited += 1;
  }
  const flush = suited > 0 && Math.max(...per) >= suited - 1;
  if (flush) return true;
  if (claimType !== 'chi' && view.melds[seat].every((m) => m.type !== 'chi')) {
    let pairs = 0;
    for (let k = 0; k < 34; k++) if (A.counts[k] >= 2) pairs++;
    if (pairs + view.melds[seat].length >= 4) return true;
  }
  return false;
}

function claimTurn(view, o, A, level, rng) {
  const pass = { type: 'pass' };
  const t = view.claim ? view.claim.tile : view.lastDiscard ? view.lastDiscard.tile : null;
  if (t === null || t === undefined || t >= 34) return pass;
  const { counts, meldCount: mc, jokers: J } = A;
  const s0 = sh(A, counts, mc, J);
  const maxW = A.threats.reduce((m, x) => Math.max(m, x.w), 0);
  if (maxW >= 0.5 && s0 >= 2 && level !== 'easy') return pass;
  const cands = [];
  if (o.kan && o.kan.includes(t)) {
    const c2 = counts.slice();
    c2[t] -= 3;
    const s2 = sh(A, c2, mc + 1, J);
    if (s2 <= s0 && openHandOk(view, A, t, 'kan')) cands.push({ action: { type: 'kan', tile: t }, s: s2, u: 99, pri: 2 });
  }
  if (o.pon) {
    const c2 = counts.slice();
    c2[t] -= 2;
    const b = bestDiscardOf(A, c2, mc + 1, J);
    const worth = b.s < s0 || (b.s === s0 && isValueTile(A, view, t) && level !== 'easy');
    if (worth && openHandOk(view, A, t, 'pon')) cands.push({ action: { type: 'pon' }, s: b.s, u: b.u, pri: 1 });
  }
  for (const combo of o.chi || []) {
    const c2 = counts.slice();
    for (const k of combo) if (k !== t) c2[k]--;
    const b = bestDiscardOf(A, c2, mc + 1, J);
    if (b.s < s0 && openHandOk(view, A, t, 'chi')) cands.push({ action: { type: 'chi', tiles: combo.slice() }, s: b.s, u: b.u, pri: 0 });
  }
  if (!cands.length) return pass;
  if (level === 'easy' && rng() < 0.5) return pass;
  cands.sort((a, b) => a.s - b.s || b.pri - a.pri || b.u - a.u);
  return cands[0].action;
}
