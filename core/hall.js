/**
 * Game Hall Controller (游戏大厅核心)
 * - Renders featured & catalog games from games/registry.js
 * - Provides live squishy preview canvas for Sobosuba
 * - Handles dynamic mounting/unmounting, hash routing, and shared services (storage, audio, toast)
 */

import { GAMES, FUTURE_SLOTS } from '../games/registry.js?v=8';
import { createNamespaceStorage, hallStorage } from './storage.js';
import { sharedAudio } from './audio.js';
import { isNativeApp } from './platform.js';

const hallView = document.getElementById('hall-view');
const gameStage = document.getElementById('game-stage');
const featuredSlot = document.getElementById('hall-featured-slot');
const gameGrid = document.getElementById('hall-game-grid');
const gameCountEl = document.getElementById('hall-game-count');
const toastLayer = document.getElementById('toast-layer');
const btnSound = document.getElementById('btn-hall-sound');
const btnTheme = document.getElementById('btn-hall-theme');
const metaThemeColor = document.getElementById('meta-theme-color');

let activeGame = null;
let activeGameInstance = null;
let previewRaf = null;

// ---------- Theme Management ----------

function applyHallTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  hallStorage.set('theme', theme);
  btnTheme.innerHTML = theme === 'dark' ? '🌙' : '☀️';
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme === 'dark' ? '#14131A' : '#FFF8F2');
  }
}

const savedTheme = hallStorage.get('theme', 'light');
applyHallTheme(savedTheme);

btnTheme.addEventListener('click', () => {
  sharedAudio.playClick();
  const cur = document.documentElement.getAttribute('data-theme');
  applyHallTheme(cur === 'dark' ? 'light' : 'dark');
});

// ---------- Audio Button ----------

function syncSoundButton() {
  btnSound.innerHTML = sharedAudio.isMuted() ? '🔇' : '🔊';
}
syncSoundButton();
sharedAudio.onChange(syncSoundButton);

btnSound.addEventListener('click', () => {
  sharedAudio.toggleMute();
});

// ---------- Global Toast ----------

export function showToast(message, icon = '✨', duration = 2600) {
  const pill = document.createElement('div');
  pill.className = 'toast-pill';
  pill.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  toastLayer.appendChild(pill);
  setTimeout(() => {
    pill.classList.add('fade-out');
    setTimeout(() => pill.remove(), 240);
  }, duration);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ---------- Hall Stats Helper ----------

function getGameSummaryStats(gameId) {
  const store = createNamespaceStorage(`game:${gameId}`);
  return store.get('hall_stats', {
    bestScore: 0,
    maxBlob: 0,
    achievementsUnlocked: 0,
    achievementsTotal: 16,
  });
}

// ---------- Live Jelly Preview Animation in Hall ----------

function startHeroPreview(canvas) {
  stopHeroPreview();
  const ctx = canvas.getContext('2d');
  const blobs = [
    { x: 0.28, y: 0.62, r: 34, val: '16', color: '#FF7EA5', dark: '#E2517D', phase: 0.0, vx: 0.14 },
    { x: 0.54, y: 0.56, r: 44, val: '64', color: '#FFB75E', dark: '#E68B29', phase: 1.7, vx: -0.11 },
    { x: 0.76, y: 0.68, r: 28, val: '4', color: '#6CD4FF', dark: '#30A8E8', phase: 3.1, vx: -0.16 },
    { x: 0.42, y: 0.24, r: 23, val: '2', color: '#A98BFF', dark: '#7B5BE6', phase: 4.5, vx: 0.12 },
  ];

  function drawSquishyBlob(cx, cy, r, val, color, dark, t, phase) {
    const pts = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const wobble =
        1 +
        Math.sin(a * 2 + t * 2.6 + phase) * 0.06 +
        Math.cos(a * 3 - t * 2.0 + phase) * 0.04;
      const squashY = 1 + Math.sin(t * 2.4 + phase) * 0.055;
      const squashX = 1 / squashY;
      pts.push({
        x: cx + Math.cos(a) * r * wobble * squashX,
        y: cy + Math.sin(a) * r * wobble * squashY,
      });
    }

    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      const mx = (p0.x + p1.x) * 0.5;
      const my = (p0.y + p1.y) * 0.5;
      if (i === 0) {
        const prev = pts[n - 1];
        ctx.moveTo((prev.x + p0.x) * 0.5, (prev.y + p0.y) * 0.5);
      }
      ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
    }
    ctx.closePath();

    const grad = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.3, r * 0.12, cx, cy, r * 1.15);
    grad.addColorStop(0, '#FFFFFF');
    grad.addColorStop(0.18, color);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.fill();

    // Specular highlight
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.26, cy - r * 0.32, r * 0.28, r * 0.13, -0.45, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fill();

    // Cute eyes (cleanly spaced above the number)
    const eyeY = cy - r * 0.34;
    const eyeDx = r * 0.23;
    const blink = Math.sin(t * 1.3 + phase * 2) > 0.96 ? 0.25 : 1;
    ctx.fillStyle = 'rgba(38, 22, 34, 0.85)';
    ctx.beginPath();
    ctx.ellipse(cx - eyeDx, eyeY, r * 0.068, r * 0.072 * blink, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + eyeDx, eyeY, r * 0.068, r * 0.072 * blink, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bold number
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 ${Math.round(r * 0.52)}px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 4;
    ctx.fillText(val, cx, cy + r * 0.22);
    ctx.restore();
  }

  function frame(now) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(10, Math.round(rect.width * dpr));
    const h = Math.max(10, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const t = now * 0.001;
    ctx.save();
    ctx.scale(dpr, dpr);
    const cw = rect.width;
    const ch = rect.height;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, cw, ch);
    bg.addColorStop(0, '#1C1E2E');
    bg.addColorStop(1, '#27223B');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);

    // Subtle float bar line
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(22, ch * 0.24);
    ctx.lineTo(cw - 22, ch * 0.24);
    ctx.stroke();

    // Bumper accents
    ctx.fillStyle = 'rgba(255, 123, 163, 0.35)';
    ctx.fillRect(16, ch * 0.36, cw * 0.24, 5);
    ctx.fillRect(cw - 16 - cw * 0.24, ch * 0.36, cw * 0.24, 5);

    const scale = Math.min(cw / 320, ch / 220);
    for (const b of blobs) {
      const bx = b.x * cw + Math.sin(t * 0.9 + b.phase) * 14 * scale;
      const by = b.y * ch + Math.cos(t * 1.4 + b.phase) * 7 * scale;
      drawSquishyBlob(bx, by, b.r * scale, b.val, b.color, b.dark, t, b.phase);
    }

    ctx.restore();
    previewRaf = requestAnimationFrame(frame);
  }

  previewRaf = requestAnimationFrame(frame);
}

function stopHeroPreview() {
  if (previewRaf) {
    cancelAnimationFrame(previewRaf);
    previewRaf = null;
  }
}

// ---------- Render Hall ----------

function renderHall() {
  const readyGames = GAMES.filter((g) => g.status === 'ready');
  gameCountEl.textContent = `${readyGames.length} 款已就绪`;

  const featured = readyGames.find((g) => g.featured) || readyGames[0];
  if (featured) {
    const stats = getGameSummaryStats(featured.id);
    const hasSave = Boolean(createNamespaceStorage(`game:${featured.id}`).get('saved_run', null));

    featuredSlot.innerHTML = `
      <article class="featured-card">
        <div class="featured-info">
          <div class="featured-kicker">✨ 今日推荐 · 软体物理新作</div>
          <h2 class="featured-title">${escapeHtml(featured.title)}</h2>
          <p class="featured-desc">${escapeHtml(featured.description)}</p>
          <div class="featured-stats">
            <div class="stat-chip"><span>最高分</span><strong>${stats.bestScore || 0}</strong></div>
            <div class="stat-chip"><span>最大果冻</span><strong>${stats.maxBlob || '—'}</strong></div>
            <div class="stat-chip"><span>成就</span><strong>${stats.achievementsUnlocked || 0}/${stats.achievementsTotal || 16}</strong></div>
          </div>
          <div class="featured-cta-row">
            <button class="btn-primary" data-launch="${featured.id}">
              <span>▶</span>
              <span>${hasSave ? '继续上次进度' : '立即开始玩'}</span>
            </button>
            ${hasSave ? `<button class="btn-secondary" data-launch="${featured.id}" data-fresh="1">开一局新的</button>` : ''}
          </div>
        </div>
        <div class="featured-preview-wrap" data-launch="${featured.id}" role="button" tabindex="0" aria-label="开始玩 ${escapeHtml(featured.title)}">
          <canvas class="featured-preview-canvas" id="hero-preview-canvas"></canvas>
          <span class="preview-badge">点击开玩 · 触屏手感优化</span>
        </div>
      </article>
    `;

    const previewCanvas = document.getElementById('hero-preview-canvas');
    if (previewCanvas) startHeroPreview(previewCanvas);
  }

  // Render Game Cards + Future Extension Slots
  const cardsHtml = [];
  for (const game of readyGames) {
    const stats = getGameSummaryStats(game.id);
    const statValue = game.staticStatText || (stats.bestScore || 0);
    cardsHtml.push(`
      <article class="game-card" data-launch="${game.id}" role="button" tabindex="0">
        <div>
          <div class="game-card-top">
            <div class="game-card-icon" style="background:${game.accentSoft}">${game.emoji || '🫧'}</div>
            <div>
              <h3 class="game-card-title">${escapeHtml(game.title)}</h3>
              <p class="game-card-sub">${escapeHtml(game.subtitle)}</p>
            </div>
          </div>
          <div class="tag-row" style="margin-top:12px;">
            ${game.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
          </div>
        </div>
        <div class="game-card-foot">
          <span>${escapeHtml(game.statsLabel || '最高分')}：<strong>${statValue}</strong></span>
          <span class="play-link" style="color:${game.accent || 'var(--accent)'}">进入游戏 →</span>
        </div>
      </article>
    `);
  }

  for (const slot of FUTURE_SLOTS) {
    cardsHtml.push(`
      <article class="game-card placeholder">
        <div>
          <div class="game-card-top">
            <div class="game-card-icon">${slot.emoji}</div>
            <div>
              <h3 class="game-card-title">${escapeHtml(slot.title)}</h3>
              <p class="game-card-sub">${escapeHtml(slot.subtitle)}</p>
            </div>
          </div>
          <div class="tag-row" style="margin-top:12px;">
            ${slot.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
          </div>
        </div>
        <div class="game-card-foot">
          <span>插件式大厅架构</span>
          <span>等待加入</span>
        </div>
      </article>
    `);
  }

  gameGrid.innerHTML = cardsHtml.join('');

  // Wire launch clicks
  document.querySelectorAll('[data-launch]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const gameId = el.getAttribute('data-launch');
      const fresh = el.getAttribute('data-fresh') === '1';
      sharedAudio.playClick();
      launchGame(gameId, { fresh });
    });
  });
}

// ---------- Game Lifecycle & Routing ----------

async function launchGame(gameId, options = {}) {
  const entry = GAMES.find((g) => g.id === gameId);
  if (!entry) {
    showToast('未找到该游戏', '⚠️');
    return;
  }

  if (activeGameInstance) {
    await unmountActiveGame();
  }

  stopHeroPreview();
  hallView.classList.add('hidden');
  gameStage.classList.remove('hidden');
  document.body.classList.add('in-game');
  gameStage.innerHTML = '';

  try {
    const mod = await entry.load();
    const gamePlugin = mod.default || mod;
    const gameStore = createNamespaceStorage(`game:${entry.id}`);

    const ctx = {
      gameId: entry.id,
      storage: gameStore,
      audio: sharedAudio,
      toast: showToast,
      options,
      goHome: () => {
        if (window.location.hash !== '#/' && window.location.hash !== '') {
          window.location.hash = '#/';
        } else {
          returnToHall();
        }
      },
      reportStats: (stats) => {
        const prev = gameStore.get('hall_stats', {});
        gameStore.set('hall_stats', { ...prev, ...stats });
      },
      setThemeColor: (hex) => {
        if (metaThemeColor && hex) metaThemeColor.setAttribute('content', hex);
      },
    };

    activeGame = entry;
    activeGameInstance = await gamePlugin.mount(gameStage, ctx);

    const targetHash = `#/game/${entry.id}`;
    if (window.location.hash !== targetHash) {
      history.pushState({ gameId: entry.id }, '', targetHash);
    }
  } catch (err) {
    console.error('Failed to launch game:', err);
    showToast('游戏加载失败，请刷新重试', '⚠️');
    returnToHall();
  }
}

async function unmountActiveGame() {
  if (activeGameInstance && typeof activeGameInstance.unmount === 'function') {
    try {
      activeGameInstance.unmount();
    } catch (err) {
      console.error('Unmount error:', err);
    }
  }
  activeGameInstance = null;
  activeGame = null;
  gameStage.innerHTML = '';
}

async function returnToHall() {
  await unmountActiveGame();
  document.body.classList.remove('in-game');
  gameStage.classList.add('hidden');
  hallView.classList.remove('hidden');
  applyHallTheme(hallStorage.get('theme', 'light'));
  renderHall();
}

window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  const match = hash.match(/^#\/game\/([a-z0-9_-]+)$/i);
  if (match) {
    if (!activeGame || activeGame.id !== match[1]) {
      launchGame(match[1]);
    }
  } else if (activeGame) {
    returnToHall();
  }
});

// Boot
renderHall();
const initialMatch = window.location.hash.match(/^#\/game\/([a-z0-9_-]+)$/i);
if (initialMatch) {
  launchGame(initialMatch[1]);
}

if (!isNativeApp) {
  // Website: link to the app download page.
  const appLink = document.createElement('a');
  appLink.className = 'icon-pill';
  appLink.href = './download/index.html';
  appLink.title = '下载 App';
  appLink.setAttribute('aria-label', '下载 App');
  appLink.style.textDecoration = 'none';
  appLink.textContent = '📱';
  document.querySelector('.hall-actions')?.prepend(appLink);
}

if (isNativeApp) {
  document.documentElement.classList.add('native-app');
  import('./app-shell.js')
    .then((m) =>
      m.initAppShell({
        showToast,
        // Android back button: let the game handle it first (e.g. table → lobby), else go to the hall.
        back: () => {
          if (!activeGame) return false;
          if (activeGameInstance?.onBack?.()) return true;
          window.location.hash = '#/';
          return true;
        },
      }),
    )
    .catch((err) => console.warn('app shell', err));
}
