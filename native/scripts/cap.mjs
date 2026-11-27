/**
 * Runs the local Capacitor CLI (node_modules/@capacitor/cli) from the native/ directory.
 * Usage: node scripts/cap.mjs <cap args...>      e.g. node scripts/cap.mjs sync android
 *
 * CI=1 is set for the child so the CLI never prompts and never opts this machine into
 * Capacitor's (interactive-only) telemetry from scripted runs.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { NATIVE_DIR, isMain } from './paths.mjs';

const require = createRequire(import.meta.url);

export function runCap(args, { allowFailure = false } = {}) {
  const bin = require.resolve('@capacitor/cli/bin/capacitor');
  console.log(`> cap ${args.join(' ')}`);
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd: NATIVE_DIR,
    stdio: 'inherit',
    env: { ...process.env, CI: process.env.CI || '1' },
  });
  if (res.status !== 0 && !allowFailure) {
    throw new Error(`cap ${args.join(' ')} failed (exit ${res.status ?? res.signal})`);
  }
  return res.status;
}

if (isMain(import.meta.url)) {
  try {
    runCap(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
