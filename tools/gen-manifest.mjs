/**
 * Writes sync-manifest.json: every shippable file with its size and a short sha256.
 * The app compares this against the copy it is serving to download only what changed.
 *
 * Usage: node tools/gen-manifest.mjs [siteRoot] [--out file]
 * The version is a hash of the file list, so identical content always gets the same version.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSiteFiles } from './site-files.mjs';

const HASH_LEN = 16;

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex').slice(0, HASH_LEN)));
  });
}

export async function generateManifest(root, files = listSiteFiles(root)) {
  const entries = [];
  let totalSize = 0;
  for (const rel of files) {
    const abs = path.join(root, rel);
    const size = fs.statSync(abs).size;
    entries.push([rel, size, await hashFile(abs)]);
    totalSize += size;
  }
  const listHash = crypto.createHash('sha256');
  for (const [rel, size, hash] of entries) listHash.update(`${rel}\0${size}\0${hash}\n`);
  return {
    format: 1,
    app: 'minigames',
    version: listHash.digest('hex').slice(0, 12),
    generated: new Date().toISOString(),
    count: entries.length,
    totalSize,
    files: entries,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
  const root = path.resolve(args[0] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const manifest = await generateManifest(root);
  const target = out ? path.resolve(out) : path.join(root, 'sync-manifest.json');
  fs.writeFileSync(target, JSON.stringify(manifest));
  console.log(`sync-manifest: ${manifest.count} files, ${(manifest.totalSize / 1048576).toFixed(1)} MB, version ${manifest.version} -> ${target}`);
}
