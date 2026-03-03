const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { QuotaEngine } = require('../quota/engine');
const { app, identity, tenants, quotaEngine } = require('../server/index');

function reset() {
  fs.rmSync(path.join(process.cwd(), 'data', 'quota'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'usage'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'users.json'), { force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'refreshTokens.json'), { force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'authLockouts.json'), { force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'tenants.json'), { force: true });
  fs.rmSync(path.join(process.cwd(), 'secrets', 'keys.json'), { force: true });
}

function req(port, method, route, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : {} }));
    });
    r.on('error', reject);
    if (body) r.end(JSON.stringify(body));
    else r.end();
  });
}

test('phase8 quota engine enforcement/metering/admin/usage/persistence', async () => {
  reset();
  const q = new QuotaEngine();
  q.setQuota('p1', { ...q.getQuota('p1'), mode: 'enforce', rateLimit: { ip: { reqPerMin: 2 }, uid: { reqPerMin: 2 } }, limits: { ...q.getQuota('p1').limits, docdb: { readsPerMin: 1, writesPerMin: 1 }, storage: { ...q.getQuota('p1').limits.storage, bytesWritePerDay: 5, bytesReadPerDay: 5, opsPerMin: 2 }, functions: { invocationsPerMin: 1, maxTimeoutMs: 1000 }, sync: { opsPerMin: 2 }, ws: { connections: 1, messagesPerMin: 1 } } });
  q.preCheck({ projectId: 'p1', ip: '1.1.1.1', uid: 'u1', service: 'docdb', op: 'read', amount: 1 });
  assert.throws(() => q.preCheck({ projectId: 'p1', ip: '1.1.1.1', uid: 'u1', service: 'docdb', op: 'read', amount: 1 }), /Quota exceeded/);
  const qObs = new QuotaEngine();
  qObs.setQuota('p2', { ...qObs.getQuota('p2'), mode: 'observe', rateLimit: { ip: { reqPerMin: 1 }, uid: { reqPerMin: 1 } } });
  qObs.preCheck({ projectId: 'p2', ip: '1', uid: 'u', service: 'docdb', op: 'read', amount: 1 });
  qObs.preCheck({ projectId: 'p2', ip: '1', uid: 'u', service: 'docdb', op: 'read', amount: 1 });

  q.meter({ projectId: 'p1', service: 'storage', op: 'writeBytes', bytes: 3, count: 1, requestId: 'r1' });
  assert.throws(() => q.meter({ projectId: 'p1', service: 'storage', op: 'writeBytes', bytes: 3, count: 1, requestId: 'r2' }), /Quota exceeded/);

  q.meter({ projectId: 'p1', service: 'docdb', op: 'read', count: 1, requestId: 'r3' });
  q.meter({ projectId: 'p1', service: 'docdb', op: 'write', count: 1, requestId: 'r4' });
  q.meter({ projectId: 'p1', service: 'functions', op: 'invoke', count: 1, requestId: 'r5' });
  q.meter({ projectId: 'p1', service: 'sync', op: 'ops', count: 1, requestId: 'r6' });

  const usage = q.getUsage('p1', 0, Date.now());
  assert.ok(usage.find((x) => x.requestId === 'r5' && x.projectId === 'p1'));
  const qReload = new QuotaEngine();
  qReload.setQuota('p1', q.getQuota('p1'));
  qReload.meter({ projectId: 'p1', service: 'docdb', op: 'read', count: 1, requestId: 'r7' });
  assert.ok(qReload.counters.load('p1').totals['docdb.read.count'] >= 1);

  // server/admin endpoints + middleware enforcement
  identity.rotateKeys();
  const tenant = tenants.ensureProject({ organization: 'o1', project: 'p1', environment: 'dev' });
  await identity.signup({ tenant, email: 'quota@x.com', password: 'password123', ip: '1.1.1.1' });
  const user = await identity.login({ tenant, email: 'quota@x.com', password: 'password123', ip: '1.1.1.1' });
  const adminToken = identity.auth.jwt.signToken({ sub: 'admin-user', type: 'access', extra: { role: 'admin' }, ttlSec: 600 });

  quotaEngine.setQuota('p1', { ...quotaEngine.getQuota('p1'), mode: 'enforce', rateLimit: { ip: { reqPerMin: 2 }, uid: { reqPerMin: 2 } } });
  const srv = app.listen(0); const port = srv.address().port;
  const qGetDenied = await req(port, 'GET', '/v1/projects/p1/quota', null, { authorization: `Bearer ${user.accessToken}` });
  assert.equal(qGetDenied.status, 400);
  const qGet = await req(port, 'GET', '/v1/projects/p1/quota', null, { authorization: `Bearer ${adminToken}` });
  assert.equal(qGet.status, 200);
  const qPut = await req(port, 'PUT', '/v1/projects/p1/quota', { ...qGet.body, mode: 'observe' }, { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' });
  assert.equal(qPut.status, 200);
  const qUsage = await req(port, 'GET', `/v1/projects/p1/usage?from=0&to=${Date.now()}`, null, { authorization: `Bearer ${adminToken}` });
  assert.equal(qUsage.status, 200);

  // IP+UID rate deny in enforce mode
  await req(port, 'PUT', '/v1/projects/p1/quota', { ...qGet.body, mode: 'enforce', rateLimit: { ip: { reqPerMin: 2 }, uid: { reqPerMin: 2 } } }, { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' });

  await req(port, 'GET', '/metrics', null, { 'x-project': 'p1', authorization: `Bearer ${user.accessToken}` });
  await req(port, 'GET', '/metrics', null, { 'x-project': 'p1', authorization: `Bearer ${user.accessToken}` });
  const denied = await req(port, 'GET', '/metrics', null, { 'x-project': 'p1', authorization: `Bearer ${user.accessToken}` });
  assert.equal([400, 429].includes(denied.status), true);

  srv.close();
});
