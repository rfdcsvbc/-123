import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launch = (port = 5188) => new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(project, 'start.ps1'), '-NoBrowser', '-PreferredPort', String(port)],
  { cwd: project, windowsHide: true });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  child.on('error', reject);
  child.on('exit', (code) => {
    // Detached background servers can inherit Windows pipe handles; don't wait for EOF.
    child.stdout.destroy(); child.stderr.destroy(); child.unref();
    code === 0 ? resolve(output.trim()) : reject(new Error(output));
  });
});
const readState = async () => JSON.parse((await readFile(path.join(project, 'launch-state.json'), 'utf8')).replace(/^\uFEFF/, ''));

// Hold a port with an unrelated fixture; no user process needs to be stopped.
const fixture = http.createServer((req, res) => { res.writeHead(200); res.end('unrelated app'); });
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const occupiedPort = fixture.address().port;
let ownedState;
try {
  const url = await launch(occupiedPort);
  ownedState = await readState();
  assert.notEqual(url, `http://127.0.0.1:${occupiedPort}/`);
  const health = await (await fetch(`${url}__hui_health`)).json();
  assert.equal(health.app, 'hui-gesture-bagua');
  assert.equal(health.root, path.join(project, 'dist'));
  assert.equal(health.pid, ownedState.pid);
  const html = await (await fetch(url)).text();
  assert.match(html, /id="challenge"/);
  const wasm = await fetch(`${url}mediapipe/hands_solution_simd_wasm_bin.wasm`, { method: 'HEAD' });
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  console.log('PASS: cold start, occupied port fallback, correct project, local model assets');
  assert.equal(await launch(occupiedPort), url);
  assert.equal((await readState()).pid, ownedState.pid);
  console.log('PASS: repeated launch reuses the existing project server');
} finally {
  await new Promise((resolve) => fixture.close(resolve));
  if (ownedState) {
    const health = await (await fetch(`${ownedState.url}__hui_health`)).json();
    // Kill only the server this test just launched, after revalidating its identity.
    if (health.app === 'hui-gesture-bagua' && health.root === path.join(project, 'dist') && health.pid === ownedState.pid) {
      process.kill(ownedState.pid);
    }
  }
  await launch();
}
