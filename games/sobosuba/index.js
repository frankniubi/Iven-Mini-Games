/**
 * Sobosuba Game Plugin for Arcade Box Game Hall
 * Implements standard Game Interface: { mount(container, ctx) -> { unmount() } }
 */

import { SobosubaWorld, getAimVector } from './physics.js?v=7';
import { SobosubaRenderer } from './renderer.js?v=7';
import { SOBO_STYLES, getStyleById } from './styles.js?v=7';
import { createSoboAudio } from './audio.js?v=7';
import { ACHIEVEMENTS, createAchievementTracker } from './achievements.js?v=7';

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export default {
  mount(container, ctx) {
    const { storage, audio: sharedAudio, toast, goHome, reportStats, setThemeColor, options } = ctx;
    const soboAudio = createSoboAudio(sharedAudio);

    // Persisted preferences & records
    const prefs = {
      styleId: storage.get('style_id', 'classic'),
      renderMode: storage.get('render_mode', 'flat'), // 'flat' | 'gloss'
      showFaces: storage.get('show_faces', false),
      mode: storage.get('mode', 'classic'), // 'classic' | 'sprint'
    };

    let bestScore = Number(storage.get('best_score', 0)) || 0;
    let bestMaxBlob = Number(storage.get('best_max_blob', 0)) || 0;
    let bestSprintTime = storage.get('best_sprint_time', null);

    let currentStyle = getStyleById(prefs.styleId);
    let modalBackdrop = null;
    let rafId = null;
    let lastTs = 0;
    let saveTimer = 0;
    let activePointerId = null;

    // Achievements tracker
    const achTracker = createAchievementTracker(storage, (def) => {
      soboAudio.playAchievement();
      toast(`解锁成就：${def.title}`, def.icon, 3200);
      syncHallStats();
    });

    function syncHallStats() {
      reportStats({
        bestScore,
        maxBlob: bestMaxBlob,
        achievementsUnlocked: achTracker.getCount(),
        achievementsTotal: achTracker.getTotal(),
      });
    }

    // Build DOM Shell
    container.innerHTML = `
      <div class="sobo-root" id="sobo-root">
        <header class="sobo-topbar">
          <div class="sobo-topbar-left">
            <button class="sobo-btn" id="sobo-back" aria-label="返回大厅" title="返回大厅">
              <span>←</span><span class="btn-label">大厅</span>
            </button>
            <button class="sobo-btn" id="sobo-restart" aria-label="重新开始" title="重新开始">
              <span>↻</span><span class="btn-label">重开</span>
            </button>
          </div>

          <div class="sobo-score-cluster" id="sobo-score-cluster">
            <div class="sobo-score-box">
              <span class="sobo-score-label" id="sobo-primary-label">分数</span>
              <span class="sobo-score-val" id="sobo-score">0</span>
            </div>
            <div class="sobo-score-sep"></div>
            <div class="sobo-score-box">
              <span class="sobo-score-label" id="sobo-best-label">最高</span>
              <span class="sobo-score-val" id="sobo-best">${bestScore}</span>
            </div>
          </div>

          <div class="sobo-topbar-right">
            <button class="sobo-btn" id="sobo-styles" aria-label="配色主题" title="配色主题">
              <span>🎨</span><span class="btn-label">配色</span>
            </button>
            <button class="sobo-btn" id="sobo-ach" aria-label="成就" title="成就">
              <span>🏆</span><span class="btn-label" id="sobo-ach-label">${achTracker.getCount()}/${achTracker.getTotal()}</span>
            </button>
            <button class="sobo-btn" id="sobo-settings" aria-label="设置与玩法" title="设置与玩法">
              <span>⚙️</span>
            </button>
          </div>
        </header>

        <div class="sobo-main-layout">
          <div class="sobo-canvas-wrap" id="sobo-canvas-wrap">
            <canvas class="sobo-canvas" id="sobo-canvas"></canvas>
          </div>

          <!-- Shown automatically on iPad Landscape & Desktop -->
          <aside class="sobo-side-panel">
            <div class="sobo-side-card">
              <h3>当前战绩</h3>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
                <span style="font-size:12.5px;opacity:0.75;">当前模式</span>
                <strong id="side-mode-text" style="font-size:14px;">经典高分</strong>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
                <span style="font-size:12.5px;opacity:0.75;">本局最大果冻</span>
                <strong id="side-max-blob" style="font-size:18px;">4</strong>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;">
                <span style="font-size:12.5px;opacity:0.75;">已合成次数</span>
                <strong id="side-merges" style="font-size:16px;">0</strong>
              </div>
            </div>

            <div class="sobo-side-card">
              <h3>快速切换配色</h3>
              <div class="sobo-style-dots" id="side-style-dots"></div>
            </div>

            <div class="sobo-side-card">
              <h3>Sobosuba 小技巧</h3>
              <ul class="sobo-tips-list">
                <li><strong>轻点</strong>顶栏果冻直接落下，不带任何力度。</li>
                <li><strong>拖得越远越用力</strong>，大力能把果冻挤进窄缝。</li>
                <li>果冻在顶栏上滑动时发射，<strong>会带着原来的滑动</strong>。</li>
                <li>只有<strong>合成过（粗体）</strong>的数字才计入总分。</li>
                <li>两侧墙上的半圆挡块<strong>同时被顶满</strong>就结束。</li>
              </ul>
            </div>
          </aside>
        </div>

        <div class="sobo-mobile-strip" id="sobo-mobile-strip">
          <span>最大果冻 <strong id="mob-max-blob">4</strong></span>
          <span style="opacity:0.35">·</span>
          <span>合成 <strong id="mob-merges">0</strong> 次</span>
          <span style="opacity:0.35">·</span>
          <span id="mob-mode-text">经典模式</span>
        </div>
      </div>
    `;

    const rootEl = container.querySelector('#sobo-root');
    const canvas = container.querySelector('#sobo-canvas');
    const scoreEl = container.querySelector('#sobo-score');
    const bestEl = container.querySelector('#sobo-best');
    const primaryLabelEl = container.querySelector('#sobo-primary-label');
    const bestLabelEl = container.querySelector('#sobo-best-label');
    const achLabelEl = container.querySelector('#sobo-ach-label');
    const sideMaxBlobEl = container.querySelector('#side-max-blob');
    const sideMergesEl = container.querySelector('#side-merges');
    const sideModeTextEl = container.querySelector('#side-mode-text');
    const sideStyleDotsEl = container.querySelector('#side-style-dots');
    const mobMaxBlobEl = container.querySelector('#mob-max-blob');
    const mobMergesEl = container.querySelector('#mob-merges');
    const mobModeTextEl = container.querySelector('#mob-mode-text');

    const renderer = new SobosubaRenderer(canvas);

    // Physics world + audio/achievement callbacks
    const world = new SobosubaWorld({
      onSpawn: () => {
        soboAudio.playSpawn();
      },
      onLaunch: (_blob, power, isGentle) => {
        soboAudio.playLaunch(isGentle ? 0.08 : power);
      },
      onBounce: (intensity) => {
        soboAudio.playBounce(intensity);
      },
      onMerge: (evt) => {
        soboAudio.playMerge(evt.newValue, evt.chain);
        if (evt.newValue > bestMaxBlob) {
          bestMaxBlob = evt.newValue;
          storage.set('best_max_blob', bestMaxBlob);
        }
        achTracker.onMerge(evt);
        updateHud();
        if (evt.newValue === 8192 && world.mode === 'sprint') {
          toast('已合成 8192！现在压满顶部双条即可定格竞速成绩！', '🏁', 4200);
        }
      },
      onStateTick: (blobs, score) => {
        if (score > bestScore && world.mode === 'classic') {
          bestScore = score;
          storage.set('best_score', bestScore);
        }
        achTracker.onStateCheck(blobs, score);
      },
      onGameOver: (summary) => {
        storage.remove('saved_run');
        if (summary.sprintWin) {
          soboAudio.playAchievement();
          if (bestSprintTime === null || summary.elapsedTime < bestSprintTime) {
            bestSprintTime = summary.elapsedTime;
            storage.set('best_sprint_time', bestSprintTime);
          }
        } else {
          soboAudio.playZap();
          setTimeout(() => soboAudio.playGameOver(), 700);
        }
        syncHallStats();
        setTimeout(() => openGameOverModal(summary), 1100);
      },
    });

    // Apply visual style immediately
    function applyStyle(styleId) {
      currentStyle = getStyleById(styleId);
      prefs.styleId = currentStyle.id;
      storage.set('style_id', currentStyle.id);
      rootEl.style.backgroundColor = currentStyle.pageBg;
      rootEl.style.color = currentStyle.pageText;
      setThemeColor(currentStyle.pageBg);
      renderSideStyleDots();
    }

    function renderSideStyleDots() {
      if (!sideStyleDotsEl) return;
      sideStyleDotsEl.innerHTML = SOBO_STYLES.map((st) => {
        const active = st.id === currentStyle.id ? 'active' : '';
        const bg = `linear-gradient(135deg, ${st.swatches[0]} 0%, ${st.swatches[1]} 55%, ${st.swatches[2]} 100%)`;
        return `<button class="style-dot-btn ${active}" data-style="${st.id}" title="${st.name}" style="background:${bg};"></button>`;
      }).join('');
      sideStyleDotsEl.querySelectorAll('[data-style]').forEach((btn) => {
        btn.addEventListener('click', () => {
          sharedAudio.playClick();
          applyStyle(btn.getAttribute('data-style'));
        });
      });
    }

    function updateHud() {
      if (world.mode === 'sprint') {
        primaryLabelEl.textContent = world.sprintReached8K ? '已达8K!' : '计时';
        scoreEl.textContent = formatTime(world.elapsedTime);
        bestLabelEl.textContent = '最快';
        bestEl.textContent = bestSprintTime !== null ? formatTime(bestSprintTime) : '—';
        if (sideModeTextEl) sideModeTextEl.textContent = '8K 极速竞速';
        if (mobModeTextEl) mobModeTextEl.textContent = '8K 竞速';
      } else {
        primaryLabelEl.textContent = '分数';
        scoreEl.textContent = String(world.score);
        bestLabelEl.textContent = '最高';
        bestEl.textContent = String(bestScore);
        if (sideModeTextEl) sideModeTextEl.textContent = '经典高分';
        if (mobModeTextEl) mobModeTextEl.textContent = '经典模式';
      }
      if (achLabelEl) achLabelEl.textContent = `${achTracker.getCount()}/${achTracker.getTotal()}`;
      if (sideMaxBlobEl) sideMaxBlobEl.textContent = String(world.maxBlob);
      if (sideMergesEl) sideMergesEl.textContent = String(world.mergeCount);
      if (mobMaxBlobEl) mobMaxBlobEl.textContent = String(world.maxBlob);
      if (mobMergesEl) mobMergesEl.textContent = String(world.mergeCount);
    }

    function saveProgress() {
      const data = world.serialize();
      if (data && (world.launchCount > 0 || world.score > 0)) {
        storage.set('saved_run', data);
      }
      syncHallStats();
    }

    // Restore saved run unless user explicitly clicked "开一局新的"
    const savedRun = !options?.fresh ? storage.get('saved_run', null) : null;
    if (savedRun && world.deserialize(savedRun)) {
      prefs.mode = world.mode;
    } else {
      world.reset(prefs.mode);
      if (options?.fresh) storage.remove('saved_run');
    }

    applyStyle(prefs.styleId);
    updateHud();
    syncHallStats();

    // ---------- Touch & Mouse Pointer Controls ----------

    // The arrow runs from where the finger grabbed the blob toward the finger, and keeps
    // following the finger while the blob drifts along the bar.
    const DRAG_START = 20;
    const CANCEL_RADIUS = 14;

    function refreshAim(aim) {
      const v = getAimVector(aim, aim.blob.cx, aim.blob.cy);
      if (v.dist > DRAG_START) aim.pulledOut = true;
      // Pulling back onto the grab point cancels, but only while the blob itself is calm, so
      // a blob sliding under the finger cannot cancel the shot by accident.
      const calm = Math.hypot(aim.blob.velX, aim.blob.velY) < 90;
      aim.cancelled = aim.pulledOut && v.dist < CANCEL_RADIUS && calm;
      return v;
    }

    function onPointerDown(e) {
      if (world.gameOver || modalBackdrop) return;
      if (activePointerId !== null) return;

      const pt = renderer.clientToWorld(e.clientX, e.clientY);
      const blob = world.findBarBlobAt(pt.x, pt.y);
      if (!blob) return;
      e.preventDefault();

      activePointerId = e.pointerId;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore if unsupported
      }

      world.aiming = {
        blob,
        offX: pt.x - blob.cx,
        offY: pt.y - blob.cy,
        tipX: pt.x,
        tipY: pt.y,
        pulledOut: false,
        cancelled: false,
      };
      soboAudio.playSelect();
    }

    function onPointerMove(e) {
      if (e.pointerId !== activePointerId || !world.aiming) return;
      e.preventDefault();
      const pt = renderer.clientToWorld(e.clientX, e.clientY);
      world.aiming.tipX = pt.x;
      world.aiming.tipY = pt.y;
      refreshAim(world.aiming);
    }

    function finishPointer(e, forceCancel = false) {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      const aim = world.aiming;
      world.aiming = null;
      if (!aim || world.gameOver || aim.blob.state !== 'bar' || !world.blobs.includes(aim.blob)) return;

      if (!forceCancel) {
        const pt = renderer.clientToWorld(e.clientX, e.clientY);
        aim.tipX = pt.x;
        aim.tipY = pt.y;
      }
      const v = refreshAim(aim);
      if (forceCancel || aim.cancelled) {
        soboAudio.playCancel();
        return;
      }

      if (aim.pulledOut) world.launchBlob(aim.blob, v.dirX, v.dirY, v.power, false);
      else world.launchBlob(aim.blob, 0, 0, 0, true);
      updateHud();
    }

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', (e) => finishPointer(e, false));
    canvas.addEventListener('pointercancel', (e) => finishPointer(e, true));

    // ---------- Modal Helpers ----------

    function closeModal() {
      if (modalBackdrop) {
        modalBackdrop.remove();
        modalBackdrop = null;
      }
    }

    function openSheet(title, bodyHtml, onBind) {
      closeModal();
      const backdrop = document.createElement('div');
      backdrop.className = 'sobo-modal-backdrop';
      backdrop.innerHTML = `
        <div class="sobo-sheet" role="dialog" aria-modal="true">
          <div class="sheet-header">
            <h2>${title}</h2>
            <button class="sheet-close" id="sheet-close-btn" aria-label="关闭">✕</button>
          </div>
          <div class="sheet-body">${bodyHtml}</div>
        </div>
      `;
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
      backdrop.querySelector('#sheet-close-btn').addEventListener('click', () => {
        sharedAudio.playClick();
        closeModal();
      });
      rootEl.appendChild(backdrop);
      modalBackdrop = backdrop;
      if (onBind) onBind(backdrop);
    }

    function openStylesModal() {
      const cards = SOBO_STYLES.map((st) => {
        const selected = st.id === currentStyle.id ? 'selected' : '';
        const dots = st.swatches
          .map((c) => `<span class="style-swatch" style="background:${c}"></span>`)
          .join('');
        return `
          <button class="style-card ${selected}" data-pick-style="${st.id}">
            <div class="style-swatches">${dots}</div>
            <div class="style-name">${st.name}</div>
            <div class="style-meta">${st.subtitle}</div>
          </button>
        `;
      }).join('');

      openSheet('🎨 果冻配色主题 (10款)', `<div class="style-grid">${cards}</div>`, (el) => {
        el.querySelectorAll('[data-pick-style]').forEach((btn) => {
          btn.addEventListener('click', () => {
            sharedAudio.playClick();
            const id = btn.getAttribute('data-pick-style');
            applyStyle(id);
            el.querySelectorAll('.style-card').forEach((c) => c.classList.remove('selected'));
            btn.classList.add('selected');
            toast(`已切换「${currentStyle.name}」`, '🎨', 1600);
          });
        });
      });
    }

    function openAchievementsModal() {
      const unlocked = achTracker.getUnlockedSet();
      const rows = ACHIEVEMENTS.map((a) => {
        const ok = unlocked.has(a.id);
        return `
          <div class="ach-item ${ok ? 'unlocked' : ''}">
            <div class="ach-icon">${a.icon}</div>
            <div>
              <div class="ach-title">${a.title} ${ok ? '✓' : ''}</div>
              <div class="ach-desc">${a.desc}</div>
            </div>
          </div>
        `;
      }).join('');

      openSheet(
        `🏆 成就挑战 (${unlocked.size}/${ACHIEVEMENTS.length})`,
        `<div class="ach-list">${rows}</div>`
      );
    }

    function openSettingsModal() {
      const html = `
        <div class="setting-row">
          <div>
            <div class="setting-title">游戏模式</div>
            <div class="setting-sub">经典追高分 / 8K 极速合成挑战</div>
          </div>
          <div class="seg-control">
            <button class="seg-btn ${world.mode === 'classic' ? 'active' : ''}" data-mode="classic">经典</button>
            <button class="seg-btn ${world.mode === 'sprint' ? 'active' : ''}" data-mode="sprint">8K竞速</button>
          </div>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-title">画面质感</div>
            <div class="setting-sub">扁平纯色（原作风格）/ 果冻光泽</div>
          </div>
          <div class="seg-control">
            <button class="seg-btn ${prefs.renderMode === 'flat' ? 'active' : ''}" data-render="flat">扁平</button>
            <button class="seg-btn ${prefs.renderMode === 'gloss' ? 'active' : ''}" data-render="gloss">光泽</button>
          </div>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-title">萌系果冻表情</div>
            <div class="setting-sub">显示会眨眼的小眼睛</div>
          </div>
          <div class="seg-control">
            <button class="seg-btn ${prefs.showFaces ? 'active' : ''}" data-faces="1">开启</button>
            <button class="seg-btn ${!prefs.showFaces ? 'active' : ''}" data-faces="0">极简</button>
          </div>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-title">游戏音效</div>
            <div class="setting-sub">果冻 Q 弹碰撞与和弦合成音效</div>
          </div>
          <div class="seg-control">
            <button class="seg-btn ${!sharedAudio.isMuted() ? 'active' : ''}" data-sound="1">开启</button>
            <button class="seg-btn ${sharedAudio.isMuted() ? 'active' : ''}" data-sound="0">静音</button>
          </div>
        </div>

        <div style="margin-top:14px;padding:13px;border-radius:16px;background:var(--bg-muted);font-size:12.5px;line-height:1.65;color:var(--text-secondary);">
          <strong style="color:var(--text-primary);display:block;margin-bottom:4px;">📖 玩法说明</strong>
          1. 顶栏上的果冻任选一个：<strong>轻点</strong>直接落下；<strong>按住往外拖</strong>出箭头，拖得越远越用力，松手发射；拖回起点再松手取消。也可以按顶部小圆点来选。<br/>
          2. 发射会叠加果冻原本的滑动，想打准可以等它停稳。<br/>
          3. 相同数字一碰就合成翻倍，大力能把果冻挤进窄缝。<br/>
          4. 新果冻的数字是浅色，<strong>合成过才变粗体</strong>并计入总分（总分 = 场上所有粗体数字之和）。<br/>
          5. 两侧墙上的半圆挡块被堆起来的果冻<strong>同时顶满</strong>时本局结束。
        </div>
      `;

      openSheet('⚙️ 设置与玩法', html, (el) => {
        el.querySelectorAll('[data-mode]').forEach((btn) => {
          btn.addEventListener('click', () => {
            sharedAudio.playClick();
            const nextMode = btn.getAttribute('data-mode');
            if (nextMode !== world.mode) {
              prefs.mode = nextMode;
              storage.set('mode', nextMode);
              storage.remove('saved_run');
              world.reset(nextMode);
              updateHud();
              toast(nextMode === 'sprint' ? '已切换：8K 极速竞速' : '已切换：经典高分模式', '🎮');
            }
            closeModal();
          });
        });

        el.querySelectorAll('[data-render]').forEach((btn) => {
          btn.addEventListener('click', () => {
            sharedAudio.playClick();
            prefs.renderMode = btn.getAttribute('data-render');
            storage.set('render_mode', prefs.renderMode);
            el.querySelectorAll('[data-render]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
          });
        });

        el.querySelectorAll('[data-faces]').forEach((btn) => {
          btn.addEventListener('click', () => {
            sharedAudio.playClick();
            prefs.showFaces = btn.getAttribute('data-faces') === '1';
            storage.set('show_faces', prefs.showFaces);
            el.querySelectorAll('[data-faces]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
          });
        });

        el.querySelectorAll('[data-sound]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const on = btn.getAttribute('data-sound') === '1';
            sharedAudio.setMuted(!on);
            if (on) sharedAudio.playClick();
            el.querySelectorAll('[data-sound]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
          });
        });
      });
    }

    function openGameOverModal(summary) {
      const title = summary.sprintWin ? '🏁 8K 竞速通关！' : '🫧 本局结束';
      const heroVal = summary.sprintWin ? formatTime(summary.elapsedTime) : String(summary.score);
      const heroSub = summary.sprintWin
        ? `最快纪录：${bestSprintTime !== null ? formatTime(bestSprintTime) : heroVal}`
        : `历史最高分：${bestScore}`;

      const html = `
        <div class="gameover-hero">
          <div style="font-size:13px;color:var(--text-secondary);">${summary.sprintWin ? '最终用时' : '最终粗体总分'}</div>
          <div class="gameover-score">${heroVal}</div>
          <div style="font-size:13px;font-weight:700;color:var(--text-secondary);">${heroSub}</div>
        </div>
        <div class="gameover-grid">
          <div class="gameover-stat"><span>最大果冻</span><strong>${summary.maxBlob}</strong></div>
          <div class="gameover-stat"><span>合成次数</span><strong>${summary.mergeCount}</strong></div>
          <div class="gameover-stat"><span>用时</span><strong>${formatTime(summary.elapsedTime)}</strong></div>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn-secondary" id="go-hall-btn" style="flex:1;justify-content:center;">返回大厅</button>
          <button class="btn-primary" id="go-replay-btn" style="flex:1.5;">再来一局</button>
        </div>
      `;

      openSheet(title, html, (el) => {
        el.querySelector('#go-hall-btn').addEventListener('click', () => {
          sharedAudio.playClick();
          closeModal();
          goHome();
        });
        el.querySelector('#go-replay-btn').addEventListener('click', () => {
          sharedAudio.playClick();
          closeModal();
          world.reset(world.mode);
          updateHud();
        });
      });
    }

    // ---------- Topbar Button Events ----------

    container.querySelector('#sobo-back').addEventListener('click', () => {
      sharedAudio.playClick();
      saveProgress();
      goHome();
    });

    container.querySelector('#sobo-restart').addEventListener('click', () => {
      sharedAudio.playClick();
      if (world.score >= 64 && !world.gameOver) {
        openSheet(
          '重新开始这一局？',
          `
            <p style="margin:0 0 18px;font-size:14px;color:var(--text-secondary);">当前已有 <strong>${world.score}</strong> 分（最大果冻 ${world.maxBlob}），确定要清空重来吗？</p>
            <div style="display:flex;gap:10px;">
              <button class="btn-secondary" id="cancel-restart" style="flex:1;justify-content:center;">继续玩</button>
              <button class="btn-primary" id="confirm-restart" style="flex:1;">确定重开</button>
            </div>
          `,
          (el) => {
            el.querySelector('#cancel-restart').addEventListener('click', () => {
              sharedAudio.playClick();
              closeModal();
            });
            el.querySelector('#confirm-restart').addEventListener('click', () => {
              sharedAudio.playClick();
              closeModal();
              storage.remove('saved_run');
              world.reset(world.mode);
              updateHud();
            });
          }
        );
      } else {
        storage.remove('saved_run');
        world.reset(world.mode);
        updateHud();
      }
    });

    container.querySelector('#sobo-styles').addEventListener('click', () => {
      sharedAudio.playClick();
      openStylesModal();
    });

    container.querySelector('#sobo-ach').addEventListener('click', () => {
      sharedAudio.playClick();
      openAchievementsModal();
    });

    container.querySelector('#sobo-settings').addEventListener('click', () => {
      sharedAudio.playClick();
      openSettingsModal();
    });

    // ---------- Main Loop & Resize Handling ----------

    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    const onVisibility = () => {
      if (document.hidden) {
        saveProgress();
      } else {
        lastTs = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    let lastScoreShown = -1;
    let lastSecShown = -1;

    function loop(ts) {
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      world.update(dt);
      if (world.aiming) refreshAim(world.aiming);
      renderer.render(world, currentStyle, { showFaces: prefs.showFaces, renderMode: prefs.renderMode });

      // Update HUD text only when numbers actually change (zero DOM churn!)
      const sec = Math.floor(world.elapsedTime);
      if (world.score !== lastScoreShown || (world.mode === 'sprint' && sec !== lastSecShown)) {
        lastScoreShown = world.score;
        lastSecShown = sec;
        updateHud();
      }

      saveTimer += dt;
      if (saveTimer >= 4) {
        saveTimer = 0;
        saveProgress();
      }

      rafId = requestAnimationFrame(loop);
    }

    // Ensure initial sizing after layout paint
    requestAnimationFrame(() => {
      renderer.resize();
      rafId = requestAnimationFrame(loop);
    });

    return {
      unmount() {
        saveProgress();
        if (rafId) cancelAnimationFrame(rafId);
        closeModal();
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onResize);
        document.removeEventListener('visibilitychange', onVisibility);
      },
    };
  },
};
