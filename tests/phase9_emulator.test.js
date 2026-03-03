const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const req = http.request({ hostname: '127.0.0.1', port: 8080, method, path, headers: { ...headers, ...(payload ? { 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startServer(env = {}) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 50; i += 1) {
    try {
      const out = await request('GET', '/metrics');
      if (out.status === 200) return child;
    } catch {}
    await wait(100);
  }
  throw new Error('server did not boot');
}

async function stopServer(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await wait(150);
  if (!child.killed) child.kill('SIGKILL');
}

test('phase9 emulator endpoints and determinism', async () => {
  const off = await startServer({ EMULATOR: '0' });
  try {
    const status404 = await request('GET', '/__emulator/status');
    assert.equal(status404.status, 404);
  } finally {
    await stopServer(off);
  }

  const on = await startServer({ EMULATOR: '1' });
  try {
    const status = await request('GET', '/__emulator/status');
    assert.equal(status.status, 200);
    assert.equal(status.json.enabled, true);

    const fullReset = await request('POST', '/__emulator/reset', { headers: { 'content-type': 'application/json' }, body: {} });
    assert.equal(fullReset.status, 200);

    const modeMemory = await request('POST', '/__emulator/mode', { headers: { 'content-type': 'application/json' }, body: { mode: 'memory' } });
    assert.equal(modeMemory.status, 200);
    assert.equal(modeMemory.json.mode, 'memory');

    const modeFile = await request('POST', '/__emulator/mode', { headers: { 'content-type': 'application/json' }, body: { mode: 'file' } });
    assert.equal(modeFile.status, 200);
    assert.equal(modeFile.json.mode, 'file');

    const seed = await request('POST', '/__emulator/seed', {
      headers: { 'content-type': 'application/json' },
      body: {
        projectId: 'p1',
        time: 1700000000000,
        users: [{ email: 'a@x.com', password: 'password1', role: 'admin' }],
        docs: [{ collection: 'todos', docId: '1', data: { title: 'hi', owner: 'u1' } }],
        storage: [{ bucket: 'bkt1', key: 'k.txt', contentBase64: Buffer.from('hello').toString('base64'), contentType: 'text/plain' }],
        quota: { limits: { functions: { invocationsPerMin: 10 } }, mode: 'observe' }
      }
    });
    assert.equal(seed.status, 200);

    const login = await request('POST', '/auth/login', {
      headers: { 'content-type': 'application/json', 'x-project': 'p1' },
      body: { email: 'a@x.com', password: 'password1' }
    });
    assert.equal(login.status, 200);
    assert.ok(login.json.accessToken);

    const doc = await request('GET', '/__emulator/doc/todos/1?projectId=p1');
    assert.equal(doc.status, 200);
    assert.equal(doc.json.doc.title, 'hi');
    assert.equal(doc.json.doc._createdAt, 1700000000000);

    const sign = await request('POST', '/v1/projects/p1/storage/sign', {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${login.json.accessToken}` },
      body: { bucket: 'bkt1', key: 'k.txt', method: 'GET' }
    });
    assert.equal(sign.status, 200);
    const signedUrl = new URL(sign.json.url, 'http://127.0.0.1:8080');
    const download = await request('GET', `${signedUrl.pathname}${signedUrl.search}`);
    assert.equal(download.status, 200);
    assert.equal(download.raw.toString('utf8'), 'hello');

    const quota = await request('GET', '/__emulator/quota/p1');
    assert.equal(quota.status, 200);
    assert.equal(quota.json.limits.functions.invocationsPerMin, 10);

    const deterministic = await request('GET', '/__emulator/status', { headers: { 'x-deterministic-id': 'fixed123' } });
    assert.equal(deterministic.status, 200);
    assert.equal(deterministic.headers['x-request-id'], 'fixed123');

    const seedP2 = await request('POST', '/__emulator/seed', {
      headers: { 'content-type': 'application/json' },
      body: { projectId: 'p2', docs: [{ collection: 'todos', docId: '2', data: { title: 'keep' } }] }
    });
    assert.equal(seedP2.status, 200);

    const resetP1 = await request('POST', '/__emulator/reset', { headers: { 'content-type': 'application/json' }, body: { projectId: 'p1' } });
    assert.equal(resetP1.status, 200);

    const docAfterReset = await request('GET', '/__emulator/doc/todos/1?projectId=p1');
    assert.equal(docAfterReset.status, 200);
    assert.equal(docAfterReset.json.doc, null);

    const signAfterReset = await request('POST', '/v1/projects/p1/storage/sign', {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${login.json.accessToken}` },
      body: { bucket: 'bkt1', key: 'k.txt', method: 'GET' }
    });
    assert.equal(signAfterReset.status, 200);
    const signedAfterReset = new URL(signAfterReset.json.url, 'http://127.0.0.1:8080');
    const downloadAfterReset = await request('GET', `${signedAfterReset.pathname}${signedAfterReset.search}`);
    assert.equal(downloadAfterReset.status, 400);

    const quotaAfterReset = await request('GET', '/__emulator/quota/p1');
    assert.equal(quotaAfterReset.status, 200);
    assert.notEqual(quotaAfterReset.json.limits.functions.invocationsPerMin, 10);

    const p2Doc = await request('GET', '/__emulator/doc/todos/2?projectId=p2');
    assert.equal(p2Doc.status, 200);
    assert.equal(p2Doc.json.doc.title, 'keep');
  } finally {
    await stopServer(on);
  }
});
