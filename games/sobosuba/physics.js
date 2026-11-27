/**
 * Sobosuba soft-body physics.
 *
 * Built the way the original developer describes the game: every blob is a closed ring of
 * small beads. A skin force keeps neighbouring beads together and a pressure force pushes
 * the ring outward along its normals until the enclosed area matches the blob's size.
 * Blobs collide bead-against-skin (capsules), so neighbours flatten into shared faces and
 * pack like foam instead of overlapping.
 *
 * Solved with small-step XPBD: 60 physics ticks per second, several substeps per tick and
 * one constraint pass per substep. The renderer interpolates between ticks.
 */

export const WORLD_W = 420;
export const WORLD_H = 660;
export const BOX_LEFT = 22;
export const BOX_RIGHT = 398;
export const BOX_TOP = 24;
export const BOX_BOTTOM = 638;
export const CHAMFER = 40;

export const BAR_Y = 92;
export const RAY_FULL = 118;

export const BUMPER_Y = 222;
export const BUMPER_R = 34;
export const BUMPER_REACH = 19;
export const BUMPER_TRAVEL = 12;

export const BEAD_R = 3;
export const SKIN_OFFSET = 1.5;
export const MAX_DRAG = 150;

export const TICK = 1 / 60;
const SUBSTEPS = 8;
const DT = TICK / SUBSTEPS;
const DT2 = DT * DT;
const CONTACT = BEAD_R * 2;
const MERGE_REACH = CONTACT + 1.5;
// Overlap that was already there (not caused by approaching this substep) may only push
// things apart this fast; otherwise a deep overlap resolves in one substep and detonates.
const MAX_SEPARATION_SPEED = 220;
const MAX_SEPARATION_STEP = MAX_SEPARATION_SPEED * DT;
const MAX_SPAWN_TIER = 8; // spawns never exceed 256
const MAX_BAR_BLOBS = 6;

// Material constants. Tuned so a lone blob rests as a soft dome, a packed pile turns into
// flat-faced cells, and a big blob pinned to the bar stretches into a long pill.
export const PHYS = {
  gravity: 1500,
  maxLaunchSpeed: 1650,
  skinSlack: 1.0,
  skinCompliance: 0.04,
  areaCompliance: 1.2e-4,
  frictionStatic: 0.5,
  frictionKinetic: 0.32,
  wallFriction: 0.3,
  wobbleDamping: 6,
  spinDamping: 2.5,
  airDamping: 0.2,
  barPullY: 180,
  barDampY: 22,
  barHalf: 16,
  barSquash: 30000,
  barPullX: 7,
  barMaxAccX: 320,
  barDampX: 3.5,
  domeStiffness: 150,
};

export function tierOf(value) {
  return Math.max(0, Math.round(Math.log2(Math.max(1, value))));
}

export function getRadiusForValue(value) {
  return 17.5 * Math.pow(1.145, tierOf(value));
}

function beadCountFor(value) {
  return Math.min(34, 16 + Math.round(tierOf(value) * 1.25));
}

let nextBlobId = 1;

function createBlob(value, cx, cy, opts = {}) {
  const n = beadCountFor(value);
  const radius = getRadiusForValue(value);
  const targetRing = radius - SKIN_OFFSET;
  const ring = targetRing * (opts.startScale ?? 1);
  const mass = (radius / 17.5) ** 2;
  const b = {
    id: nextBlobId++,
    value,
    isBold: Boolean(opts.isBold),
    state: opts.state || 'bar', // 'bar' | 'play'
    n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    px: new Float64Array(n),
    py: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    rx: new Float64Array(n),
    ry: new Float64Array(n),
    radius,
    ring,
    targetRing,
    restEdge: 0,
    restArea: 0,
    minSkip: 0,
    skinAlpha: 0,
    areaAlpha: 0,
    mass,
    w: n / mass,
    cx,
    cy,
    rcx: cx,
    rcy: cy,
    velX: opts.velX || 0,
    velY: opts.velY || 0,
    minX: cx - radius,
    maxX: cx + radius,
    minY: cy - radius,
    maxY: cy + radius,
    area: 0,
    age: opts.age ?? 0,
    mergeCooldown: opts.mergeCooldown ?? 0.05,
    hasTouchedSurface: Boolean(opts.hasTouchedSurface),
    launchPower: 0,
    wasGentleDrop: false,
    chainCount: opts.chainCount ?? 0,
    chainTimer: opts.chainTimer ?? 0,
    popFlash: opts.popFlash ?? 0,
    fixedFlash: 0,
    speedBefore: 0,
  };
  const squash = opts.squash ?? 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    b.x[i] = cx + Math.cos(a) * ring * squash;
    b.y[i] = cy + (Math.sin(a) * ring) / squash;
    b.vx[i] = b.velX;
    b.vy[i] = b.velY;
  }
  b.px.set(b.x);
  b.py.set(b.y);
  b.rx.set(b.x);
  b.ry.set(b.y);
  refreshRest(b);
  refreshMetrics(b);
  b.rcx = b.cx;
  b.rcy = b.cy;
  return b;
}

function refreshRest(b) {
  const n = b.n;
  b.restEdge = 2 * b.ring * Math.sin(Math.PI / n) * PHYS.skinSlack;
  b.restArea = 0.5 * n * b.ring * b.ring * Math.sin((2 * Math.PI) / n);
  b.minSkip = b.restEdge;
  // Compliance scales with size so small and big blobs sag by the same proportion.
  b.skinAlpha = PHYS.skinCompliance / (b.ring * n) / DT2;
  b.areaAlpha = (PHYS.areaCompliance * b.ring) / DT2;
}

function refreshMetrics(b) {
  const { n, x, y, vx, vy } = b;
  let area2 = 0;
  let acx = 0;
  let acy = 0;
  let sx = 0;
  let sy = 0;
  let svx = 0;
  let svy = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const xi = x[i];
    const yi = y[i];
    const cross = xi * y[j] - x[j] * yi;
    area2 += cross;
    acx += (xi + x[j]) * cross;
    acy += (yi + y[j]) * cross;
    sx += xi;
    sy += yi;
    svx += vx[i];
    svy += vy[i];
    if (xi < minX) minX = xi;
    if (xi > maxX) maxX = xi;
    if (yi < minY) minY = yi;
    if (yi > maxY) maxY = yi;
  }
  b.area = area2 * 0.5;
  if (Math.abs(area2) > 1) {
    b.cx = acx / (3 * area2);
    b.cy = acy / (3 * area2);
  } else {
    b.cx = sx / n;
    b.cy = sy / n;
  }
  b.velX = svx / n;
  b.velY = svy / n;
  b.minX = minX - BEAD_R;
  b.maxX = maxX + BEAD_R;
  b.minY = minY - BEAD_R;
  b.maxY = maxY + BEAD_R;
}

function pointInRing(px, py, b) {
  const { n, x, y } = b;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = y[i];
    const yj = y[j];
    if (yi > py !== yj > py && px < ((x[j] - x[i]) * (py - yi)) / (yj - yi) + x[i]) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) return false;
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  if ((d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0)) return false;
  return d1 !== d2 && d3 !== d4;
}

function isTangled(b) {
  const { n, x, y } = b;
  for (let i = 0; i < n; i++) {
    const i2 = i + 1 === n ? 0 : i + 1;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const j2 = j + 1 === n ? 0 : j + 1;
      if (segmentsCross(x[i], y[i], x[i2], y[i2], x[j], y[j], x[j2], y[j2])) return true;
    }
  }
  return false;
}

// ---------- Broadphase: uniform grid of skin segments ----------

const CELL = 24;
const GRID_W = Math.ceil(WORLD_W / CELL);
const GRID_H = Math.ceil(WORLD_H / CELL);
const GRID_N = GRID_W * GRID_H;
const gridStart = new Int32Array(GRID_N + 1);
const gridFill = new Int32Array(GRID_N);
let gridItems = new Int32Array(16384);
let segBlob = new Int32Array(4096);
let segIdx = new Int32Array(4096);

function cellX(v) {
  const c = Math.floor(v / CELL);
  return c < 0 ? 0 : c >= GRID_W ? GRID_W - 1 : c;
}

function cellY(v) {
  const c = Math.floor(v / CELL);
  return c < 0 ? 0 : c >= GRID_H ? GRID_H - 1 : c;
}

function buildGrid(blobs) {
  let total = 0;
  for (let bi = 0; bi < blobs.length; bi++) total += blobs[bi].n;
  if (segBlob.length < total) {
    segBlob = new Int32Array(total * 2);
    segIdx = new Int32Array(total * 2);
  }
  gridStart.fill(0);
  let s = 0;
  for (let bi = 0; bi < blobs.length; bi++) {
    const { n, x, y } = blobs[bi];
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      segBlob[s] = bi;
      segIdx[s] = i;
      s++;
      const x0 = cellX(Math.min(x[i], x[j]) - MERGE_REACH);
      const x1 = cellX(Math.max(x[i], x[j]) + MERGE_REACH);
      const y0 = cellY(Math.min(y[i], y[j]) - MERGE_REACH);
      const y1 = cellY(Math.max(y[i], y[j]) + MERGE_REACH);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) gridStart[cy * GRID_W + cx + 1]++;
      }
    }
  }
  for (let c = 1; c <= GRID_N; c++) gridStart[c] += gridStart[c - 1];
  if (gridItems.length < gridStart[GRID_N]) gridItems = new Int32Array(gridStart[GRID_N] * 2);
  gridFill.set(gridStart.subarray(0, GRID_N));
  s = 0;
  for (let bi = 0; bi < blobs.length; bi++) {
    const { n, x, y } = blobs[bi];
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const x0 = cellX(Math.min(x[i], x[j]) - MERGE_REACH);
      const x1 = cellX(Math.max(x[i], x[j]) + MERGE_REACH);
      const y0 = cellY(Math.min(y[i], y[j]) - MERGE_REACH);
      const y1 = cellY(Math.max(y[i], y[j]) + MERGE_REACH);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) gridItems[gridFill[cy * GRID_W + cx]++] = s;
      }
      s++;
    }
  }
}

const gradX = new Float64Array(64);
const gradY = new Float64Array(64);

export class SobosubaWorld {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.mode = 'classic';
    this.reset('classic');
  }

  reset(mode = this.mode) {
    this.mode = mode;
    this.blobs = [];
    this.particles = [];
    this.rings = [];
    this.score = 0;
    this.maxBlob = 4;
    this.mergeCount = 0;
    this.launchCount = 0;
    this.elapsedTime = 0;
    this.sprintReached8K = false;
    this.sprintFinished = false;
    this.gameOver = false;
    this.gameOverReason = null;
    this.shake = 0;
    this.zap = 0;
    this.accumulator = 0;
    this.alpha = 1;

    this.leftRay = 1;
    this.rightRay = 1;
    this.leftCooldown = 0;
    this.rightCooldown = 0;
    this.emptyBarTime = 0;
    this.lastLaunchSide = null;

    this.domes = [
      { side: 'left', push: 0, gauge: 0, force: 0 },
      { side: 'right', push: 0, gauge: 0, force: 0 },
    ];
    this.overTimer = 0;
    this.aiming = null;
    this.pendingMerges = [];

    const starters = [
      { x: WORLD_W * 0.36, v: 1 },
      { x: WORLD_W * 0.5, v: 2 },
      { x: WORLD_W * 0.64, v: 1 },
    ];
    for (const s of starters) this.blobs.push(createBlob(s.v, s.x, BAR_Y, { state: 'bar' }));
    this.updateRays();
  }

  // ---------- Spawning ----------

  pickSpawnValue(side, spawnX) {
    const top = Math.min(MAX_SPAWN_TIER, Math.max(2, tierOf(this.maxBlob) - 3));
    const limit = side === 'middle' ? Math.max(1, top - 1) : top;
    const excluded = new Set();
    for (const b of this.blobs) {
      // Never spawn the same size right under a blob that was just shot up into the corner.
      if (b.state === 'play' && b.cy < BAR_Y + 70 && Math.abs(b.cx - spawnX) < b.radius + 46) {
        excluded.add(b.value);
      }
    }
    // Avoid an instant merge with the bar blob the new one will slide into.
    let edge = null;
    for (const b of this.blobs) {
      if (b.state !== 'bar') continue;
      if (!edge || (side === 'left' ? b.cx < edge.cx : b.cx > edge.cx)) edge = b;
    }
    if (edge && side !== 'middle') excluded.add(edge.value);

    const pool = [];
    for (let t = 0; t <= limit; t++) {
      const v = 1 << t;
      if (excluded.has(v)) continue;
      const weight = t <= 2 ? [36, 32, 26][t] : Math.max(2, Math.round(14 * Math.pow(0.68, t - 3)));
      pool.push({ v, weight });
    }
    if (pool.length === 0) return 1;
    let r = Math.random() * pool.reduce((acc, it) => acc + it.weight, 0);
    for (const it of pool) {
      r -= it.weight;
      if (r <= 0) return it.v;
    }
    return pool[pool.length - 1].v;
  }

  spawnBlob(side) {
    let x = (BOX_LEFT + BOX_RIGHT) * 0.5;
    if (side === 'left') x = BOX_LEFT + 24;
    else if (side === 'right') x = BOX_RIGHT - 24;
    const value = this.pickSpawnValue(side, x);
    const r = getRadiusForValue(value);
    if (side === 'left') x = BOX_LEFT + r + 4;
    else if (side === 'right') x = BOX_RIGHT - r - 4;
    const b = createBlob(value, x, BAR_Y, {
      state: 'bar',
      startScale: 0.55,
      velX: side === 'left' ? 110 : side === 'right' ? -110 : 0,
      popFlash: 0.6,
    });
    this.blobs.push(b);
    if (this.callbacks.onSpawn) this.callbacks.onSpawn(b);
  }

  updateRays() {
    let count = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const b of this.blobs) {
      if (b.state !== 'bar') continue;
      count++;
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
    }
    if (count === 0) {
      this.leftRay = 1;
      this.rightRay = 1;
    } else {
      this.leftRay = Math.max(0, Math.min(1, (minX - BOX_LEFT) / RAY_FULL));
      this.rightRay = Math.max(0, Math.min(1, (BOX_RIGHT - maxX) / RAY_FULL));
    }
    return count;
  }

  stepSpawning(dt) {
    const count = this.updateRays();
    this.leftCooldown -= dt;
    this.rightCooldown -= dt;
    if (count === 0) {
      // Safety spawn: a single blob from the top middle when the bar runs dry.
      this.emptyBarTime += dt;
      if (this.emptyBarTime > 0.15) {
        this.emptyBarTime = 0;
        this.spawnBlob('middle');
      }
      return;
    }
    this.emptyBarTime = 0;
    if (count >= MAX_BAR_BLOBS) return;
    if (this.leftRay >= 1 && this.leftCooldown <= 0) {
      this.leftCooldown = 0.45;
      this.spawnBlob('left');
    } else if (this.rightRay >= 1 && this.rightCooldown <= 0) {
      this.rightCooldown = 0.45;
      this.spawnBlob('right');
    }
  }

  // ---------- Input ----------

  findBarBlobAt(wx, wy) {
    let best = null;
    let bestScore = Infinity;
    for (const b of this.blobs) {
      if (b.state !== 'bar') continue;
      let score = Infinity;
      if (wx > b.minX - 14 && wx < b.maxX + 14 && wy > b.minY - 20 && wy < b.maxY + 20) {
        score = Math.hypot(wx - b.cx, (wy - b.cy) * 1.4);
      }
      // The grab dots along the top edge also pick their blob.
      const half = Math.max(16, (b.maxX - b.minX) * 0.5);
      if (wy < BOX_TOP + 26 && Math.abs(wx - b.cx) < half) {
        score = Math.min(score, Math.abs(wx - b.cx));
      }
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  launchBlob(blob, dirX, dirY, power01, isGentleDrop = false) {
    if (!blob || blob.state !== 'bar' || this.gameOver) return false;
    blob.state = 'play';
    blob.age = 0;
    blob.hasTouchedSurface = false;
    blob.wasGentleDrop = isGentleDrop;
    blob.launchPower = isGentleDrop ? 0 : power01;
    blob.chainCount = 0;
    blob.chainTimer = 1.6;
    this.launchCount++;
    this.lastLaunchSide = blob.cx < WORLD_W * 0.5 ? 'left' : 'right';

    // Launching adds to whatever drift the blob already has; a gentle drop adds nothing.
    if (!isGentleDrop) {
      const len = Math.hypot(dirX, dirY) || 1;
      const speed = Math.pow(Math.max(0, Math.min(1, power01)), 1.1) * PHYS.maxLaunchSpeed;
      const ax = (dirX / len) * speed;
      const ay = (dirY / len) * speed;
      for (let i = 0; i < blob.n; i++) {
        blob.vx[i] += ax;
        blob.vy[i] += ay;
      }
      blob.velX += ax;
      blob.velY += ay;
    }
    if (this.callbacks.onLaunch) this.callbacks.onLaunch(blob, power01, isGentleDrop);
    return true;
  }

  // ---------- Simulation ----------

  update(rawDt) {
    const dt = Math.min(rawDt, 0.1);
    this.stepEffects(dt);
    // After a game over the pile keeps settling in slow motion behind the score screen.
    this.accumulator += this.gameOver ? dt * 0.35 : dt;
    let steps = 0;
    while (this.accumulator >= TICK && steps < 4) {
      this.tick();
      this.accumulator -= TICK;
      steps++;
    }
    if (steps === 4) this.accumulator = 0;
    this.alpha = Math.max(0, Math.min(1, this.accumulator / TICK));
  }

  tick() {
    const blobs = this.blobs;
    for (const b of blobs) {
      b.rx.set(b.x);
      b.ry.set(b.y);
      b.rcx = b.cx;
      b.rcy = b.cy;
      b.speedBefore = Math.hypot(b.velX, b.velY);
      if (Math.abs(b.targetRing - b.ring) > 0.01) {
        b.ring += (b.targetRing - b.ring) * (1 - Math.exp(-TICK * 13));
        refreshRest(b);
      }
    }
    for (const d of this.domes) d.force = 0;
    this.pendingMerges.length = 0;

    for (let step = 0; step < SUBSTEPS; step++) this.substep();

    if (!this.gameOver && this.pendingMerges.length > 0) this.processMerges();
    this.repairShapes();

    for (const b of this.blobs) {
      b.age += TICK;
      if (b.mergeCooldown > 0) b.mergeCooldown = Math.max(0, b.mergeCooldown - TICK);
      if (b.chainTimer > 0) {
        b.chainTimer = Math.max(0, b.chainTimer - TICK);
        if (b.chainTimer === 0) b.chainCount = 0;
      }
      if (b.popFlash > 0) b.popFlash = Math.max(0, b.popFlash - TICK * 3);
      if (b.fixedFlash > 0) b.fixedFlash = Math.max(0, b.fixedFlash - TICK * 0.8);
      if (b.state === 'play') {
        const drop = b.speedBefore - Math.hypot(b.velX, b.velY);
        if (drop > 260 && this.callbacks.onBounce) this.callbacks.onBounce(Math.min(1, (drop - 200) / 900));
      }
    }

    if (!this.gameOver) {
      this.elapsedTime += TICK;
      this.stepSpawning(TICK);
      this.stepBumpers(TICK);
      this.recomputeScore();
    }
  }

  substep() {
    const blobs = this.blobs;
    const centerX = (BOX_LEFT + BOX_RIGHT) * 0.5;
    // Sweeping the constraints in the same order every substep slowly drags the skin around
    // the ring, which friction turns into endless rolling. Alternate the direction.
    this.flip = !this.flip;
    for (let i = 0; i < blobs.length; i++) this.predict(blobs[i], centerX);
    for (let i = 0; i < blobs.length; i++) this.solveShape(blobs[i], this.flip);
    for (let i = 0; i < blobs.length; i++) this.solveBounds(blobs[i], true);
    this.solveContacts(this.flip);
    for (let i = 0; i < blobs.length; i++) {
      this.solveBounds(blobs[i], false);
      this.finishSubstep(blobs[i]);
    }
  }

  predict(b, centerX) {
    const { n, x, y, px, py, vx, vy } = b;
    if (b.state === 'bar') {
      // The float bar holds each blob on its line and gathers the row toward the middle.
      // Beads that stick out past the bar's half-height get squeezed back, so small blobs
      // stay round while big ones flatten into long pills.
      const dx = b.cx - centerX;
      const ax =
        -Math.sign(dx) * Math.min(Math.abs(dx) * PHYS.barPullX, PHYS.barMaxAccX) - b.velX * PHYS.barDampX;
      const ayAll = -PHYS.barPullY * (b.cy - BAR_Y) - PHYS.barDampY * b.velY;
      const half = PHYS.barHalf;
      for (let i = 0; i < n; i++) {
        const dy = y[i] - BAR_Y;
        let ay = ayAll;
        if (dy > half) ay -= (dy - half) * PHYS.barSquash;
        else if (dy < -half) ay -= (dy + half) * PHYS.barSquash;
        vx[i] += ax * DT;
        vy[i] += ay * DT;
      }
    } else {
      const g = PHYS.gravity * DT;
      for (let i = 0; i < n; i++) vy[i] += g;
    }
    for (let i = 0; i < n; i++) {
      px[i] = x[i];
      py[i] = y[i];
      x[i] += vx[i] * DT;
      y[i] += vy[i] * DT;
    }
  }

  solveShape(b, reverse) {
    const { n, x, y, w } = b;

    // Skin: springy edges between neighbouring beads. Even edges, then odd edges, then the
    // closing edge on odd rings: no two edges in a pass share a bead, so the solve has no
    // seam and no preferred direction around the ring.
    const L0 = b.restEdge;
    const denomEdge = 2 * w + b.skinAlpha;
    const odd = n % 2 === 1;
    for (let pass = 0; pass < 3; pass++) {
      let i0 = pass;
      let i1 = odd ? n - 2 : n - 1;
      if (pass === 2) {
        if (!odd) break;
        i0 = n - 1;
        i1 = n - 1;
      }
      for (let i = i0; i <= i1; i += 2) {
        const j = i + 1 === n ? 0 : i + 1;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        const s = (w * (-(d - L0) / denomEdge)) / d;
        x[i] -= dx * s;
        y[i] -= dy * s;
        x[j] += dx * s;
        y[j] += dy * s;
      }
    }

    // Anti-fold: beads two apart may bend sharply but never collapse onto each other.
    const ms = b.minSkip;
    for (let k = 0; k < n; k++) {
      const i = reverse ? n - 1 - k : k;
      const j = (i + 2) % n;
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      if (d < ms) {
        const s = (0.5 * (d - ms)) / d;
        x[i] += dx * s;
        y[i] += dy * s;
        x[j] -= dx * s;
        y[j] -= dy * s;
      }
    }

    // Pressure: push the ring along its normals until the area matches the rest area.
    let area2 = 0;
    let sumG = 0;
    for (let i = 0; i < n; i++) {
      const prev = i === 0 ? n - 1 : i - 1;
      const next = i + 1 === n ? 0 : i + 1;
      area2 += x[i] * y[next] - x[next] * y[i];
      const gx = 0.5 * (y[next] - y[prev]);
      const gy = 0.5 * (x[prev] - x[next]);
      gradX[i] = gx;
      gradY[i] = gy;
      sumG += gx * gx + gy * gy;
    }
    if (sumG > 1e-9) {
      const dl = -(area2 * 0.5 - b.restArea) / (w * sumG + b.areaAlpha);
      const s = w * dl;
      for (let i = 0; i < n; i++) {
        x[i] += gradX[i] * s;
        y[i] += gradY[i] * s;
      }
    }
  }

  solveBounds(b, withDomes) {
    const { n, x, y, px, py } = b;
    const minX = BOX_LEFT + BEAD_R;
    const maxX = BOX_RIGHT - BEAD_R;
    const minY = BOX_TOP + BEAD_R;
    const maxY = BOX_BOTTOM - BEAD_R;
    const mu = PHYS.wallFriction;
    const s2 = Math.SQRT1_2;
    const domeLX = BOX_LEFT - BUMPER_R + BUMPER_REACH - this.domes[0].push;
    const domeRX = BOX_RIGHT + BUMPER_R - BUMPER_REACH + this.domes[1].push;
    const domeHit = BUMPER_R + BEAD_R;
    const countsForDome = b.state === 'play' && b.hasTouchedSurface;
    let touched = false;

    for (let i = 0; i < n; i++) {
      const x0 = x[i];
      const y0 = y[i];
      if (x[i] < minX) x[i] = minX;
      else if (x[i] > maxX) x[i] = maxX;
      if (y[i] > maxY) y[i] = maxY;
      else if (y[i] < minY) y[i] = minY;

      const sl = (x[i] - BOX_LEFT + (BOX_BOTTOM - y[i]) - CHAMFER) * s2;
      if (sl < BEAD_R) {
        x[i] += s2 * (BEAD_R - sl);
        y[i] -= s2 * (BEAD_R - sl);
      }
      const sr = (BOX_RIGHT - x[i] + (BOX_BOTTOM - y[i]) - CHAMFER) * s2;
      if (sr < BEAD_R) {
        x[i] -= s2 * (BEAD_R - sr);
        y[i] -= s2 * (BEAD_R - sr);
      }

      if (withDomes) {
        const dy = y[i] - BUMPER_Y;
        if (dy > -domeHit && dy < domeHit) {
          for (let k = 0; k < 2; k++) {
            const dx = x[i] - (k === 0 ? domeLX : domeRX);
            const d2 = dx * dx + dy * dy;
            if (d2 < domeHit * domeHit) {
              const d = Math.sqrt(d2) || 1e-9;
              const pen = domeHit - d;
              const nx = dx / d;
              x[i] += nx * pen;
              y[i] += (dy / d) * pen;
              // Only the sideways shove drives a dome back into its wall; weight resting
              // on top of a dome does not.
              const shove = k === 0 ? nx : -nx;
              if (countsForDome && shove > 0) this.domes[k].force += (pen * shove) / b.w / DT2;
            }
          }
        }
      }

      // One friction step per bead along the combined push, so a bead wedged into a corner
      // is not tugged back and forth by two surfaces.
      const pushX = x[i] - x0;
      const pushY = y[i] - y0;
      const pen = Math.sqrt(pushX * pushX + pushY * pushY);
      if (pen < 1e-9) continue;
      touched = true;
      const nx = pushX / pen;
      const ny = pushY / pen;
      const approach = Math.max(0, -(b.vx[i] * nx + b.vy[i] * ny)) * DT;
      const excess = pen - approach - MAX_SEPARATION_STEP;
      if (excess > 0) {
        px[i] += nx * excess;
        py[i] += ny * excess;
      }
      const dx = x[i] - px[i];
      const dy = y[i] - py[i];
      const dn = dx * nx + dy * ny;
      const tx = dx - dn * nx;
      const ty = dy - dn * ny;
      const tl = Math.sqrt(tx * tx + ty * ty);
      if (tl > 1e-9) {
        const k = tl < mu * pen * 1.5 ? 1 : (mu * pen) / tl;
        x[i] -= tx * k;
        y[i] -= ty * k;
      }
    }
    if (touched && b.state === 'play') b.hasTouchedSurface = true;
  }

  solveContacts(reverse) {
    const blobs = this.blobs;
    if (blobs.length < 2) return;
    buildGrid(blobs);
    const contact2 = MERGE_REACH * MERGE_REACH;
    const muS = PHYS.frictionStatic;
    const muK = PHYS.frictionKinetic;
    const count = blobs.length;

    for (let q = 0; q < count; q++) {
      const ai = reverse ? count - 1 - q : q;
      const a = blobs[ai];
      const an = a.n;
      const axs = a.x;
      const ays = a.y;
      for (let r = 0; r < an; r++) {
        const i = reverse ? an - 1 - r : r;
        const px = axs[i];
        const py = ays[i];
        const c = cellY(py) * GRID_W + cellX(px);
        const end = gridStart[c + 1];
        for (let k = gridStart[c]; k < end; k++) {
          const seg = gridItems[k];
          const bi = segBlob[seg];
          if (bi === ai) continue;
          const b = blobs[bi];
          const bn = b.n;
          const s0 = segIdx[seg];
          const s1 = s0 + 1 === bn ? 0 : s0 + 1;
          const bx = b.x;
          const by = b.y;
          const ex = bx[s1] - bx[s0];
          const ey = by[s1] - by[s0];
          const len2 = ex * ex + ey * ey || 1e-9;
          let t = ((px - bx[s0]) * ex + (py - by[s0]) * ey) / len2;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const qx = bx[s0] + ex * t;
          const qy = by[s0] + ey * t;
          let dx = px - qx;
          let dy = py - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= contact2) continue;

          if (
            a.value === b.value &&
            a.mergeCooldown <= 0 &&
            b.mergeCooldown <= 0 &&
            !this.gameOver
          ) {
            this.pendingMerges.push(ai < bi ? [a, b] : [b, a]);
            continue;
          }

          // Which side of b's skin are we on? Use the segment normal mid-edge and the
          // averaged vertex normal at the corners.
          let onx;
          let ony;
          if (t > 0 && t < 1) {
            const el = Math.sqrt(len2);
            onx = ey / el;
            ony = -ex / el;
          } else {
            const v = t === 0 ? s0 : s1;
            const vp = v === 0 ? bn - 1 : v - 1;
            const vn = v + 1 === bn ? 0 : v + 1;
            const tx = bx[vn] - bx[vp];
            const ty = by[vn] - by[vp];
            const tl = Math.sqrt(tx * tx + ty * ty) || 1e-9;
            onx = ty / tl;
            ony = -tx / tl;
          }
          const d = Math.sqrt(d2);
          const side = dx * onx + dy * ony;
          let nx;
          let ny;
          let pen;
          if (side < 0) {
            nx = onx;
            ny = ony;
            pen = CONTACT + d;
          } else {
            if (d >= CONTACT) continue;
            if (d < 1e-6) {
              nx = onx;
              ny = ony;
            } else {
              nx = dx / d;
              ny = dy / d;
            }
            pen = CONTACT - d;
          }

          const wa = a.w;
          const wb = b.w;
          const t0 = 1 - t;
          const W = wa + wb * (t0 * t0 + t * t);
          const lam = pen / W;
          axs[i] += nx * lam * wa;
          ays[i] += ny * lam * wa;
          bx[s0] -= nx * lam * wb * t0;
          by[s0] -= ny * lam * wb * t0;
          bx[s1] -= nx * lam * wb * t;
          by[s1] -= ny * lam * wb * t;

          // Momentum from approaching blobs transfers in full; leftover overlap only gets to
          // push apart gently (moving the previous positions absorbs the excess speed).
          const vrel =
            (a.vx[i] - (t0 * b.vx[s0] + t * b.vx[s1])) * nx + (a.vy[i] - (t0 * b.vy[s0] + t * b.vy[s1])) * ny;
          const excess = pen - Math.max(0, -vrel) * DT - MAX_SEPARATION_STEP;
          if (excess > 0) {
            const k = (excess / pen) * lam;
            a.px[i] += nx * k * wa;
            a.py[i] += ny * k * wa;
            b.px[s0] -= nx * k * wb * t0;
            b.py[s0] -= ny * k * wb * t0;
            b.px[s1] -= nx * k * wb * t;
            b.py[s1] -= ny * k * wb * t;
          }

          // Coulomb friction on the relative sliding during this substep.
          const rx = axs[i] - a.px[i] - (t0 * (bx[s0] - b.px[s0]) + t * (bx[s1] - b.px[s1]));
          const ry = ays[i] - a.py[i] - (t0 * (by[s0] - b.py[s0]) + t * (by[s1] - b.py[s1]));
          const rn = rx * nx + ry * ny;
          const tx = rx - rn * nx;
          const ty = ry - rn * ny;
          const tl = Math.sqrt(tx * tx + ty * ty);
          if (tl > 1e-9) {
            const f = tl < muS * pen ? 1 : Math.min(1, (muK * pen) / tl);
            const fl = f / W;
            axs[i] -= tx * fl * wa;
            ays[i] -= ty * fl * wa;
            bx[s0] += tx * fl * wb * t0;
            by[s0] += ty * fl * wb * t0;
            bx[s1] += tx * fl * wb * t;
            by[s1] += ty * fl * wb * t;
          }

          if (a.state === 'play' && b.state === 'play') {
            if (a.hasTouchedSurface || b.hasTouchedSurface) {
              a.hasTouchedSurface = true;
              b.hasTouchedSurface = true;
            }
          }
        }
      }
    }
  }

  finishSubstep(b) {
    const { n, x, y, px, py, vx, vy } = b;
    const inv = 1 / DT;
    let mx = 0;
    let my = 0;
    let mvx = 0;
    let mvy = 0;
    for (let i = 0; i < n; i++) {
      vx[i] = (x[i] - px[i]) * inv;
      vy[i] = (y[i] - py[i]) * inv;
      mx += x[i];
      my += y[i];
      mvx += vx[i];
      mvy += vy[i];
    }
    mx /= n;
    my /= n;
    mvx /= n;
    mvy /= n;

    // Damp wobble strongly and spin lightly, without slowing the blob's travel. Without the
    // spin damping a resting blob keeps circulating its beads like a tank tread.
    let L = 0;
    let I = 0;
    for (let i = 0; i < n; i++) {
      const rx = x[i] - mx;
      const ry = y[i] - my;
      L += rx * (vy[i] - mvy) - ry * (vx[i] - mvx);
      I += rx * rx + ry * ry;
    }
    const omega = (I > 1e-9 ? L / I : 0) * Math.exp(-PHYS.spinDamping * DT);
    const kd = Math.exp(-PHYS.wobbleDamping * DT);
    const ka = Math.exp(-PHYS.airDamping * DT);
    for (let i = 0; i < n; i++) {
      const rvx = mvx - omega * (y[i] - my);
      const rvy = mvy + omega * (x[i] - mx);
      let ux = (rvx + (vx[i] - rvx) * kd) * ka;
      let uy = (rvy + (vy[i] - rvy) * kd) * ka;
      const sp2 = ux * ux + uy * uy;
      if (sp2 > 2600 * 2600) {
        const s = 2600 / Math.sqrt(sp2);
        ux *= s;
        uy *= s;
      }
      vx[i] = ux;
      vy[i] = uy;
    }
    refreshMetrics(b);
  }

  // Fail-safes: rebuild a blob that tangled or blew up, and push out any skin that tunnelled
  // into a neighbour. Rare, but it keeps a run from ever breaking.
  repairShapes() {
    const blobs = this.blobs;
    for (const b of blobs) {
      const broken =
        !Number.isFinite(b.cx) ||
        !Number.isFinite(b.cy) ||
        b.area < b.restArea * 0.3 ||
        isTangled(b);
      if (broken) this.reshape(b);
    }
    for (let i = 0; i < blobs.length; i++) {
      const a = blobs[i];
      for (let j = i + 1; j < blobs.length; j++) {
        const b = blobs[j];
        if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
        if (a.value === b.value) continue;
        this.ejectInside(a, b);
        this.ejectInside(b, a);
      }
    }
  }

  reshape(b) {
    let cx = Number.isFinite(b.cx) ? b.cx : (BOX_LEFT + BOX_RIGHT) * 0.5;
    let cy = Number.isFinite(b.cy) ? b.cy : BOX_TOP + 120;
    const r = b.ring;
    cx = Math.max(BOX_LEFT + r + BEAD_R, Math.min(BOX_RIGHT - r - BEAD_R, cx));
    cy = Math.max(BOX_TOP + r + BEAD_R, Math.min(BOX_BOTTOM - r - BEAD_R, cy));
    const vX = Number.isFinite(b.velX) ? b.velX : 0;
    const vY = Number.isFinite(b.velY) ? b.velY : 0;
    for (let i = 0; i < b.n; i++) {
      const a = (i / b.n) * Math.PI * 2;
      b.x[i] = cx + Math.cos(a) * r;
      b.y[i] = cy + Math.sin(a) * r;
      b.vx[i] = vX;
      b.vy[i] = vY;
    }
    b.px.set(b.x);
    b.py.set(b.y);
    b.rx.set(b.x);
    b.ry.set(b.y);
    b.fixedFlash = 1;
    refreshMetrics(b);
    b.rcx = b.cx;
    b.rcy = b.cy;
  }

  ejectInside(a, b) {
    for (let i = 0; i < a.n; i++) {
      const px = a.x[i];
      const py = a.y[i];
      if (px < b.minX || px > b.maxX || py < b.minY || py > b.maxY) continue;
      if (!pointInRing(px, py, b)) continue;
      let bestD2 = Infinity;
      let qx = px;
      let qy = py;
      let nx = 0;
      let ny = 0;
      for (let s = 0; s < b.n; s++) {
        const e = s + 1 === b.n ? 0 : s + 1;
        const ex = b.x[e] - b.x[s];
        const ey = b.y[e] - b.y[s];
        const len2 = ex * ex + ey * ey || 1e-9;
        let t = ((px - b.x[s]) * ex + (py - b.y[s]) * ey) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = b.x[s] + ex * t;
        const cy = b.y[s] + ey * t;
        const d2 = (px - cx) ** 2 + (py - cy) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          qx = cx;
          qy = cy;
          const el = Math.sqrt(len2);
          nx = ey / el;
          ny = -ex / el;
        }
      }
      a.x[i] = qx + nx * CONTACT;
      a.y[i] = qy + ny * CONTACT;
    }
  }

  processMerges() {
    const consumed = new Set();
    for (const [a, b] of this.pendingMerges) {
      if (consumed.has(a.id) || consumed.has(b.id)) continue;
      if (a.value !== b.value) continue;
      consumed.add(a.id);
      consumed.add(b.id);
      if (this.aiming && (this.aiming.blob === a || this.aiming.blob === b)) this.aiming = null;

      const newValue = a.value * 2;
      const r = getRadiusForValue(newValue);
      const areaA = Math.max(1, a.area);
      const areaB = Math.max(1, b.area);
      let cx = (a.cx * areaA + b.cx * areaB) / (areaA + areaB);
      let cy = (a.cy * areaA + b.cy * areaB) / (areaA + areaB);
      cx = Math.max(BOX_LEFT + r * 0.75, Math.min(BOX_RIGHT - r * 0.75, cx));
      cy = Math.max(BOX_TOP + r * 0.75, Math.min(BOX_BOTTOM - r * 0.75, cy));

      const wasOnBar = a.state === 'bar' || b.state === 'bar';
      const wasMidAir = !wasOnBar && !a.hasTouchedSurface && !b.hasTouchedSurface;
      const chain = Math.max(a.chainCount, b.chainCount) + 1;
      const massA = a.mass;
      const massB = b.mass;
      const merged = createBlob(newValue, cx, cy, {
        state: a.state === 'bar' && b.state === 'bar' ? 'bar' : 'play',
        isBold: true,
        startScale: 0.78,
        velX: (a.velX * massA + b.velX * massB) / (massA + massB),
        velY: (a.velY * massA + b.velY * massB) / (massA + massB),
        age: 0.5,
        mergeCooldown: 0.06,
        hasTouchedSurface: a.hasTouchedSurface || b.hasTouchedSurface,
        chainCount: chain,
        chainTimer: 1.45,
        popFlash: 1,
      });
      this.blobs.push(merged);
      this.mergeCount++;
      if (newValue > this.maxBlob) this.maxBlob = newValue;
      if (newValue >= 8192) this.sprintReached8K = true;

      this.rings.push({ x: cx, y: cy, r: r * 0.7, maxR: r * 1.8, value: newValue, alpha: 0.7 });
      const drops = Math.min(12, 5 + tierOf(newValue));
      for (let p = 0; p < drops; p++) {
        const ang = (p / drops) * Math.PI * 2 + Math.random() * 0.5;
        const spd = 70 + Math.random() * 150;
        this.particles.push({
          x: cx + Math.cos(ang) * r * 0.6,
          y: cy + Math.sin(ang) * r * 0.6,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 40,
          r: 2 + Math.random() * 3,
          value: newValue,
          life: 1,
          decay: 2 + Math.random(),
        });
      }
      if (newValue >= 128 || chain >= 2) {
        this.shake = Math.min(7, this.shake + 1.5 + tierOf(newValue) * 0.25);
      }
      if (this.callbacks.onMerge) {
        this.callbacks.onMerge({
          blob: merged,
          newValue,
          chain,
          wasMidAir,
          wasOnBar,
          wasGentleDrop: a.wasGentleDrop || b.wasGentleDrop,
          wasHardShot: a.launchPower >= 0.78 || b.launchPower >= 0.78,
        });
      }
    }
    if (consumed.size > 0) this.blobs = this.blobs.filter((b) => !consumed.has(b.id));
  }

  // ---------- Game-over domes ----------

  stepBumpers(dt) {
    // Each dome is driven back by the sideways force of the pile against it, and also by
    // how far the settled pile on its side has climbed above it. The force alone is noisy:
    // blobs can arch on friction and barely lean on a dome even when the pile is too tall.
    const span = BOX_RIGHT - BOX_LEFT;
    const leftZone = BOX_LEFT + span * 0.34;
    const rightZone = BOX_RIGHT - span * 0.34;
    let topL = Infinity;
    let topR = Infinity;
    for (const b of this.blobs) {
      if (b.state !== 'play' || !b.hasTouchedSurface || b.age < 1) continue;
      if (Math.hypot(b.velX, b.velY) > 80) continue;
      if (b.minX < leftZone && b.minY < topL) topL = b.minY;
      if (b.maxX > rightZone && b.minY < topR) topR = b.minY;
    }
    const domeTop = BUMPER_Y - BUMPER_R;
    const heightPush = (top) => Math.max(0, Math.min(1, (domeTop - top) / 50)) * BUMPER_TRAVEL;

    for (let k = 0; k < 2; k++) {
      const d = this.domes[k];
      const forcePush = Math.min(BUMPER_TRAVEL, d.force / SUBSTEPS / PHYS.domeStiffness);
      const target = Math.max(0, forcePush, heightPush(k === 0 ? topL : topR));
      d.push += (target - d.push) * Math.min(1, dt * 7);
      d.gauge = d.push / BUMPER_TRAVEL;
    }
    // The run ends only when the pile shoves both domes all the way back at once.
    if (this.domes[0].gauge > 0.96 && this.domes[1].gauge > 0.96) this.overTimer += dt;
    else this.overTimer = Math.max(0, this.overTimer - dt * 2);
    if (this.overTimer > 0.35) this.triggerGameOver();
  }

  triggerGameOver() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.aiming = null;
    this.zap = 1;
    this.shake = 9;
    if (this.mode === 'sprint' && this.sprintReached8K) {
      this.sprintFinished = true;
      this.gameOverReason = 'sprint_win';
    } else {
      this.gameOverReason = 'overflow';
    }
    if (this.callbacks.onGameOver) {
      this.callbacks.onGameOver({
        score: this.score,
        maxBlob: this.maxBlob,
        mergeCount: this.mergeCount,
        elapsedTime: this.elapsedTime,
        sprintWin: this.sprintFinished,
      });
    }
  }

  recomputeScore() {
    let total = 0;
    for (const b of this.blobs) if (b.isBold) total += b.value;
    this.score = total;
    if (this.callbacks.onStateTick) this.callbacks.onStateTick(this.blobs, this.score);
  }

  stepEffects(dt) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 22);
    if (this.zap > 0) this.zap = Math.max(0, this.zap - dt * 1.6);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.r += (ring.maxR - ring.r) * Math.min(1, dt * 10);
      ring.alpha -= dt * 2.4;
      if (ring.alpha <= 0.02) this.rings.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += 520 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // ---------- Save / resume ----------

  serialize() {
    if (this.gameOver) return null;
    return {
      v: 2,
      mode: this.mode,
      maxBlob: this.maxBlob,
      mergeCount: this.mergeCount,
      launchCount: this.launchCount,
      elapsedTime: this.elapsedTime,
      sprintReached8K: this.sprintReached8K,
      blobs: this.blobs.map((b) => ({
        value: b.value,
        isBold: b.isBold,
        state: b.state,
        cx: Math.round(b.cx * 10) / 10,
        cy: Math.round(b.cy * 10) / 10,
        hasTouchedSurface: b.hasTouchedSurface,
      })),
    };
  }

  deserialize(data) {
    if (!data || (data.v !== 1 && data.v !== 2) || !Array.isArray(data.blobs) || data.blobs.length === 0) {
      return false;
    }
    this.reset(data.mode || 'classic');
    this.blobs = [];
    this.maxBlob = data.maxBlob || 4;
    this.mergeCount = data.mergeCount || 0;
    this.launchCount = data.launchCount || 0;
    this.elapsedTime = data.elapsedTime || 0;
    this.sprintReached8K = Boolean(data.sprintReached8K);
    for (const item of data.blobs) {
      const r = getRadiusForValue(item.value);
      const cx = Math.max(BOX_LEFT + r, Math.min(BOX_RIGHT - r, Number(item.cx) || WORLD_W / 2));
      const cy = Math.max(BOX_TOP + r, Math.min(BOX_BOTTOM - r, Number(item.cy) || WORLD_H / 2));
      this.blobs.push(
        createBlob(item.value, cx, cy, {
          state: item.state === 'play' ? 'play' : 'bar',
          isBold: Boolean(item.isBold),
          age: 1,
          hasTouchedSurface: item.state === 'play' ? true : Boolean(item.hasTouchedSurface),
        })
      );
    }
    this.updateRays();
    this.recomputeScore();
    return true;
  }
}

export function formatBlobNumber(val) {
  return String(val);
}

// Aim vector for the current drag: from the grab point on the blob toward the finger.
export function getAimVector(aim, cx, cy) {
  const ox = cx + aim.offX;
  const oy = cy + aim.offY;
  const dx = aim.tipX - ox;
  const dy = aim.tipY - oy;
  const dist = Math.hypot(dx, dy);
  const len = Math.min(dist, MAX_DRAG);
  return {
    ox,
    oy,
    dist,
    len,
    dirX: dist > 1e-6 ? dx / dist : 0,
    dirY: dist > 1e-6 ? dy / dist : 1,
    power: len / MAX_DRAG,
  };
}
