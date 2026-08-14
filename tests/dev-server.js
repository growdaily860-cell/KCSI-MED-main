// 의존성 없는 로컬 정적 서버 — 브라우저 수동/E2E 확인용.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2] || 8765);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  const pathname = decodeURIComponent(String(req.url || '/').split('?')[0]);
  const entryRoutes = new Set(['/', '/field', '/research']);
  const rel = entryRoutes.has(pathname.replace(/\/+$/, '') || '/') ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`KCSI-MED local server: http://127.0.0.1:${port}/`);
});
