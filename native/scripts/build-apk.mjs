/**
 * One-shot Android build: build-www (vendor + www + manifest + cap sync android)
 *   -> gradle assembleRelease|assembleDebug -> native/dist/minigames-<versionName>[-debug].apk
 *
 * Usage: node scripts/build-apk.mjs [release|debug] [--skip-www]
 *   npm run apk        (release, signed with the dev keystore)
 *   npm run apk:debug
 */

import fs from 'node:fs';
import path from 'node:path';
import { ANDROID_DIR, DIST_DIR, isMain, formatBytes, readAppVersion } from './paths.mjs';
import { buildWww } from './build-www.mjs';
import { runGradle } from './gradle.mjs';

export async function buildApk({ variant = 'release', skipWww = false } = {}) {
  if (!['release', 'debug'].includes(variant)) throw new Error(`variant must be release or debug, got ${variant}`);
  const t0 = Date.now();
  if (!skipWww) await buildWww({ platform: 'android' });

  const task = variant === 'release' ? 'assembleRelease' : 'assembleDebug';
  runGradle([task]);

  const outDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', variant);
  const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'output-metadata.json'), 'utf8'));
  const built = path.join(outDir, meta.elements[0].outputFile);
  const { versionName, versionCode } = readAppVersion();
  if (meta.elements[0].versionName !== versionName || meta.elements[0].versionCode !== versionCode) {
    throw new Error(`APK version ${meta.elements[0].versionName}/${meta.elements[0].versionCode} != package.json ${versionName}/${versionCode}`);
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const target = path.join(DIST_DIR, `minigames-${versionName}${variant === 'debug' ? '-debug' : ''}.apk`);
  fs.copyFileSync(built, target);
  console.log(`apk: ${target} (${formatBytes(fs.statSync(target).size)}, ${versionName}/${versionCode}, ${variant}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return target;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    await buildApk({ variant: args.find((a) => !a.startsWith('--')) || 'release', skipWww: args.includes('--skip-www') });
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}
