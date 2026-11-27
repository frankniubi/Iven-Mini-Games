/**
 * Builds native/www (the web bundle shipped inside the app) from the site root:
 *   1. build core/vendor/capacitor.js (esbuild)
 *   2. wipe + recreate native/www and copy every file from listSiteFiles(projectRoot)
 *   3. write native/www/sync-manifest.json (generateManifest(www))
 *   4. npx cap sync [platform]  +  push versionName/versionCode into the iOS project
 *
 * Usage: node scripts/build-www.mjs [--platform android|ios] [--no-sync]
 */

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, WWW_DIR, NATIVE_DIR, IOS_DIR, isMain, formatBytes, readAppVersion } from './paths.mjs';
import { buildVendor } from './build-vendor.mjs';
import { runCap } from './cap.mjs';
import { syncVersion } from './sync-version.mjs';
import { listSiteFiles } from '../../tools/site-files.mjs';
import { generateManifest } from '../../tools/gen-manifest.mjs';

function parseArgs(argv) {
  const opts = { platform: null, sync: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-sync') opts.sync = false;
    else if (a === '--platform') opts.platform = argv[++i];
    else if (a.startsWith('--platform=')) opts.platform = a.slice('--platform='.length);
    else throw new Error(`unknown argument ${a}`);
  }
  if (opts.platform && !['android', 'ios'].includes(opts.platform)) {
    throw new Error(`--platform must be android or ios, got ${opts.platform}`);
  }
  return opts;
}

export async function buildWww({ platform = null, sync = true } = {}) {
  const t0 = Date.now();
  await buildVendor();

  // Safety: only ever wipe native/www.
  if (path.dirname(WWW_DIR) !== NATIVE_DIR || path.basename(WWW_DIR) !== 'www') {
    throw new Error(`refusing to wipe unexpected directory ${WWW_DIR}`);
  }
  fs.rmSync(WWW_DIR, { recursive: true, force: true });
  fs.mkdirSync(WWW_DIR, { recursive: true });

  const files = listSiteFiles(PROJECT_ROOT);
  if (!files.includes('index.html')) throw new Error('index.html missing from site file list');
  if (!files.includes('core/vendor/capacitor.js')) throw new Error('core/vendor/capacitor.js missing from site file list');

  const madeDirs = new Set();
  let bytes = 0;
  for (const rel of files) {
    const src = path.join(PROJECT_ROOT, rel);
    const dst = path.join(WWW_DIR, rel);
    const dir = path.dirname(dst);
    if (!madeDirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      madeDirs.add(dir);
    }
    fs.copyFileSync(src, dst);
    bytes += fs.statSync(dst).size;
  }

  const manifest = await generateManifest(WWW_DIR);
  fs.writeFileSync(path.join(WWW_DIR, 'sync-manifest.json'), JSON.stringify(manifest));
  if (manifest.count !== files.length) {
    throw new Error(`manifest lists ${manifest.count} files but ${files.length} were copied`);
  }

  const { versionName, versionCode } = readAppVersion();
  console.log(
    `www: ${files.length} files, ${formatBytes(bytes)}, content version ${manifest.version} ` +
      `(app ${versionName} / ${versionCode}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  if (sync) {
    runCap(platform ? ['sync', platform] : ['sync']);
    if ((!platform || platform === 'ios') && fs.existsSync(IOS_DIR)) syncVersion();
  }
  return { files: files.length, bytes, version: manifest.version };
}

if (isMain(import.meta.url)) {
  try {
    await buildWww(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}
