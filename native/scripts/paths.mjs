/** Shared paths/helpers for the native build scripts. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const NATIVE_DIR = path.resolve(SCRIPTS_DIR, '..');
export const PROJECT_ROOT = path.resolve(NATIVE_DIR, '..');
export const WWW_DIR = path.join(NATIVE_DIR, 'www');
export const DIST_DIR = path.join(NATIVE_DIR, 'dist');
export const ANDROID_DIR = path.join(NATIVE_DIR, 'android');
export const IOS_DIR = path.join(NATIVE_DIR, 'ios');

/** true when the given module URL is the script node was started with */
export function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === moduleUrl;
}

/** native/package.json: "version" = versionName, "versionCode" = integer versionCode */
export function readAppVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(NATIVE_DIR, 'package.json'), 'utf8'));
  const versionName = String(pkg.version);
  const versionCode = Number(pkg.versionCode);
  if (!/^\d+\.\d+\.\d+$/.test(versionName)) throw new Error(`package.json version "${versionName}" must be x.y.z`);
  if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error(`package.json versionCode "${pkg.versionCode}" must be a positive integer`);
  return { versionName, versionCode };
}

export function formatBytes(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
