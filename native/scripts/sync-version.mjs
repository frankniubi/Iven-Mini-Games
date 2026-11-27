/**
 * Single source of truth for the app version: native/package.json
 *   "version"     -> Android versionName / iOS MARKETING_VERSION (CFBundleShortVersionString)
 *   "versionCode" -> Android versionCode / iOS CURRENT_PROJECT_VERSION (CFBundleVersion)
 *
 * Android reads package.json directly from android/app/build.gradle at build time.
 * iOS keeps the values in project.pbxproj, so this script rewrites them there.
 * Usage: node scripts/sync-version.mjs   (also run by build-www after `cap sync`)
 */

import fs from 'node:fs';
import path from 'node:path';
import { IOS_DIR, isMain, readAppVersion } from './paths.mjs';

export function syncVersion() {
  const { versionName, versionCode } = readAppVersion();
  const pbx = path.join(IOS_DIR, 'App', 'App.xcodeproj', 'project.pbxproj');
  if (!fs.existsSync(pbx)) {
    console.log('version: no iOS project, skipped');
    return { versionName, versionCode };
  }
  const before = fs.readFileSync(pbx, 'utf8');
  const after = before
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${versionName};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`);
  if (after !== before) fs.writeFileSync(pbx, after);
  console.log(`version: iOS MARKETING_VERSION=${versionName} CURRENT_PROJECT_VERSION=${versionCode}${after === before ? ' (unchanged)' : ''}`);
  return { versionName, versionCode };
}

if (isMain(import.meta.url)) syncVersion();
