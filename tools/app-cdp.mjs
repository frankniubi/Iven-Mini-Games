/**
 * Evaluate JavaScript inside the app's WebView on a connected device/emulator (debug builds),
 * through Chrome DevTools: node tools/app-cdp.mjs "<expression>"
 * The expression may return a promise; the result is printed as JSON.
 * Needs adb on PATH (source native/scripts/env.sh).
 */

import { execSync } from 'node:child_process';

const PORT = 9333;

function forward() {
  const unix = execSync('adb shell cat /proc/net/unix', { encoding: 'utf8' });
  const m = unix.match(/@(webview_devtools_remote_\d+)/);
  if (!m) throw new Error('no debuggable WebView (is the debug build running?)');
  execSync(`adb forward tcp:${PORT} localabstract:${m[1]}`);
}

async function main() {
  const expr = process.argv[2];
  if (!expr) throw new Error('usage: node tools/app-cdp.mjs "<expression>"');
  forward();
  const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = pages.find((p) => p.type === 'page' && /localhost/.test(p.url)) || pages[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  const result = await new Promise((resolve, reject) => {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      if (msg.error) reject(new Error(msg.error.message));
      else if (msg.result.exceptionDetails) reject(new Error(msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text));
      else resolve(msg.result.result.value);
    };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1));
}

main().catch((err) => {
  console.error('ERR', err.message);
  process.exit(1);
});
