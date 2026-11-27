/**
 * Rulesets consumed by engine.js. A ruleset = default options (merged into match.settings)
 * + hooks:
 *   score(ctx)        -> { items:[{name, value, unit}], total, canWin, hua?, fan?, points?, special? }
 *   settle(sctx)      -> { deltas:[4], dealerContinues?, nextDealer?, baoSeat?, baoSeats? }
 *   tileCounts(cfg)   -> copies per kind (length 44)        (optional)
 *   flowerKinds(cfg)  -> kinds treated as 花                (optional)
 *   specialWin(sctx)  -> { type } | null, e.g. 辣子          (optional)
 *   aiHint            -> hints for ai.js                     (optional)
 * Hooks only run on the host; they must be pure and deterministic.
 */

import { isWind, isSuited } from './engine.js';

export const DEFAULT_RULESET = 'TAICANG';

const suitOf = (k) => (k < 27 ? Math.floor(k / 9) : -1);
const isDragon = (k) => k >= 31 && k <= 33;

// ---------------------------------------------------------------------------
// GENERIC: 江南通用 (136 + 8 花, 吃碰杠, 抢杠胡, 七对, simple additive scoring)

const GENERIC_OPTIONS = {
  caishen: 'none',
  honors: true,
  flowers: true,
  honorsAsFlowers: false,
  allowChi: true,
  allowPon: true,
  allowKan: true,
  robKong: true,
  multiWin: true,
  passHuLock: false,
  passHuScope: 'any',
  passPengLock: 'off',
  sevenPairs: true,
  sevenPairsFour: true,
  thirteenOrphans: false,
  declareReady: false,
  readyRequired: false,
  readyConcealedOnly: false,
  reservedTiles: 0,
  dealerDraws: false,
  revealAnKan: false,
  revealOneOfAnGang: false,
  claimOnLastTile: false,
  chiDiscardRestriction: false,
  firstDealer: 0,
  handsPerSession: null,
  minScore: 0,
  maxScore: 0,
  dealerStaysOnDraw: true,
  dealerStaysOnWin: true,
};

function genericForm(ctx, d) {
  const suits = new Set();
  let honors = false;
  let allPungs = !!d;
  let pts = 0;
  const items = [];
  const add = (name, value) => {
    items.push({ name, value, unit: '分' });
    pts += value;
  };
  const pungKinds = [];
  for (const m of ctx.melds) {
    const k = m.tiles[0];
    if (k >= 27) honors = true;
    else suits.add(suitOf(k));
    if (m.type === 'chi') allPungs = false;
    else pungKinds.push(k);
  }
  if (d) {
    for (const s of d.sets) {
      if (s.type === 'any') continue;
      if (s.tile >= 27) honors = true;
      else suits.add(suitOf(s.tile));
      if (s.type === 'chow') allPungs = false;
      else pungKinds.push(s.tile);
    }
    if (d.pair !== null) {
      if (d.pair >= 27) honors = true;
      else suits.add(suitOf(d.pair));
    }
  } else {
    for (let k = 0; k < 34; k++) {
      if (!ctx.counts[k]) continue;
      if (k >= 27) honors = true;
      else suits.add(suitOf(k));
    }
  }
  for (const k of pungKinds) {
    if (isDragon(k)) add(`箭刻·${['红中', '发财', '白板'][k - 31]}`, 1);
    if (k === ctx.seatWind) add('门风刻', 1);
    if (k === ctx.roundWind) add('圈风刻', 1);
  }
  if (allPungs) add('对对胡', 2);
  if (!d && ctx.sevenPairs) add('七对', 2);
  if (!d && ctx.thirteenOrphans) add('十三幺', 13);
  if (suits.size === 1 && !honors) add('清一色', 4);
  else if (suits.size === 1 && honors) add('混一色', 2);
  if (d && ctx.waits.length === 1 && d.waitTypes.some((t) => t === 'single' || t === 'closed' || t === 'edge')) {
    add(d.waitTypes.includes('single') ? '单吊' : d.waitTypes.includes('closed') ? '嵌张' : '边张', 1);
  }
  return { items, pts };
}

function genericScore(ctx) {
  const cfg = ctx.settings;
  const base = [];
  let baseTotal = 0;
  const add = (name, value) => {
    if (!value) return;
    base.push({ name, value, unit: '分' });
    baseTotal += value;
  };
  add('胡牌', 1);
  add('花牌', ctx.flowers.length);
  if (ctx.selfDraw) add('自摸', 1);
  if (ctx.concealedHand) add('门清', 1);
  for (const m of ctx.melds) {
    if (m.type === 'ankan') add('暗杠', 2);
    if (m.type === 'mingkan' || m.type === 'bukan') add('明杠', 1);
  }
  if (ctx.kongReplacement) add('杠开', 1);
  else if (ctx.flowerReplacement) add('花开', 1);
  if (ctx.lastTile) add(ctx.selfDraw ? '海底捞月' : '河底捞鱼', 1);
  if (ctx.robKong) add('抢杠', 1);
  if (ctx.firstTurn) add(ctx.isDealer && ctx.selfDraw ? '天胡' : '地胡', 8);
  const forms = ctx.decompositions.map((d) => genericForm(ctx, d));
  if (ctx.sevenPairs || ctx.thirteenOrphans) forms.push(genericForm(ctx, null));
  if (!forms.length) forms.push({ items: [], pts: 0 });
  forms.sort((a, b) => b.pts - a.pts);
  let total = baseTotal + forms[0].pts;
  const items = base.concat(forms[0].items);
  const cap = cfg.maxScore | 0;
  if (cap > 0 && total > cap) {
    items.push({ name: '封顶', value: cap, unit: '分' });
    total = cap;
  }
  return { items, total, points: total, canWin: total >= (cfg.minScore | 0) };
}

function genericSettle(s) {
  const deltas = [0, 0, 0, 0];
  const cfg = s.settings;
  const unit = Number(cfg.baseScore) || 1;
  if (s.type === 'draw') return { deltas, dealerContinues: cfg.dealerStaysOnDraw !== false };
  for (const w of s.winners) {
    const amt = w.total * unit;
    if (s.selfDraw) {
      for (let p = 0; p < 4; p++) {
        if (p === w.seat) continue;
        deltas[p] -= amt;
        deltas[w.seat] += amt;
      }
    } else {
      deltas[s.loser] -= amt;
      deltas[w.seat] += amt;
    }
  }
  const dealerWon = s.winners.some((w) => w.seat === s.dealer);
  return { deltas, dealerContinues: dealerWon && cfg.dealerStaysOnWin !== false };
}

export const GENERIC = {
  id: 'GENERIC',
  name: '江南通用麻将',
  description: '136 张 + 8 张花牌，可吃碰杠，抢杠胡，七对，简单加分计分',
  options: GENERIC_OPTIONS,
  score: genericScore,
  settle: genericSettle,
  aiHint: { keepWilds: true },
};

// ---------------------------------------------------------------------------
// TAICANG: 太仓麻将 (docs/taicang-mahjong-rules.md §10.1 defaults)

const TAICANG_OPTIONS = {
  // 牌与财神
  caishen: 'flip-next',
  diceMode: 'tcy',
  caishenInMelds: false,
  caishenDiscardClaimable: false,
  caishenBlocksDiscardWin: true,
  caishenGuiweiAllowsDiscardWin: false,
  reservedTiles: 0,

  // 起胡
  minHuaSelfDraw: 2,
  minHuaDiscard: 3,
  minHuaIncludesDihua: false,
  minHuaCountsSoftHua: true,
  minHuaExemption: 'any-fan',
  qianggangMinHua: 'zimo',

  // 计分
  scoringModel: 'taicang-fan',
  dihua: 1,
  huaValues: { hardHua: 1, suitMingGang: 1, suitAnGang: 2, windKe: 1, windMingGang: 2, windAnGang: 3 },
  fan: { menqing: 1, hunyise: 1, qingyise: 2, duiduihu: 1, qidui: 1, gangkai: 1, dadiaoche: 1 },
  menqingAllowsMingGang: false,
  qiduiStacksMenqing: true,
  dadiaocheAllowsChi: true,
  capHua: 100,
  wuhuaguoHua: 100,
  wuhuaguoAllowDiscard: true,
  lazi: { enabled: true },
  tianDiHu: 'none',
  haidiFan: 0,
  pointsPerHua: 1,

  // 收付
  chengbao: { enabled: true, threshold: 3, countsGang: true, multiplier: 5, onDiscard: 'off' },
  qianggang: { payerShares: 3, multi: true, kongerDealsNext: true },
  multiWin: true,
  multiWinDealer: 'first-after-discarder',
  baoJiaozi: false,
  baoziDiling: false,
  piao: { enabled: false, options: [0, 1, 2, 3] },
  baiGangtou: false,

  // 流程
  passPengLock: 'until-next-draw',
  passHuScope: 'any',
  chiDiscardRestriction: false,
  revealOneOfAnGang: false,
  handsPerSession: 8,

  // engine switches (same meaning as GENERIC)
  allowChi: true,
  allowPon: true,
  allowKan: true,
  robKong: true,
  passHuLock: true,
  sevenPairs: true,
  sevenPairsFour: true,
  thirteenOrphans: false,
  declareReady: false,
  readyRequired: false,
  dealerDraws: false,
  revealAnKan: false,
  claimOnLastTile: false,
  firstDealer: 'random',
};

const TAICANG_FLOWERS = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];

function taicangTileCounts() {
  const c = new Array(44).fill(0);
  for (let k = 0; k < 34; k++) c[k] = 4; // 万条筒 + 东南西北 + 中发白(带框)
  for (let k = 34; k < 42; k++) c[k] = 1; // 春夏秋冬梅兰竹菊
  c[42] = 4; // 百搭
  c[43] = 4; // 大白板
  return c; // 152
}

function capOf(cfg) {
  return cfg.capHua === null || cfg.capHua === undefined || cfg.capHua <= 0 ? null : cfg.capHua;
}

function fixedOf(cfg) {
  return capOf(cfg) ?? (cfg.wuhuaguoHua || 100);
}

/** Hua from exposed melds: wind pons count as 风刻; kongs give 杠花. */
function meldHua(ctx, hv) {
  let gang = 0;
  let windKe = 0;
  for (const m of ctx.melds) {
    const k = m.tiles[0];
    const w = isWind(k);
    if (m.type === 'pon') windKe += w ? hv.windKe : 0;
    else if (m.type === 'mingkan' || m.type === 'bukan') gang += w ? hv.windMingGang : hv.suitMingGang;
    else if (m.type === 'ankan') gang += w ? hv.windAnGang : hv.suitAnGang;
  }
  return { gang, windKe };
}

/** Candidate scorings for one standard decomposition (or seven pairs when d is null). */
function taicangForms(ctx, d) {
  const out = [];
  const anyCount = d ? d.sets.filter((s) => s.type === 'any').length : 0;
  for (let asWind = 0; asWind <= anyCount; asWind++) {
    const suits = new Set();
    let hasWind = false;
    let chow = false;
    let concealedWindKe = asWind;
    let flexible = anyCount - asWind;
    if (asWind) hasWind = true;
    const mark = (k) => {
      if (isSuited(k)) suits.add(suitOf(k));
      else if (isWind(k)) hasWind = true;
    };
    for (const m of ctx.melds) {
      mark(m.tiles[0]);
      if (m.type === 'chi') chow = true;
    }
    if (d) {
      for (const s of d.sets) {
        if (s.type === 'any') continue;
        mark(s.tile);
        if (s.type === 'chow') chow = true;
        else if (isWind(s.tile)) concealedWindKe++;
      }
      if (d.pair === null) flexible++;
      else mark(d.pair);
    } else {
      for (let k = 0; k < 34; k++) if (ctx.counts[k]) mark(k);
      if (ctx.wildCount) flexible++;
    }
    let qing = false;
    let hun = false;
    if (suits.size === 1) {
      qing = !hasWind;
      hun = hasWind;
    } else if (suits.size === 0 && hasWind && flexible > 0) {
      hun = true;
    }
    out.push({ sevenPairs: !d, qing, hun, allPungs: !!d && !chow, concealedWindKe });
  }
  return out;
}

function evalTaicangFan(ctx, f) {
  const cfg = ctx.settings;
  const hv = { ...TAICANG_OPTIONS.huaValues, ...(cfg.huaValues || {}) };
  const fv = { ...TAICANG_OPTIONS.fan, ...(cfg.fan || {}) };
  const C = capOf(cfg);
  const fixed = fixedOf(cfg);
  const items = [];
  const huaItem = (name, value) => value && items.push({ name, value, unit: '花' });
  const fanItem = (name, value) => value && items.push({ name, value, unit: '番' });

  const mh = meldHua(ctx, hv);
  const hard = ctx.flowers.length * hv.hardHua;
  const windHua = mh.windKe + f.concealedWindKe * hv.windKe;
  const menHua = hard + mh.gang + windHua;
  const dihua = cfg.dihua ?? 1;
  const T = dihua + menHua;
  const menqian = ctx.melds.every((m) => m.type === 'ankan' || (cfg.menqingAllowsMingGang && m.type === 'mingkan'));
  const selfLike = ctx.selfDraw || ctx.robKong;

  huaItem('底花', dihua);
  huaItem('硬花', hard);
  huaItem('杠花', mh.gang);
  huaItem('风刻', windHua);

  let F = 0;
  const addFan = (name, n) => {
    if (!n) return;
    F += n;
    fanItem(name, n);
  };
  if (menqian && menHua >= 1 && !(f.sevenPairs && cfg.qiduiStacksMenqing === false)) addFan('门清', fv.menqing);
  if (f.qing) addFan('清一色', fv.qingyise);
  else if (f.hun) addFan('混一色', fv.hunyise);
  if (f.allPungs) addFan('对对胡', fv.duiduihu);
  if (f.sevenPairs) addFan('七对', fv.qidui);
  if (ctx.kongReplacement) addFan('杠开', fv.gangkai);
  else if (ctx.flowerReplacement) addFan('花开', fv.gangkai);
  if (ctx.melds.length === 4 && (cfg.dadiaocheAllowsChi !== false || ctx.melds.every((m) => m.type !== 'chi'))) {
    addFan('大吊车', fv.dadiaoche);
  }
  if (cfg.haidiFan && ctx.lastTile && ctx.selfDraw) addFan('海底捞月', cfg.haidiFan);
  if (ctx.robKong) items.push({ name: '抢杠', value: 0, unit: '番' });

  let special = null;
  if (menqian && menHua === 0 && (selfLike || cfg.wuhuaguoAllowDiscard !== false)) special = 'wuhuaguo';
  if (cfg.tianDiHu === 'cap' && ctx.firstTurn) special = ctx.isDealer && ctx.selfDraw ? 'tianhu' : 'dihu';

  const raw = T * 2 ** F;
  let points = C === null ? raw : Math.min(raw, C);
  if (special) {
    const name = { wuhuaguo: '无花果', tianhu: '天胡', dihu: '地胡' }[special];
    items.push({ name, value: fixed, unit: '花' });
    points = fixed;
  } else if (C !== null && raw > C) {
    items.push({ name: '封顶', value: C, unit: '花' });
  }
  return { items, hua: T, menHua, hardHua: hard, fan: F, points, special, menqian };
}

function evalSuzhouAdditive(ctx, f) {
  const cfg = ctx.settings;
  const C = capOf(cfg);
  const items = [];
  let total = 0;
  const add = (name, value) => {
    if (!value) return;
    items.push({ name, value, unit: '花' });
    total += value;
  };
  let gang = 0;
  let windHua = 0;
  for (const m of ctx.melds) {
    const k = m.tiles[0];
    const w = isWind(k);
    if (m.type === 'pon') windHua += w ? 1 : 0;
    else if (m.type === 'mingkan' || m.type === 'bukan') (w ? (windHua += 3) : (gang += 1));
    else if (m.type === 'ankan') (w ? (windHua += 4) : (gang += 2));
  }
  windHua += f.concealedWindKe * 2;
  const hard = ctx.flowers.length;
  const menHua = hard + gang + windHua;
  const menqian = ctx.melds.every((m) => m.type === 'ankan');
  add('底花', 5);
  add('硬花', hard);
  add('杠花', gang);
  add('风刻', windHua);
  let fanLike = 0;
  const pat = (name, v) => {
    if (!v) return;
    fanLike++;
    add(name, v);
  };
  if (menqian && menHua === 0) pat('大门清', 10);
  else if (menqian) pat('小门清', 5);
  if (f.allPungs) pat('对对胡', 5);
  if (f.qing) pat('清一色', 10);
  else if (f.hun) pat('混一色', 5);
  if (f.sevenPairs) pat('七对', 10);
  if (ctx.kongReplacement) pat('杠开', 5);
  else if (ctx.flowerReplacement) pat('花开', 5);
  if (ctx.melds.length === 4) pat('大吊车', 5);
  if (ctx.lastTile && ctx.selfDraw) pat('海底捞月', 5);
  if (ctx.firstTurn) pat(ctx.isDealer && ctx.selfDraw ? '天胡' : '地胡', 50);
  if (ctx.robKong) items.push({ name: '抢杠', value: 0, unit: '花' });
  let points = total;
  if (C !== null && total > C) {
    items.push({ name: '封顶', value: C, unit: '花' });
    points = C;
  }
  return { items, hua: total, menHua, hardHua: hard, fan: 0, points, special: null, menqian, fanLike };
}

function taicangCanWin(ctx, r) {
  const cfg = ctx.settings;
  if (r.special === 'lazi') return true;
  const discardWin = !ctx.selfDraw && !ctx.robKong;
  if (discardWin && ctx.wildCount > 0 && cfg.caishenBlocksDiscardWin !== false) {
    if (!(cfg.caishenGuiweiAllowsDiscardWin && ctx.naturalWin)) return false;
  }
  const mode = cfg.minHuaExemption || 'any-fan';
  const hasPattern = r.fanLike !== undefined ? r.fanLike > 0 : r.fan > 0;
  let exempt = false;
  if (mode === 'any-fan') exempt = hasPattern || !!r.special;
  else if (mode === 'menqing-only') exempt = r.menqian;
  const counted = (cfg.minHuaCountsSoftHua === false ? r.hardHua : r.menHua) + (cfg.minHuaIncludesDihua ? cfg.dihua ?? 1 : 0);
  const selfLike = ctx.selfDraw || (ctx.robKong && cfg.qianggangMinHua !== 'discard');
  const need = selfLike ? cfg.minHuaSelfDraw ?? 2 : cfg.minHuaDiscard ?? 3;
  return exempt || counted >= need;
}

function taicangScore(ctx) {
  const cfg = ctx.settings;
  const additive = cfg.scoringModel === 'suzhou-additive';
  const results = [];
  const evalForm = (f) => {
    const r = additive ? evalSuzhouAdditive(ctx, f) : evalTaicangFan(ctx, f);
    r.canWin = taicangCanWin(ctx, r);
    results.push(r);
  };
  for (const d of ctx.decompositions) for (const f of taicangForms(ctx, d)) evalForm(f);
  if (ctx.sevenPairs) for (const f of taicangForms(ctx, null)) evalForm(f);
  if (ctx.special && ctx.special.type === 'lazi') {
    const fixed = fixedOf(cfg);
    results.push({
      items: [{ name: '辣子', value: fixed, unit: '花' }],
      hua: fixed,
      menHua: 0,
      hardHua: 0,
      fan: 0,
      points: fixed,
      special: 'lazi',
      menqian: false,
      canWin: true,
    });
  }
  if (!results.length) return { items: [], total: 0, hua: 0, fan: 0, points: 0, special: null, canWin: false };
  // Highest payout among legal readings; 无花果 discard wins pay half the cap.
  const value = (r) => (r.special === 'wuhuaguo' && !ctx.selfDraw && !ctx.robKong ? r.points / 2 : r.points);
  results.sort((a, b) => (b.canWin - a.canWin) || value(b) - value(a) || b.hua - a.hua);
  const best = results[0];
  return {
    items: best.items,
    total: best.points,
    hua: best.hua,
    fan: best.fan,
    points: best.points,
    special: best.special,
    canWin: best.canWin,
  };
}

/** Seat that 承包 for this winner (吃碰三口 from one seat), or null. */
export function chengbaoSeat(melds, cfg) {
  const cb = { ...TAICANG_OPTIONS.chengbao, ...(cfg.chengbao || {}) };
  if (!cb.enabled) return null;
  const n = [0, 0, 0, 0];
  for (const m of melds) {
    if (m.from === null || m.from === undefined) continue;
    if (m.type === 'chi' || m.type === 'pon' || m.type === 'bukan') n[m.from]++;
    else if (m.type === 'mingkan' && cb.countsGang) n[m.from]++;
  }
  for (let s = 0; s < 4; s++) if (n[s] >= cb.threshold) return s;
  return null;
}

function taicangSettle(s) {
  const cfg = s.settings;
  const deltas = [0, 0, 0, 0];
  if (s.type === 'draw') return { deltas, dealerContinues: true, baoSeat: null };
  const unit = (Number(cfg.pointsPerHua) || 1) * (Number(cfg.baseScore) || 1);
  const cb = { ...TAICANG_OPTIONS.chengbao, ...(cfg.chengbao || {}) };
  const qg = { ...TAICANG_OPTIONS.qianggang, ...(cfg.qianggang || {}) };
  const pay = (from, to, amt) => {
    deltas[from] -= amt * unit;
    deltas[to] += amt * unit;
  };
  const everyone = (to, amt) => {
    for (let p = 0; p < 4; p++) if (p !== to) pay(p, to, amt);
  };
  const baoSeats = {};
  let baoSeat = null;
  for (const w of s.winners) {
    const P = w.points ?? w.total;
    if (s.robKong) {
      pay(s.loser, w.seat, (qg.payerShares ?? 3) * P);
      continue;
    }
    if (w.special === 'lazi') {
      everyone(w.seat, P);
      continue;
    }
    if (w.special === 'wuhuaguo' && !s.selfDraw) {
      pay(s.loser, w.seat, Math.floor(P / 2));
      continue;
    }
    if (w.special) {
      if (s.selfDraw) everyone(w.seat, P);
      else pay(s.loser, w.seat, P);
      continue;
    }
    const bao = s.selfDraw || cb.onDiscard === 'baojia-pays-5x' ? chengbaoSeat(w.ctx.melds, cfg) : null;
    if (bao !== null && bao !== w.seat) {
      pay(bao, w.seat, (cb.multiplier ?? 5) * P);
      baoSeats[w.seat] = bao;
      baoSeat = bao;
    } else if (s.selfDraw) {
      everyone(w.seat, P);
    } else {
      pay(s.loser, w.seat, P);
    }
  }
  let nextDealer;
  const seats = s.winners.map((w) => w.seat);
  if (s.robKong && qg.kongerDealsNext !== false) nextDealer = s.loser;
  else if (seats.includes(s.dealer)) nextDealer = s.dealer;
  else if (seats.length > 1 && cfg.multiWinDealer === 'discarder') nextDealer = s.loser;
  else nextDealer = seats[0]; // engine lists winners in turn order after the discarder
  return { deltas, nextDealer, baoSeat, baoSeats };
}

function taicangSpecialWin(sctx) {
  const cfg = sctx.settings;
  const lazi = cfg.lazi || {};
  if (lazi.enabled === false) return null;
  if (sctx.totalWilds > 0 && sctx.wildCount >= sctx.totalWilds) return { type: 'lazi' };
  return null;
}

export const TAICANG = {
  id: 'TAICANG',
  name: '太仓麻将',
  description: '152 张（28 张花），翻牌定财神，可吃碰杠，二花自摸三花冲，底花×2^番，无花果封顶，吃碰三口承包',
  options: TAICANG_OPTIONS,
  tileCounts: taicangTileCounts,
  flowerKinds: () => TAICANG_FLOWERS.slice(),
  score: taicangScore,
  settle: taicangSettle,
  specialWin: taicangSpecialWin,
  aiHint: { keepWilds: true, minHuaGate: true },
};

export const RULESETS = { TAICANG, GENERIC };

export const RULESET_LIST = Object.values(RULESETS).map((r) => ({ id: r.id, name: r.name, description: r.description }));
