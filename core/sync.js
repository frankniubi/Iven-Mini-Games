/**
 * Offline content sync for the Android/iOS app.
 *
 * The app starts out serving the copy of the site bundled inside it. A sync fetches
 * sync-manifest.json from the website, builds a complete new copy in app storage (local copy of
 * whatever is being served now + download of the files whose hash changed), then points the
 * WebView at it. The new location is only persisted after the new page has booted
 * (finishPendingSwitch), so a broken update falls back to the previous copy on the next launch.
 *
 * Content folders live where Capacitor restores persisted base paths from:
 *   iOS     Library/NoCloud/ionic_built_snapshots/<dir>   (only the folder name is persisted)
 *   Android files/offline/<dir>                           (absolute path is persisted)
 */

import { isNativeApp, nativePlatform, loadNative, hasNativePlugin } from './platform.js';
import { hallStorage } from './storage.js';

export const DEFAULT_SYNC_ORIGIN = 'http://minigames.mcbar.cc/';
const STATE_KEY = 'offline_sync';
const CONCURRENCY = 4;

const rootDir = () => (nativePlatform === 'ios' ? 'NoCloud/ionic_built_snapshots' : 'offline');
const rootMarker = () => (nativePlatform === 'ios' ? '/ionic_built_snapshots/' : '/files/offline/');

export const syncSupported = isNativeApp;

function loadState() {
  return hallStorage.get(STATE_KEY, {}) || {};
}

function saveState(patch) {
  const next = { ...loadState(), ...patch };
  hallStorage.set(STATE_KEY, next);
  return next;
}

export function getSyncOrigin() {
  const o = loadState().origin || DEFAULT_SYNC_ORIGIN;
  return o.endsWith('/') ? o : `${o}/`;
}

export function setSyncOrigin(origin) {
  let o = String(origin || '').trim();
  if (!o) o = DEFAULT_SYNC_ORIGIN;
  if (!/^https?:\/\//i.test(o)) o = `http://${o}`;
  if (!o.endsWith('/')) o += '/';
  saveState({ origin: o });
  return o;
}

export function lastSyncTime() {
  return loadState().lastSync || 0;
}

const uriToPath = (uri) => decodeURIComponent(String(uri).replace(/^file:\/\//, ''));
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function plugins() {
  const v = await loadNative();
  if (!v) throw new Error('只有 App 支持离线同步');
  return v;
}

/** Manifest of the copy currently being served (bundled or synced). */
export async function getLocalManifest() {
  const res = await fetch(`./sync-manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('本地离线包缺少清单');
  return res.json();
}

/** Where the WebView currently serves from: {synced, dir, path}. */
async function currentSource() {
  const { WebView } = await plugins();
  let path = '';
  try {
    path = (await WebView.getServerBasePath()).path || '';
  } catch {
    path = '';
  }
  const marker = rootMarker();
  const at = path.indexOf(marker);
  if (at < 0) return { synced: false, dir: null, path };
  const dir = path.slice(at + marker.length).split('/')[0];
  return { synced: Boolean(dir), dir, path };
}

export async function fetchRemoteManifest() {
  const { CapacitorHttp } = await plugins();
  const url = `${getSyncOrigin()}sync-manifest.json?t=${Date.now()}`;
  const res = await CapacitorHttp.get({ url, responseType: 'json', connectTimeout: 10000, readTimeout: 20000 });
  if (res.status !== 200) throw new Error(`服务器返回 ${res.status}`);
  const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  if (!data || !Array.isArray(data.files) || !data.version) throw new Error('服务器清单格式不对');
  return data;
}

export function diffManifests(local, remote) {
  const have = new Map((local?.files || []).map(([p, s, h]) => [p, `${s}:${h}`]));
  const changed = [];
  let bytes = 0;
  for (const [p, s, h] of remote.files) {
    if (have.get(p) !== `${s}:${h}`) {
      changed.push([p, s, h]);
      bytes += s;
    }
  }
  const keep = new Set(remote.files.map(([p]) => p));
  const removed = (local?.files || []).map(([p]) => p).filter((p) => !keep.has(p));
  return { changed, removed, bytes, upToDate: local?.version === remote.version && !changed.length };
}

/** Compares the served copy with the server. */
export async function checkForUpdate() {
  const [local, remote] = await Promise.all([getLocalManifest(), fetchRemoteManifest()]);
  const diff = diffManifests(local, remote);
  saveState({ lastCheck: Date.now(), remoteVersion: remote.version });
  return { local, remote, ...diff };
}

async function ensureDir(Filesystem, Directory, path) {
  try {
    await Filesystem.mkdir({ path, directory: Directory, recursive: true });
  } catch {
    // already exists
  }
}

async function removeDir(Filesystem, directory, path) {
  try {
    await Filesystem.rmdir({ path, directory, recursive: true });
  } catch {
    // missing is fine
  }
}

async function downloadOne(v, dirBase, entry, origin) {
  const { Filesystem, Directory, FileTransfer } = v;
  const [rel, size, hash] = entry;
  const directory = nativePlatform === 'ios' ? Directory.Library : Directory.Data;
  const target = `${dirBase}/${rel}`;
  const parent = target.slice(0, target.lastIndexOf('/'));
  await ensureDir(Filesystem, directory, parent);
  const url = `${origin}${encodePath(rel)}?h=${hash}`;
  const { uri } = await Filesystem.getUri({ path: target, directory });
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await FileTransfer.downloadFile({ url, path: uri });
      const st = await Filesystem.stat({ path: target, directory });
      if (Number(st.size) === size) return;
      lastErr = new Error(`${rel} 大小不对`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  throw new Error(`下载失败：${rel}（${lastErr?.message || lastErr}）`);
}

/**
 * Builds the new copy and switches to it (the page reloads into the new content on success).
 * onProgress({stage:'copy'|'download'|'finish', done, total, bytesDone, bytesTotal})
 */
export async function runSync(onProgress = () => {}) {
  const v = await plugins();
  const { Filesystem, Directory, Encoding, WebView, AppBridge } = v;
  const directory = nativePlatform === 'ios' ? Directory.Library : Directory.Data;
  const origin = getSyncOrigin();

  const remote = await fetchRemoteManifest();
  const local = await getLocalManifest();
  const src = await currentSource();
  if (local.version === remote.version) return { upToDate: true, remote };

  const newDir = `v-${remote.version}`;
  const base = `${rootDir()}/${newDir}`;
  await ensureDir(Filesystem, directory, rootDir());
  await removeDir(Filesystem, directory, base);

  // 1. Start from a full local copy of what is served now, so only changed files are downloaded.
  onProgress({ stage: 'copy', done: 0, total: 1 });
  let seeded = false;
  try {
    if (src.synced) {
      await Filesystem.copy({ from: `${rootDir()}/${src.dir}`, to: base, directory, toDirectory: directory });
      seeded = true;
    } else if (nativePlatform === 'ios' && src.path.startsWith('/')) {
      // The iOS bundle is a real folder inside the .app, so it can be copied directly.
      await Filesystem.copy({ from: `file://${src.path}`, to: base, toDirectory: directory });
      seeded = true;
    } else if (hasNativePlugin('AppBridge')) {
      // Android keeps the bundle inside the APK; a small native helper copies it out.
      const { uri } = await Filesystem.getUri({ path: base, directory });
      await AppBridge.copyBundledWeb({ to: uriToPath(uri) });
      seeded = true;
    }
  } catch (err) {
    console.warn('seed copy failed, downloading everything', err);
    await removeDir(Filesystem, directory, base);
  }
  const diff = diffManifests(seeded ? local : null, remote);

  // 2. Download what changed.
  const queue = diff.changed.slice();
  const total = queue.length;
  let done = 0;
  let bytesDone = 0;
  onProgress({ stage: 'download', done, total, bytesDone, bytesTotal: diff.bytes });
  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift();
      await downloadOne(v, base, entry, origin);
      done += 1;
      bytesDone += entry[1];
      onProgress({ stage: 'download', done, total, bytesDone, bytesTotal: diff.bytes });
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, total)) }, worker));
  } catch (err) {
    queue.length = 0;
    await removeDir(Filesystem, directory, base);
    throw err;
  }

  // 3. Drop removed files, write the new manifest, then switch.
  onProgress({ stage: 'finish', done: total, total });
  if (seeded) {
    for (const rel of diff.removed) {
      try {
        await Filesystem.deleteFile({ path: `${base}/${rel}`, directory });
      } catch {
        // already gone
      }
    }
  }
  await Filesystem.writeFile({ path: `${base}/sync-manifest.json`, data: JSON.stringify(remote), directory, encoding: Encoding.UTF8 });
  const check = await Filesystem.stat({ path: `${base}/index.html`, directory });
  if (!check || Number(check.size) <= 0) throw new Error('新离线包不完整');

  const { uri } = await Filesystem.getUri({ path: base, directory });
  saveState({ pending: { dir: newDir, version: remote.version, from: src.dir || 'bundle', at: Date.now() } });
  await WebView.setServerBasePath({ path: uriToPath(uri) });
  return { switched: true, remote };
}

/**
 * Called once at boot inside the app. Persists a freshly switched copy once it has booted,
 * and removes copies that are no longer used. Returns a short message for a toast, or ''.
 */
export async function finishPendingSwitch() {
  if (!isNativeApp) return '';
  const v = await plugins();
  const { Filesystem, Directory, WebView } = v;
  const directory = nativePlatform === 'ios' ? Directory.Library : Directory.Data;
  const state = loadState();
  const src = await currentSource();
  let message = '';

  if (state.pending) {
    if (src.synced && src.dir === state.pending.dir) {
      await WebView.persistServerBasePath();
      saveState({ pending: null, lastSync: Date.now(), current: state.pending.dir });
      message = '离线包已更新，全部游戏可离线游玩';
    } else if (Date.now() - state.pending.at > 60000) {
      saveState({ pending: null });
    } else {
      return '';
    }
  }

  // Delete every other content folder (old versions, half-finished syncs).
  try {
    const { files } = await Filesystem.readdir({ path: rootDir(), directory });
    for (const f of files) {
      const name = typeof f === 'string' ? f : f.name;
      if (name && name !== src.dir) await removeDir(Filesystem, directory, `${rootDir()}/${name}`);
    }
  } catch {
    // root folder doesn't exist yet
  }
  return message;
}

export function formatBytes(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
