import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createStaticServer } from '../scripts/serve.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

describe('desktop static server', () => {
  let server, root, port;
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'hui-server-test-'));
    writeFileSync(path.join(root, 'index.html'), '<title>HUI</title>');
    writeFileSync(path.join(root, 'model.wasm'), 'wasm');
    server = createStaticServer(root);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });
  const request = (pathname, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method }, (res) => {
      let body = ''; res.on('data', (data) => { body += data; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
  it('identifies this project before reusing a listening port', async () => {
    const result = await request('/__hui_health');
    expect(JSON.parse(result.body)).toMatchObject({ app: 'hui-gesture-bagua', root, pid: process.pid });
  });
  it('serves the page and WASM with the correct types', async () => {
    expect(await request('/')).toMatchObject({ status: 200, body: '<title>HUI</title>' });
    expect((await request('/model.wasm')).headers['content-type']).toBe('application/wasm');
    expect(await request('/model.wasm', 'HEAD')).toMatchObject({ status: 200, body: '' });
  });
  it('rejects traversal, missing assets and writes', async () => {
    expect((await request('/%2e%2e/package.json')).status).toBe(403);
    expect((await request('/..%5cpackage.json')).status).toBe(403);
    expect((await request('/%E0%A4%A')).status).toBe(404);
    expect((await request('/missing.js')).status).toBe(404);
    expect((await request('/', 'POST')).status).toBe(405);
  });
});
