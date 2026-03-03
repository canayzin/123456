const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');

const { app } = require('../server/index');

function req(port, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

test('phase25 healthz + readyz', async (t) => {
  process.env.EMULATOR = '0';
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const health = await req(port, '/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.json.status, 'ok');
  assert.equal(health.headers['x-content-type-options'], 'nosniff');

  const ready = await req(port, '/readyz');
  assert.equal(ready.status, 200);
  assert.equal(ready.json.status, 'ok');
});

test('phase25 structured request log includes requestId + route', async (t) => {
  process.env.LOG_FORMAT = 'json';
  const logs = [];
  const oldLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));

  const server = app.listen(0);
  t.after(async () => {
    console.log = oldLog;
    await new Promise((resolve) => server.close(resolve));
  });
  const port = server.address().port;
  await req(port, '/healthz');

  const row = logs.map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean).find((x) => x.msg === 'request.complete' && x.route === '/healthz');
  assert.equal(Boolean(row), true);
  assert.equal(typeof row.requestId, 'string');
});

test('phase25 graceful shutdown closes cleanly', async () => {
  const server = app.listen(0);
  const close = server.closeGracefully || app.closeGracefully;
  assert.equal(typeof close, 'function');
  await Promise.race([
    close(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), 4000))
  ]);
});

test('phase25 trace endpoint emulator only', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  process.env.EMULATOR = '0';
  const denied = await req(port, '/__trace');
  assert.equal(denied.status, 404);

  process.env.EMULATOR = '1';
  await req(port, '/healthz');
  const ok = await req(port, '/__trace?limit=10');
  assert.equal(ok.status, 200);
  assert.equal(Array.isArray(ok.json.items), true);
});

test('phase25 cluster smoke spawns worker in CLUSTER=1 mode', async () => {
  const port = 19080 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server/cluster.js'], {
    cwd: process.cwd(),
    env: { ...process.env, CLUSTER: '1', CLUSTER_WORKERS: '1', PORT: String(port), LOG_FORMAT: 'json' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString('utf8'); });
  child.stderr.on('data', (d) => { out += d.toString('utf8'); });

  await new Promise((r) => setTimeout(r, 1500));
  const health = await req(port, '/healthz');
  assert.equal(health.status, 200);
  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(out.includes('cluster.worker.spawn'), true);
});
