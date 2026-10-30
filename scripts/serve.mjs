import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json' };

export function createStaticServer(directory) {
  const root = path.resolve(directory);
  return http.createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (req.url === '/__hui_health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ app: 'hui-gesture-bagua', root, pid: process.pid }));
      return;
    }
    let filename;
    try {
      const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
      filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!filename.startsWith(root + path.sep) || pathname.includes('\\') || pathname.includes('\0')) {
        res.writeHead(403); res.end(); return;
      }
      const stat = statSync(filename);
      if (!stat.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
        'Content-Length': stat.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') res.end();
      else createReadStream(filename).on('error', () => res.destroy()).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 5188);
  const root = process.argv[3] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  const server = createStaticServer(root);
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`HUI ready: http://127.0.0.1:${port}/`));
}
