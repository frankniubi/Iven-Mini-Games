/**
 * Canvas renderer for Sobosuba.
 * Draws the chamfered box, the spawn indicators and grab dots, the game-over domes on the
 * side walls, and every blob as its own deformed outline. The default "flat" look fills each
 * blob with a single colour and keeps the number the same size on every blob; the optional
 * "gloss" look adds a jelly gradient and highlight.
 */

import {
  WORLD_W,
  WORLD_H,
  BOX_LEFT,
  BOX_RIGHT,
  BOX_TOP,
  BOX_BOTTOM,
  CHAMFER,
  RAY_FULL,
  BUMPER_Y,
  BUMPER_R,
  BUMPER_REACH,
  SKIN_OFFSET,
  getAimVector,
} from './physics.js?v=7';
import { getBlobColors } from './styles.js?v=7';

const FRAME = 14;
const NUMBER_SIZE = 15;
const FONT = '"SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';

const PX = new Float64Array(64);
const PY = new Float64Array(64);
const QX = new Float64Array(64);
const QY = new Float64Array(64);

const rgbCache = new Map();
function hexToRgb(hex) {
  let rgb = rgbCache.get(hex);
  if (!rgb) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full.slice(0, 6), 16);
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, rgb);
  }
  return rgb;
}

function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)}, ${Math.round(a[1] + (b[1] - a[1]) * t)}, ${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Chamfered box outline, grown outward by `grow` while keeping the 45° cuts parallel.
function boxPath(ctx, grow) {
  const l = BOX_LEFT - grow;
  const r = BOX_RIGHT + grow;
  const t = BOX_TOP - grow;
  const b = BOX_BOTTOM + grow;
  const c = CHAMFER + grow * (2 - Math.SQRT2);
  ctx.beginPath();
  ctx.moveTo(l, t);
  ctx.lineTo(r, t);
  ctx.lineTo(r, b - c);
  ctx.lineTo(r - c, b);
  ctx.lineTo(l + c, b);
  ctx.lineTo(l, b - c);
  ctx.closePath();
}

function capsule(ctx, x, y, w, h) {
  const r = Math.min(w, h) * 0.5;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
}

export class SobosubaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    const pw = Math.round(rect.width * dpr);
    const ph = Math.round(rect.height * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    this.offsetX = (rect.width - WORLD_W * this.scale) * 0.5;
    this.offsetY = (rect.height - WORLD_H * this.scale) * 0.5;
  }

  clientToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.offsetX) / this.scale,
      y: (clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  render(world, style, options = {}) {
    const ctx = this.ctx;
    const gloss = options.renderMode === 'gloss';
    const showFaces = Boolean(options.showFaces);
    const alpha = world.alpha ?? 1;
    const now = performance.now() * 0.001;
    const innerLight = luminance(style.boardInner) > 0.5;
    const ink = innerLight ? style.pageText : '#FFFFFF';

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    let shakeX = 0;
    let shakeY = 0;
    if (world.shake > 0.15) {
      shakeX = (Math.random() - 0.5) * world.shake;
      shakeY = (Math.random() - 0.5) * world.shake;
    }
    ctx.translate(this.offsetX + shakeX * this.scale, this.offsetY + shakeY * this.scale);
    ctx.scale(this.scale, this.scale);

    // Frame (a thick round-joined stroke around the box) and the dark cavity.
    ctx.lineJoin = 'round';
    ctx.lineWidth = FRAME * 2;
    ctx.strokeStyle = style.boardBg;
    boxPath(ctx, 0);
    ctx.stroke();
    ctx.fillStyle = style.boardInner;
    boxPath(ctx, 0);
    ctx.fill();

    this.drawIndicators(ctx, world, style);
    this.drawDomeGauges(ctx, world, style);

    ctx.save();
    boxPath(ctx, 0);
    ctx.clip();

    this.drawDomes(ctx, world, style);
    this.drawGrabDots(ctx, world, style, ink);
    if (world.launchCount === 0 && !world.aiming) this.drawStarterHint(ctx, ink, now);

    for (const ring of world.rings) {
      ctx.globalAlpha = Math.max(0, ring.alpha * 0.6);
      ctx.strokeStyle = getBlobColors(style, ring.value).light;
      ctx.lineWidth = 3 * ring.alpha;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const aimed = world.aiming ? world.aiming.blob : null;
    for (const b of world.blobs) if (b.state === 'play' && b !== aimed) this.drawBlob(ctx, b, alpha, style, gloss, showFaces, now, false);
    for (const b of world.blobs) if (b.state === 'bar' && b !== aimed) this.drawBlob(ctx, b, alpha, style, gloss, showFaces, now, false);
    if (aimed) this.drawBlob(ctx, aimed, alpha, style, gloss, showFaces, now, true);

    for (const p of world.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = getBlobColors(style, p.value).light;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * Math.max(0.3, p.life), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (world.aiming) this.drawAim(ctx, world.aiming, alpha, ink, style);

    if (world.zap > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${world.zap * 0.55})`;
      ctx.fillRect(BOX_LEFT, BOX_TOP, BOX_RIGHT - BOX_LEFT, BOX_BOTTOM - BOX_TOP);
    }

    ctx.restore();
    ctx.restore();
  }

  // Spawn indicators in the top frame: each fills with the free space between the wall and
  // the row of waiting blobs; a new blob drops in on that side once it is full.
  drawIndicators(ctx, world, style) {
    const y = BOX_TOP - FRAME * 0.5 - 2;
    const h = 4;
    capsule(ctx, BOX_LEFT + 2, y, RAY_FULL, h);
    ctx.fillStyle = style.barTrack;
    ctx.fill();
    capsule(ctx, BOX_RIGHT - 2 - RAY_FULL, y, RAY_FULL, h);
    ctx.fill();

    ctx.fillStyle = style.rayFill;
    const lw = Math.max(h, world.leftRay * RAY_FULL);
    capsule(ctx, BOX_LEFT + 2, y, lw, h);
    ctx.fill();
    const rw = Math.max(h, world.rightRay * RAY_FULL);
    capsule(ctx, BOX_RIGHT - 2 - rw, y, rw, h);
    ctx.fill();
  }

  // Slots in the side frame show how far each dome has been shoved back.
  drawDomeGauges(ctx, world, style) {
    const half = 30;
    for (const d of world.domes) {
      const x = d.side === 'left' ? BOX_LEFT - FRAME * 0.5 - 2 : BOX_RIGHT + FRAME * 0.5 - 2;
      capsule(ctx, x, BUMPER_Y - half, 4, half * 2);
      ctx.fillStyle = style.barTrack;
      ctx.fill();
      if (d.gauge > 0.02) {
        const fh = Math.max(4, d.gauge * half * 2);
        capsule(ctx, x, BUMPER_Y - fh * 0.5, 4, fh);
        ctx.fillStyle = d.gauge > 0.7 ? style.bumperDanger : style.bumperWarn;
        ctx.fill();
      }
    }
  }

  drawDomes(ctx, world, style) {
    for (const d of world.domes) {
      const cx =
        d.side === 'left' ? BOX_LEFT - BUMPER_R + BUMPER_REACH - d.push : BOX_RIGHT + BUMPER_R - BUMPER_REACH + d.push;
      const base = mix(style.boardBg, innerLuma(style) ? '#000000' : '#FFFFFF', 0.16);
      ctx.fillStyle = d.gauge > 0.05 ? mixRgb(base, style.bumperDanger, d.gauge * d.gauge * 0.85) : base;
      ctx.beginPath();
      ctx.arc(cx, BUMPER_Y, BUMPER_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = style.boardBg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, BUMPER_Y, BUMPER_R - 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawGrabDots(ctx, world, style, ink) {
    const aimed = world.aiming ? world.aiming.blob : null;
    const alpha = world.alpha ?? 1;
    for (const b of world.blobs) {
      if (b.state !== 'bar') continue;
      const x = b.rcx + (b.cx - b.rcx) * alpha;
      ctx.fillStyle = b === aimed ? ink : style.barLine;
      ctx.beginPath();
      ctx.arc(x, BOX_TOP + 6, b === aimed ? 3.4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawStarterHint(ctx, ink, now) {
    const bob = Math.sin(now * 3) * 4;
    ctx.save();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.5;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText('按住上面的果冻，往外拖再松手发射', WORLD_W / 2, 330 + bob);
    ctx.globalAlpha = 0.36;
    ctx.font = `600 11.5px ${FONT}`;
    ctx.fillText('轻点直接落下 · 拖回原点取消 · 同数字相碰合成', WORLD_W / 2, 352 + bob);
    ctx.restore();
  }

  traceOutline(ctx, n, smooth) {
    ctx.beginPath();
    if (smooth) {
      ctx.moveTo((QX[n - 1] + QX[0]) * 0.5, (QY[n - 1] + QY[0]) * 0.5);
      for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        ctx.quadraticCurveTo(QX[i], QY[i], (QX[i] + QX[j]) * 0.5, (QY[i] + QY[j]) * 0.5);
      }
    } else {
      ctx.moveTo(QX[0], QY[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(QX[i], QY[i]);
    }
    ctx.closePath();
  }

  drawBlob(ctx, b, alpha, style, gloss, showFaces, now, selected) {
    const n = b.n;
    for (let i = 0; i < n; i++) {
      PX[i] = b.rx[i] + (b.x[i] - b.rx[i]) * alpha;
      PY[i] = b.ry[i] + (b.y[i] - b.ry[i]) * alpha;
    }
    // The fill sits slightly outside the bead centres, leaving a thin seam between blobs.
    for (let i = 0; i < n; i++) {
      const prev = i === 0 ? n - 1 : i - 1;
      const next = i + 1 === n ? 0 : i + 1;
      const tx = PX[next] - PX[prev];
      const ty = PY[next] - PY[prev];
      const tl = Math.sqrt(tx * tx + ty * ty) || 1;
      let qx = PX[i] + (ty / tl) * SKIN_OFFSET;
      let qy = PY[i] - (tx / tl) * SKIN_OFFSET;
      qx = qx < BOX_LEFT ? BOX_LEFT : qx > BOX_RIGHT ? BOX_RIGHT : qx;
      qy = qy < BOX_TOP ? BOX_TOP : qy > BOX_BOTTOM ? BOX_BOTTOM : qy;
      QX[i] = qx;
      QY[i] = qy;
    }
    const colors = getBlobColors(style, b.value);
    const cx = b.rcx + (b.cx - b.rcx) * alpha;
    const cy = b.rcy + (b.cy - b.rcy) * alpha;
    const r = b.radius;

    ctx.lineJoin = 'round';
    this.traceOutline(ctx, n, gloss);
    if (gloss) {
      const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.3);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.16, colors.light);
      grad.addColorStop(1, colors.dark);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = colors.light;
    }
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = gloss ? 'rgba(255,255,255,0.28)' : colors.light;
    ctx.stroke();

    if (gloss) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = `rgba(255,255,255,${style.glossAlpha})`;
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.28, cy - r * 0.36, r * 0.3, r * 0.14, -0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (b.popFlash > 0.02) {
      ctx.globalAlpha = b.popFlash * 0.35;
      ctx.fillStyle = '#FFFFFF';
      this.traceOutline(ctx, n, gloss);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (selected) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = luminance(style.boardInner) > 0.5 ? style.pageText : '#FFFFFF';
      this.traceOutline(ctx, n, gloss);
      ctx.stroke();
    }

    const fillLight = luminance(colors.light) > 0.5;
    let numY = cy + 1;
    if (showFaces && r >= 18) {
      const eyeY = cy - Math.min(r * 0.42, 15);
      const blink = Math.sin(now * 1.15 + b.id * 1.7) > 0.975 ? 0.25 : 1;
      const er = Math.max(1.8, Math.min(3.6, r * 0.07));
      ctx.fillStyle = style.eyeColor;
      ctx.beginPath();
      ctx.ellipse(cx - 7, eyeY, er, er * blink, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 7, eyeY, er, er * blink, 0, 0, Math.PI * 2);
      ctx.fill();
      numY = cy + 4;
    }

    // Same number size on every blob. Faded (a darker shade of the blob) until the blob has
    // been part of a merge, then bold.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (b.isBold) {
      ctx.font = `800 ${NUMBER_SIZE}px ${FONT}`;
      ctx.fillStyle = fillLight ? 'rgba(12, 12, 16, 0.92)' : '#FFFFFF';
    } else {
      ctx.font = `700 ${NUMBER_SIZE}px ${FONT}`;
      ctx.fillStyle = mix(colors.light, fillLight ? '#000000' : '#FFFFFF', 0.4);
    }
    ctx.fillText(String(b.value), cx, numY);

    if (b.fixedFlash > 0) {
      ctx.globalAlpha = Math.min(1, b.fixedFlash * 1.5);
      ctx.font = `700 10px ${FONT}`;
      ctx.fillStyle = luminance(style.boardInner) > 0.5 ? style.pageText : '#FFFFFF';
      ctx.fillText('形状已修正', cx, cy - r - 8);
      ctx.globalAlpha = 1;
    }
  }

  drawAim(ctx, aim, alpha, ink) {
    const b = aim.blob;
    const cx = b.rcx + (b.cx - b.rcx) * alpha;
    const cy = b.rcy + (b.cy - b.rcy) * alpha;
    const v = getAimVector(aim, cx, cy);

    ctx.save();
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (aim.cancelled) {
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(v.ox, v.oy, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(v.ox, v.oy, 5, 0, Math.PI * 2);
    ctx.fill();

    if (aim.pulledOut && !aim.cancelled && v.len > 6) {
      const tx = v.ox + v.dirX * v.len;
      const ty = v.oy + v.dirY * v.len;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(v.ox, v.oy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const head = 13;
      const ang = Math.atan2(v.dirY, v.dirX);
      ctx.beginPath();
      ctx.moveTo(tx - Math.cos(ang - 0.5) * head, ty - Math.sin(ang - 0.5) * head);
      ctx.lineTo(tx, ty);
      ctx.lineTo(tx - Math.cos(ang + 0.5) * head, ty - Math.sin(ang + 0.5) * head);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function innerLuma(style) {
  return luminance(style.boardInner) > 0.5;
}

function mixRgb(rgbStr, hex, t) {
  const m = rgbStr.match(/\d+/g).map(Number);
  const b = hexToRgb(hex);
  return `rgb(${Math.round(m[0] + (b[0] - m[0]) * t)}, ${Math.round(m[1] + (b[1] - m[1]) * t)}, ${Math.round(m[2] + (b[2] - m[2]) * t)})`;
}
