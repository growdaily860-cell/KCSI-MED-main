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
  const entryRoutes = new Set(['/', '/field', '/research', '/deid-report']);
  const rel = entryRoutes.has(pathname.replace(/\/+$/, '') || '/') ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    const headers = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' };
    // 배경 장면은 sandbox iframe(고유 출처)에서 모듈로 불러오므로 vendor 파일에 CORS 허용이 필요하다.
    if (pathname.startsWith('/vendor/')) headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(200, headers);
    res.end(body);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`KCSI-MED local server: http://127.0.0.1:${port}/`);
});
