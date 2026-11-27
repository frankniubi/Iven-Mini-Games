/**
 * Which files make up the deployable site (and the offline bundle inside the app).
 * Shared by the deploy script, the sync-manifest generator and the native www build.
 */

import fs from 'node:fs';
import path from 'node:path';

// Top-level entries that never ship.
export const TOP_EXCLUDES = new Set([
  'native',
  'tools',
  'docs',
  'download',
  'node_modules',
  'server.mjs',
  'start-lan.bat',
  'README.md',
  'sync-manifest.json',
]);

const FILE_EXCLUDES = [/\.md$/i, /^thumbs\.db$/i, /\.(orig|bak|tmp|log)$/i];

export function isShippable(relPath) {
  const parts = relPath.split('/');
  if (TOP_EXCLUDES.has(parts[0])) return false;
  if (parts.some((p) => p.startsWith('.'))) return false;
  const base = parts[parts.length - 1];
  return !FILE_EXCLUDES.some((re) => re.test(base));
}

/** Relative POSIX paths of every shippable file under root, sorted. */
export function listSiteFiles(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (rel === '' && TOP_EXCLUDES.has(ent.name)) continue;
        if (ent.name.startsWith('.')) continue;
        walk(path.join(dir, ent.name), childRel);
      } else if (ent.isFile() && isShippable(childRel)) {
        out.push(childRel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}
