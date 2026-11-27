/**
 * Lobby shared by the networked card games: play solo against bots, open a room on
 * Wi-Fi + Bluetooth, or find and join a friend's room. Hands a connected RoomClient (and the
 * RoomHost when this device hosts) to the game's table UI via onEnterTable.
 */

import { isNativeApp } from '../platform.js';
import { RoomHost, RoomClient, loadPlayer } from './room.js';
import { availableVias, createDiscovery, createHostTransport, nativeStatus } from './transports.js';

const AVATARS = ['🐱', '🐶', '🐼', '🦊', '🐰', '🐻', '🐨', '🐯', '🦁', '🐸', '🐵', '🐧', '🐷', '🐮', '🦄', '🐙', '🐳', '🦋', '🌸', '⭐'];
const VIA_LABEL = { lan: 'Wi‑Fi', ble: '蓝牙', bc: '本机多窗口' };
const VIA_ICON = { lan: '📶', ble: 'ᛒ', bc: '🪟' };

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.id = 'lobby-css';
  style.textContent = LOBBY_CSS;
  document.head.appendChild(style);
}

/**
 * @param {HTMLElement} container
 * @param {object} o
 *   def, title, subtitle, emoji, theme:{bg, accent, accentText}, settingsSchema, defaultSettings,
 *   storage (game namespace), playerStore (hall namespace), toast, audio, goHome,
 *   onEnterTable({client, host, solo, resumed})
 */
export function createLobby(container, o) {
  injectCss();
  const root = document.createElement('div');
  root.className = 'lobby-root';
  root.style.setProperty('--lb-bg', o.theme.bg);
  root.style.setProperty('--lb-accent', o.theme.accent);
  root.style.setProperty('--lb-accent-text', o.theme.accentText || '#fff');
  container.appendChild(root);

  const me = loadPlayer(o.playerStore);
  let settings = { ...o.defaultSettings, ...o.storage.get('settings', {}) };
  let cleanup = [];
  let destroyed = false;

  const click = () => o.audio?.playClick?.();
  const runCleanup = () => {
    cleanup.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
    cleanup = [];
  };

  function render(html) {
    runCleanup();
    root.innerHTML = `<div class="lb-screen">${html}</div>`;
    root.scrollTop = 0;
  }

  function saveSettings() {
    o.storage.set('settings', settings);
  }

  function roomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function settingsHtml() {
    if (!o.settingsSchema?.length) return '';
    return `<div class="lb-card lb-settings">
      <div class="lb-card-title">规则设置 <span class="lb-dim">（单机和你当房主时生效）</span></div>
      ${o.settingsSchema
        .map(
          (f) => `<div class="lb-row"><span class="lb-row-label">${esc(f.label)}</span>
            <div class="lb-seg" data-key="${esc(f.key)}">${f.options
              .map((opt) => `<button class="${settings[f.key] === opt.value ? 'on' : ''}" data-val="${esc(JSON.stringify(opt.value))}">${esc(opt.label)}</button>`)
              .join('')}</div></div>`,
        )
        .join('')}
    </div>`;
  }

  function wireSettings() {
    root.querySelectorAll('.lb-seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        click();
        settings[seg.dataset.key] = JSON.parse(btn.dataset.val);
        saveSettings();
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      });
    });
  }

  function seatsHtml(seats, { canKick = false, total }) {
    const list = [];
    for (let i = 0; i < total; i++) {
      const s = seats[i] || { kind: 'empty' };
      if (s.kind === 'empty') {
        list.push(`<div class="lb-seat empty"><div class="lb-ava">＋</div><div class="lb-seat-name">等待加入…<span class="lb-dim">开始时电脑补位</span></div></div>`);
      } else {
        const tags = [];
        if (s.host) tags.push('<span class="lb-tag">房主</span>');
        if (s.kind === 'bot') tags.push('<span class="lb-tag bot">电脑</span>');
        if (s.kind === 'human' && !s.connected) tags.push('<span class="lb-tag warn">掉线</span>');
        list.push(`<div class="lb-seat"><div class="lb-ava">${esc(s.avatar)}</div>
          <div class="lb-seat-name">${esc(s.name)} ${tags.join('')}</div>
          ${canKick && i > 0 && s.kind === 'human' ? `<button class="lb-kick" data-kick="${i}" aria-label="移出">✕</button>` : ''}</div>`);
      }
    }
    return list.join('');
  }

  // ---------- home ----------

  function showHome() {
    if (destroyed) return;
    const vias = availableVias();
    const solo = o.storage.get('solo_room', null);
    const canResume = Boolean(solo && solo.match && solo.match.handNo > 0);
    render(`
      <div class="lb-top">
        <button class="lb-back" data-act="home">← 大厅</button>
        <button class="lb-me" data-act="profile"><span class="lb-ava sm">${esc(me.avatar)}</span><span>${esc(me.name)}</span><span class="lb-dim">✎</span></button>
      </div>
      <div class="lb-hero">
        <div class="lb-emoji">${o.emoji}</div>
        <h1>${esc(o.title)}</h1>
        <p>${esc(o.subtitle)}</p>
      </div>
      <div class="lb-actions">
        ${canResume ? `<button class="lb-btn primary" data-act="resume"><b>继续上局</b><span>第 ${solo.match.handNo} 局 · 和电脑</span></button>` : ''}
        <button class="lb-btn ${canResume ? '' : 'primary'}" data-act="solo"><b>🤖 单机练习</b><span>和电脑打，随时开局</span></button>
        <button class="lb-btn" data-act="create" ${vias.length ? '' : 'disabled'}><b>🏠 创建房间</b><span>${vias.length ? '朋友用 Wi‑Fi 或蓝牙加入' : '需要在 App 里使用'}</span></button>
        <button class="lb-btn" data-act="join" ${vias.length ? '' : 'disabled'}><b>🔍 加入房间</b><span>${vias.length ? '找附近朋友开的房间' : '需要在 App 里使用'}</span></button>
      </div>
      ${settingsHtml()}
      ${vias.length ? '' : '<p class="lb-note">网页版只能和电脑玩。安装「小游戏大厅」App 后，可以在同一 Wi‑Fi 或通过蓝牙和朋友一起打。</p>'}
    `);
    wireSettings();
    root.querySelector('[data-act="home"]').onclick = () => {
      click();
      o.goHome();
    };
    root.querySelector('[data-act="profile"]').onclick = () => {
      click();
      showProfile();
    };
    root.querySelector('[data-act="solo"]').onclick = () => {
      click();
      startSolo(null);
    };
    const resume = root.querySelector('[data-act="resume"]');
    if (resume) {
      resume.onclick = () => {
        click();
        startSolo(solo);
      };
    }
    const create = root.querySelector('[data-act="create"]');
    if (create && vias.length) {
      create.onclick = () => {
        click();
        showCreate();
      };
    }
    const join = root.querySelector('[data-act="join"]');
    if (join && vias.length) {
      join.onclick = () => {
        click();
        showJoin();
      };
    }
  }

  // ---------- profile ----------

  function showProfile() {
    render(`
      <div class="lb-top"><button class="lb-back" data-act="back">← 返回</button></div>
      <div class="lb-card">
        <div class="lb-card-title">我的昵称</div>
        <input class="lb-input" id="lb-name" maxlength="12" value="${esc(me.name)}" placeholder="输入昵称" />
        <div class="lb-card-title" style="margin-top:16px">头像</div>
        <div class="lb-avatars">${AVATARS.map((a) => `<button class="${a === me.avatar ? 'on' : ''}" data-ava="${a}">${a}</button>`).join('')}</div>
        <button class="lb-btn primary slim" data-act="save" style="margin-top:18px"><b>保存</b></button>
      </div>
    `);
    let avatar = me.avatar;
    root.querySelectorAll('[data-ava]').forEach((b) => {
      b.onclick = () => {
        click();
        avatar = b.dataset.ava;
        root.querySelectorAll('[data-ava]').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
    const save = () => {
      const name = root.querySelector('#lb-name').value.trim().slice(0, 12);
      if (name) me.name = name;
      me.avatar = avatar;
      o.playerStore.set('player', me);
      showHome();
    };
    root.querySelector('[data-act="save"]').onclick = () => {
      click();
      save();
    };
    root.querySelector('[data-act="back"]').onclick = () => {
      click();
      showHome();
    };
  }

  // ---------- solo ----------

  async function startSolo(snapshot) {
    const host = new RoomHost({
      def: o.def,
      settings: snapshot ? snapshot.settings : { ...settings },
      me,
      code: 'solo',
      persist: (snap) => o.storage.set('solo_room', snap),
    });
    const client = new RoomClient({ def: o.def, me, transport: host.createLocalClient() });
    try {
      await client.connect();
    } catch (err) {
      o.toast?.(err.message || '开局失败', '⚠️');
      host.close();
      return;
    }
    if (snapshot) host.restore(snapshot);
    else host.start();
    enterTable({ client, host, solo: true, resumed: Boolean(snapshot) });
  }

  // ---------- create room ----------

  async function showCreate() {
    const code = roomCode();
    const tag = `${o.def.code}-${code}`;
    const host = new RoomHost({ def: o.def, settings: { ...settings }, me, code, onChange: () => refresh() });
    const client = new RoomClient({ def: o.def, me, transport: host.createLocalClient() });
    const linkState = {};
    let entered = false;
    try {
      await client.connect();
    } catch (err) {
      o.toast?.(err.message || '创建失败', '⚠️');
      host.close();
      return;
    }

    render(`
      <div class="lb-top"><button class="lb-back" data-act="close">← 解散房间</button></div>
      <div class="lb-card lb-room">
        <div class="lb-dim">房间号</div>
        <div class="lb-code">${code}</div>
        <div class="lb-links" id="lb-links"></div>
      </div>
      <div class="lb-card">
        <div class="lb-card-title">座位 <span class="lb-dim" id="lb-count"></span></div>
        <div class="lb-seats" id="lb-seats"></div>
      </div>
      <button class="lb-btn primary" data-act="start"><b>开始游戏</b><span>空位由电脑补上</span></button>
      <p class="lb-note">朋友打开 App →「${esc(o.title)}」→「加入房间」，连同一个 Wi‑Fi（或开着蓝牙靠近你）就能看到房间 ${code}。</p>
    `);

    function refresh() {
      if (destroyed || entered) return;
      const linksEl = root.querySelector('#lb-links');
      const seatsEl = root.querySelector('#lb-seats');
      if (!linksEl || !seatsEl) return;
      linksEl.innerHTML = Object.entries(linkState)
        .map(([via, st]) => `<div class="lb-link ${st.ok ? 'ok' : st.pending ? '' : 'bad'}"><span>${VIA_ICON[via]} ${VIA_LABEL[via]}</span><span>${esc(st.text)}</span></div>`)
        .join('');
      seatsEl.innerHTML = seatsHtml(host.seatsPublic(), { canKick: true, total: o.def.seats });
      root.querySelector('#lb-count').textContent = `${host.humanCount()}/${o.def.seats} 人`;
      seatsEl.querySelectorAll('[data-kick]').forEach((b) => {
        b.onclick = () => {
          click();
          host.kick(Number(b.dataset.kick));
        };
      });
    }

    root.querySelector('[data-act="start"]').onclick = () => {
      click();
      entered = true;
      host.start();
      enterTable({ client, host, solo: false });
    };
    root.querySelector('[data-act="close"]').onclick = () => {
      click();
      host.close();
      client.leave(true);
      showHome();
    };

    // Open every link in parallel; a slow one (e.g. Bluetooth waiting on a permission prompt)
    // must never block the others or the start button.
    const info = () => JSON.stringify({ g: o.def.id, c: code, h: me.name.slice(0, 8) });
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('开启超时')), ms))]);
    const openLink = async (via) => {
      if (via === 'ble') {
        try {
          const st = await withTimeout(nativeStatus(), 5000);
          if (!st.ble?.available || st.ble.state !== 'on') {
            linkState.ble = { text: st.ble?.state === 'unauthorized' ? '没有蓝牙权限' : st.ble?.state === 'unsupported' ? '设备不支持' : '蓝牙未打开' };
            refresh();
            return;
          }
        } catch {
          // fall through and let startHost report the problem
        }
      }
      try {
        const res = await withTimeout(host.addTransport(createHostTransport(via, tag, info())), 15000);
        linkState[via] = { ok: true, text: via === 'lan' ? (res.ip ? `${res.ip}${res.port && res.port !== 47321 ? `:${res.port}` : ''}` : '已开启') : '已开启' };
      } catch (err) {
        linkState[via] = { text: err?.message ? String(err.message).slice(0, 24) : '开启失败' };
      }
      refresh();
    };
    const vias = availableVias();
    vias.forEach((via) => (linkState[via] = { pending: true, text: '正在开启…' }));
    refresh();
    vias.forEach((via) => openLink(via));
    cleanup.push(() => {
      if (!entered) {
        host.close();
        client.leave(true);
      }
    });
  }

  // ---------- join room ----------

  function showJoin() {
    const vias = availableVias();
    const rooms = new Map();
    const finders = [];
    render(`
      <div class="lb-top"><button class="lb-back" data-act="back">← 返回</button></div>
      <div class="lb-card">
        <div class="lb-card-title">附近的房间 <span class="lb-scan"></span></div>
        <div class="lb-rooms" id="lb-rooms"><div class="lb-empty">正在寻找… 请确认朋友已经创建房间，并且在同一个 Wi‑Fi 或打开了蓝牙</div></div>
      </div>
      ${
        vias.includes('lan')
          ? `<div class="lb-card"><div class="lb-card-title">找不到？输入房主的 IP</div>
        <div class="lb-ipline"><input class="lb-input" id="lb-ip" inputmode="decimal" placeholder="例如 192.168.1.23" /><button class="lb-btn slim primary" data-act="ip"><b>加入</b></button></div>
        <p class="lb-dim" style="margin:8px 2px 0">IP 显示在房主的房间页面上。</p></div>`
          : ''
      }
    `);

    const listEl = root.querySelector('#lb-rooms');
    function refreshRooms() {
      const items = [...rooms.values()]
        .filter((r) => Date.now() - r.seen < 8000)
        .sort((a, b) => (a.via === b.via ? 0 : a.via === 'lan' ? -1 : 1));
      if (!items.length) {
        listEl.innerHTML = '<div class="lb-empty">正在寻找… 请确认朋友已经创建房间，并且在同一个 Wi‑Fi 或打开了蓝牙</div>';
        return;
      }
      listEl.innerHTML = items
        .map(
          (r) => `<button class="lb-roomitem" data-key="${esc(r.key)}">
            <span class="lb-via">${VIA_ICON[r.via]} ${VIA_LABEL[r.via]}</span>
            <span class="lb-roomname"><b>房间 ${esc(r.code)}</b>${r.host ? ` · ${esc(r.host)}` : ''}</span>
            <span class="lb-go">加入 →</span></button>`,
        )
        .join('');
      listEl.querySelectorAll('[data-key]').forEach((b) => {
        b.onclick = () => {
          click();
          const r = rooms.get(b.dataset.key);
          if (r) joinTarget({ via: r.via, id: r.id, ip: r.ip, port: r.port, service: r.service }, `房间 ${r.code}`);
        };
      });
    }

    const onFound = (room) => {
      if (room.lost) {
        rooms.delete(room.key);
        refreshRooms();
        return;
      }
      const m = /^([A-Z]{3})-(\d{4})$/.exec(room.name || '');
      if (!m || m[1] !== o.def.code) return;
      let host = '';
      try {
        host = JSON.parse(room.info || '{}').h || '';
      } catch {
        // info is optional
      }
      rooms.set(room.key, { ...room, code: m[2], host, seen: Date.now() });
      refreshRooms();
    };

    for (const via of vias) {
      const f = createDiscovery(via);
      finders.push(f);
      Promise.resolve(f.start(onFound)).catch((err) => {
        if (via === 'ble') o.toast?.(`蓝牙搜索不可用：${err?.message || '请打开蓝牙并允许权限'}`, 'ᛒ', 3200);
        else o.toast?.(`Wi‑Fi 搜索失败：${err?.message || ''}`, '📶', 3200);
      });
    }
    const ticker = setInterval(refreshRooms, 2500);
    cleanup.push(() => {
      clearInterval(ticker);
      finders.forEach((f) => f.stop());
    });

    root.querySelector('[data-act="back"]').onclick = () => {
      click();
      showHome();
    };
    const ipBtn = root.querySelector('[data-act="ip"]');
    if (ipBtn) {
      ipBtn.onclick = () => {
        click();
        const raw = root.querySelector('#lb-ip').value.trim();
        const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?$/.exec(raw);
        if (!m) {
          o.toast?.('IP 格式不对，例如 192.168.1.23', '⚠️');
          return;
        }
        joinTarget({ via: 'lan', ip: m[1], port: m[2] ? Number(m[2]) : 47321 }, m[1]);
      };
    }
  }

  async function joinTarget(target, label) {
    render(`<div class="lb-center"><div class="lb-spinner"></div><p>正在加入 ${esc(label)}…</p><button class="lb-btn slim" data-act="cancel"><b>取消</b></button></div>`);
    const client = new RoomClient({ def: o.def, me, target });
    let cancelled = false;
    root.querySelector('[data-act="cancel"]').onclick = () => {
      click();
      cancelled = true;
      client.leave(true);
      showJoin();
    };
    try {
      await client.connect();
    } catch (err) {
      if (cancelled) return;
      o.toast?.(err.message || '加入失败', '⚠️', 3200);
      client.leave(true);
      showJoin();
      return;
    }
    if (cancelled) return;
    showGuestLobby(client);
  }

  function showGuestLobby(client) {
    let entered = false;
    render(`
      <div class="lb-top"><button class="lb-back" data-act="leave">← 离开房间</button></div>
      <div class="lb-card lb-room">
        <div class="lb-dim">已加入 ${esc(client.hostName || '')} 的房间</div>
        <div class="lb-code">${esc(client.code)}</div>
        <div class="lb-dim" id="lb-rules"></div>
      </div>
      <div class="lb-card"><div class="lb-card-title">座位</div><div class="lb-seats" id="lb-seats"></div></div>
      <div class="lb-center small"><div class="lb-spinner"></div><p>等待房主开始游戏…</p></div>
    `);
    const refresh = () => {
      const el = root.querySelector('#lb-seats');
      if (!el) return;
      el.innerHTML = seatsHtml(client.seats, { total: o.def.seats });
      const rules = root.querySelector('#lb-rules');
      if (rules && o.describeSettings) rules.textContent = o.describeSettings(client.settings);
    };
    refresh();
    const enter = () => {
      if (entered) return;
      entered = true;
      enterTable({ client, host: null, solo: false });
    };
    const offs = [
      client.on('seats', refresh),
      client.on('state', enter),
      client.on('end', (reason) => {
        o.toast?.(reason || '房间已关闭', '👋');
        showHome();
      }),
    ];
    if (client.view) enter();
    root.querySelector('[data-act="leave"]').onclick = () => {
      click();
      client.leave();
      showHome();
    };
    cleanup.push(() => {
      offs.forEach((off) => off());
      if (!entered) client.leave();
    });
  }

  // ---------- table hand-off ----------

  function enterTable(session) {
    runCleanup();
    root.innerHTML = '';
    root.classList.add('hidden');
    o.onEnterTable(session);
  }

  showHome();

  return {
    /** Back to the lobby home after the table closes its session. */
    show() {
      root.classList.remove('hidden');
      showHome();
    },
    hide() {
      root.classList.add('hidden');
    },
    destroy() {
      destroyed = true;
      runCleanup();
      root.remove();
    },
    isNative: isNativeApp,
  };
}

const LOBBY_CSS = `
.lobby-root{position:absolute;inset:0;overflow-y:auto;-webkit-overflow-scrolling:touch;background:var(--lb-bg);color:#fff;z-index:30;
  padding:calc(12px + var(--safe-top,0px)) calc(16px + var(--safe-right,0px)) calc(24px + var(--safe-bottom,0px)) calc(16px + var(--safe-left,0px));font-family:var(--font-ui)}
.lobby-root.hidden{display:none}
.lb-screen{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.lb-top{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:40px}
.lb-back,.lb-me{appearance:none;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.22);color:#fff;height:38px;padding:0 14px;border-radius:999px;font:inherit;font-size:14px;font-weight:800;display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.lb-back:active,.lb-me:active,.lb-btn:active,.lb-roomitem:active{transform:scale(.97)}
.lb-hero{text-align:center;padding:6px 0 2px}
.lb-emoji{font-size:54px;line-height:1;filter:drop-shadow(0 6px 14px rgba(0,0,0,.35))}
.lb-hero h1{margin:8px 0 4px;font-size:30px;font-weight:900;letter-spacing:1px;text-shadow:0 3px 10px rgba(0,0,0,.3)}
.lb-hero p{margin:0;color:rgba(255,255,255,.78);font-size:14px}
.lb-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.lb-btn{appearance:none;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;border-radius:18px;padding:14px 14px;text-align:left;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:4px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.lb-btn b{font-size:17px;font-weight:900}
.lb-btn span{font-size:12.5px;color:rgba(255,255,255,.75)}
.lb-btn.primary{background:var(--lb-accent);color:var(--lb-accent-text);border-color:transparent;box-shadow:0 10px 24px rgba(0,0,0,.28)}
.lb-btn.primary span{color:inherit;opacity:.85}
.lb-btn[disabled]{opacity:.45;cursor:default}
.lb-actions .lb-btn.primary:first-child{grid-column:1/-1}
.lb-btn.slim{padding:10px 18px;align-items:center;flex-direction:row;justify-content:center;border-radius:999px}
.lb-card{background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:14px 14px}
.lb-card-title{font-weight:900;font-size:15px;margin-bottom:10px}
.lb-dim{color:rgba(255,255,255,.62);font-weight:600;font-size:12.5px}
.lb-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;flex-wrap:wrap}
.lb-row-label{font-size:14px;font-weight:700}
.lb-seg{display:inline-flex;background:rgba(0,0,0,.28);border-radius:999px;padding:3px;gap:2px;flex-wrap:wrap}
.lb-seg button{appearance:none;border:0;background:transparent;color:rgba(255,255,255,.8);font:inherit;font-size:13px;font-weight:800;padding:7px 12px;border-radius:999px;cursor:pointer}
.lb-seg button.on{background:#fff;color:#1d1d1f}
.lb-note{margin:0;color:rgba(255,255,255,.7);font-size:12.5px;line-height:1.6;text-align:center}
.lb-room{text-align:center}
.lb-code{font-size:46px;font-weight:900;letter-spacing:10px;margin:2px 0 8px;font-variant-numeric:tabular-nums}
.lb-links{display:flex;flex-direction:column;gap:6px}
.lb-link{display:flex;justify-content:space-between;background:rgba(255,255,255,.08);border-radius:12px;padding:8px 12px;font-size:13.5px;font-weight:700}
.lb-link.ok span:last-child{color:#7CF29A}
.lb-link.bad span:last-child{color:#FFB4A8}
.lb-seats{display:flex;flex-direction:column;gap:8px}
.lb-seat{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.08);border-radius:14px;padding:8px 10px}
.lb-seat.empty{opacity:.6;border:1px dashed rgba(255,255,255,.3);background:transparent}
.lb-ava{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.16);display:grid;place-items:center;font-size:24px;flex:none}
.lb-ava.sm{width:26px;height:26px;font-size:16px}
.lb-seat-name{flex:1;font-weight:800;font-size:15px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.lb-seat-name .lb-dim{display:block;width:100%;font-size:11.5px}
.lb-tag{font-size:11px;font-weight:800;padding:2px 7px;border-radius:999px;background:var(--lb-accent);color:var(--lb-accent-text)}
.lb-tag.bot{background:rgba(255,255,255,.2);color:#fff}
.lb-tag.warn{background:#E5484D;color:#fff}
.lb-kick{appearance:none;border:0;background:rgba(255,255,255,.14);color:#fff;width:32px;height:32px;border-radius:50%;font-size:14px;cursor:pointer}
.lb-input{width:100%;box-sizing:border-box;appearance:none;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.25);color:#fff;border-radius:14px;padding:12px 14px;font:inherit;font-size:16px;font-weight:700;outline:none}
.lb-input:focus{border-color:var(--lb-accent)}
.lb-ipline{display:flex;gap:8px}
.lb-avatars{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:8px}
.lb-avatars button{appearance:none;border:2px solid transparent;background:rgba(255,255,255,.1);border-radius:14px;font-size:26px;height:50px;cursor:pointer}
.lb-avatars button.on{border-color:var(--lb-accent);background:rgba(255,255,255,.22)}
.lb-rooms{display:flex;flex-direction:column;gap:8px}
.lb-roomitem{appearance:none;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.1);color:#fff;border-radius:14px;padding:12px;font:inherit;display:flex;align-items:center;gap:10px;cursor:pointer;text-align:left}
.lb-via{font-size:12px;font-weight:800;background:rgba(0,0,0,.3);padding:4px 8px;border-radius:999px;flex:none}
.lb-roomname{flex:1;font-size:15px}
.lb-go{font-weight:900;color:var(--lb-accent)}
.lb-empty{color:rgba(255,255,255,.65);font-size:13px;line-height:1.6;padding:6px 2px}
.lb-scan{display:inline-block;width:8px;height:8px;border-radius:50%;background:#7CF29A;margin-left:6px;animation:lbPulse 1.2s infinite}
@keyframes lbPulse{0%{box-shadow:0 0 0 0 rgba(124,242,154,.7)}100%{box-shadow:0 0 0 10px rgba(124,242,154,0)}}
.lb-center{display:flex;flex-direction:column;align-items:center;gap:14px;padding:60px 0;text-align:center;font-weight:700}
.lb-center.small{padding:10px 0}
.lb-spinner{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;animation:lbSpin .8s linear infinite}
@keyframes lbSpin{to{transform:rotate(360deg)}}
@media (min-width:700px){.lb-actions{grid-template-columns:repeat(3,1fr)}.lb-actions .lb-btn.primary:first-child{grid-column:auto}}
`;
