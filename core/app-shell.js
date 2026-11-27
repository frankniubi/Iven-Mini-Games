/**
 * App-only hall extras (loaded by hall.js inside the Android/iOS app):
 * the offline sync sheet, the boot-time switch confirmation, and the Android back button.
 */

import { loadNative } from './platform.js';
import {
  checkForUpdate,
  finishPendingSwitch,
  formatBytes,
  getLocalManifest,
  getSyncOrigin,
  lastSyncTime,
  runSync,
  setSyncOrigin,
} from './sync.js';

let toast = () => {};
let syncing = false;
let lastCheck = null;
let badgeEl = null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function fmtTime(ts) {
  if (!ts) return '从未';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setBadge(on) {
  if (badgeEl) badgeEl.style.display = on ? 'block' : 'none';
}

function addHeaderButton() {
  const actions = document.querySelector('.hall-actions');
  if (!actions || document.getElementById('btn-hall-sync')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-hall-sync';
  btn.className = 'icon-pill';
  btn.title = '离线与同步';
  btn.setAttribute('aria-label', '离线与同步');
  btn.style.position = 'relative';
  btn.innerHTML = '<span>⇅</span><i style="display:none;position:absolute;top:6px;right:6px;width:9px;height:9px;border-radius:50%;background:#FF3B5C;box-shadow:0 0 0 2px var(--bg-surface-solid)"></i>';
  badgeEl = btn.querySelector('i');
  btn.addEventListener('click', openSheet);
  actions.insertBefore(btn, actions.firstChild);
}

function openSheet() {
  if (document.querySelector('.sync-backdrop')) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'sobo-modal-backdrop sync-backdrop';
  backdrop.innerHTML = `
    <div class="sobo-sheet" role="dialog" aria-label="离线与同步">
      <div class="sheet-header"><h2>离线与同步</h2><button class="sheet-close" data-x>✕</button></div>
      <div class="sync-box">
        <div class="sync-k">本机离线包</div>
        <div class="sync-v" id="sync-local">读取中…</div>
      </div>
      <div class="sync-box">
        <div class="sync-k">同步服务器</div>
        <div class="sync-origin"><input id="sync-origin" value="${esc(getSyncOrigin())}" spellcheck="false" autocapitalize="off" /></div>
      </div>
      <div class="sync-status" id="sync-status"></div>
      <div class="sync-bar" id="sync-bar" hidden><i></i></div>
      <div class="sync-btns">
        <button class="btn-secondary" id="sync-check">检查更新</button>
        <button class="btn-primary" id="sync-go" hidden>立即同步</button>
      </div>
      <p class="sync-note">App 里已经带着全部游戏，断网也能玩。网站上有新游戏或更新时，点「检查更新」把差异下载到本机，下载期间请保持 App 在前台。</p>
    </div>`;
  document.body.appendChild(backdrop);
  const $ = (sel) => backdrop.querySelector(sel);
  const close = () => !syncing && backdrop.remove();
  backdrop.addEventListener('click', (e) => e.target === backdrop && close());
  $('[data-x]').onclick = close;

  getLocalManifest()
    .then((m) => {
      $('#sync-local').innerHTML = `版本 <b>${esc(m.version)}</b> · ${m.count} 个文件 · ${formatBytes(m.totalSize)}<br><span class="sync-dim">上次同步：${fmtTime(lastSyncTime())}</span>`;
    })
    .catch((err) => {
      $('#sync-local').textContent = err.message;
    });

  const status = (text, cls = '') => {
    const el = $('#sync-status');
    el.className = `sync-status ${cls}`;
    el.textContent = text;
  };
  const showResult = (r) => {
    if (r.upToDate) {
      status('已经是最新的离线包 ✓', 'ok');
      $('#sync-go').hidden = true;
      setBadge(false);
    } else {
      status(`有 ${r.changed.length} 个文件更新（${formatBytes(r.bytes)}）${r.removed.length ? `，${r.removed.length} 个文件会删除` : ''}`, 'warn');
      $('#sync-go').hidden = false;
      setBadge(true);
    }
  };
  if (lastCheck) showResult(lastCheck);

  $('#sync-check').onclick = async () => {
    if (syncing) return;
    setSyncOrigin($('#sync-origin').value);
    status('正在连接服务器…');
    try {
      lastCheck = await checkForUpdate();
      showResult(lastCheck);
    } catch (err) {
      status(`连不上服务器：${err.message || err}`, 'bad');
    }
  };

  $('#sync-go').onclick = async () => {
    if (syncing) return;
    syncing = true;
    $('#sync-go').disabled = true;
    $('#sync-check').disabled = true;
    const bar = $('#sync-bar');
    bar.hidden = false;
    const fill = bar.querySelector('i');
    try {
      const res = await runSync((p) => {
        if (p.stage === 'copy') {
          status('正在准备本地副本…');
          fill.style.width = '4%';
        } else if (p.stage === 'download') {
          const frac = p.bytesTotal ? p.bytesDone / p.bytesTotal : p.total ? p.done / p.total : 1;
          status(`下载中 ${p.done}/${p.total} · ${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}`);
          fill.style.width = `${Math.max(4, Math.round(frac * 96))}%`;
        } else {
          status('正在切换到新版本…');
          fill.style.width = '100%';
        }
      });
      if (res.upToDate) {
        status('已经是最新的离线包 ✓', 'ok');
        syncing = false;
      }
      // On success the WebView reloads into the new copy.
    } catch (err) {
      status(`同步失败：${err.message || err}`, 'bad');
      syncing = false;
      $('#sync-go').disabled = false;
      $('#sync-check').disabled = false;
    }
  };
}

function injectCss() {
  const style = document.createElement('style');
  style.textContent = `
  .sync-box{background:var(--bg-muted);border-radius:16px;padding:12px 14px;margin-bottom:10px}
  .sync-k{font-size:12px;font-weight:800;color:var(--text-tertiary);margin-bottom:4px}
  .sync-v{font-size:14px;line-height:1.6}
  .sync-dim{color:var(--text-secondary);font-size:12.5px}
  .sync-origin input{width:100%;box-sizing:border-box;border:1px solid var(--border-soft);background:var(--bg-surface-solid);color:var(--text-primary);border-radius:12px;padding:10px 12px;font:inherit;font-size:14px}
  .sync-status{min-height:22px;font-size:14px;font-weight:700;margin:6px 2px 10px}
  .sync-status.ok{color:#1F9D55}.sync-status.warn{color:#C77700}.sync-status.bad{color:#D93848}
  .sync-bar{height:8px;border-radius:99px;background:var(--bg-muted);overflow:hidden;margin-bottom:12px}
  .sync-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#FF759F,#FF5888);transition:width .25s}
  .sync-btns{display:flex;gap:10px;justify-content:flex-end}
  .sync-note{font-size:12.5px;color:var(--text-secondary);line-height:1.6;margin:14px 2px 0}`;
  document.head.appendChild(style);
}

async function wireBackButton(back) {
  try {
    const { App } = await loadNative();
    App.addListener('backButton', () => {
      if (document.querySelector('.sync-backdrop')) {
        if (!syncing) document.querySelector('.sync-backdrop').remove();
        return;
      }
      if (!back()) App.minimizeApp();
    });
  } catch (err) {
    console.warn('back button', err);
  }
}

export async function initAppShell({ showToast, back }) {
  toast = showToast;
  injectCss();
  addHeaderButton();
  wireBackButton(back);
  const footer = document.querySelector('.hall-footer p');
  if (footer) footer.textContent = 'App 版 · 全部游戏已存到本机，断网也能玩 · 右上角 ⇅ 同步网站上的更新';
  try {
    const msg = await finishPendingSwitch();
    if (msg) toast(msg, '✅', 3200);
  } catch (err) {
    console.warn('finishPendingSwitch', err);
  }
  // Quiet update check; only a badge, never an automatic download.
  setTimeout(async () => {
    try {
      lastCheck = await checkForUpdate();
      setBadge(!lastCheck.upToDate);
    } catch {
      // offline is normal
    }
  }, 2500);
}

/** Re-adds the header button after the hall re-renders (header is static, so this is a no-op guard). */
export function ensureHeaderButton() {
  addHeaderButton();
}
