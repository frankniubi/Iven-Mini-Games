/**
 * Zero-dependency LAN static HTTP server for Arcade Box Game Hall.
 * Usage: node server.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function getLanUrls(port) {
  const urls = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push({ name, url: `http://${net.address}:${port}` });
      }
    }
  }
  return urls;
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let relPath = decodeURIComponent(reqUrl.pathname);
  if (relPath === '/' || relPath === '') relPath = '/index.html';

  const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(__dirname, safePath);

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(fullPath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🫧 小游戏大厅 · Arcade Box 已启动！\n');
  console.log(`  本机访问：http://localhost:${PORT}`);
  const lans = getLanUrls(PORT);
  if (lans.length > 0) {
    console.log('\n  📱 手机 / iPad（同一 Wi-Fi 下浏览器打开）：');
    for (const item of lans) {
      console.log(`     ${item.url}   (${item.name})`);
    }
  }
  console.log('\n  提示：iPhone/iPad Safari 打开后点击「分享 → 添加到主屏幕」即可全屏像 App 一样畅玩！');
  console.log('  按 Ctrl+C 停止服务。\n');
});
