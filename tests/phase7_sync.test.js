const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { SyncService } = require('../sync/engine');
const { DocDbEngine } = require('../services/docdb');
const { app, identity, tenants, syncService, docdb } = require('../server/index');

function reset() {
  fs.rmSync(path.join(process.cwd(), 'data', 'sync'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'docdb.json'), { force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'users.json'), { force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'refreshTokens.json'), { force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'authLockouts.json'), { force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'tenants.json'), { force: true });
  fs.rmSync(path.join(process.cwd(), 'secrets', 'keys.json'), { force: true });
}

function req(port, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/v1/projects/p1/sync', method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out || '{}') }));
    });
    r.on('error', reject);
    r.end(JSON.stringify(body));
  });
}

test('phase7 CRDT sync engine convergence/idempotency/endpoint/compaction/bridge/limits/metrics', async () => {
  reset();
  const local = new SyncService({ docdb: new DocDbEngine() });

  const opA = { opId: 'opA', actorId: 'a', projectId: 'p1', collection: 'todos', docId: '1', lamport: 1, wallTime: 10, type: 'setField', field: 'title', value: 'A' };
  const opB = { opId: 'opB', actorId: 'b', projectId: 'p1', collection: 'todos', docId: '1', lamport: 1, wallTime: 10, type: 'setField', field: 'title', value: 'B' };
  await local.applyOps([opA, opB]);
  assert.equal(local.getState('p1', 'todos', '1').state.title, 'B'); // actor tie-break lexicographic

  await local.applyOps([{ opId: 'opR', actorId: 'a', projectId: 'p1', collection: 'todos', docId: '1', lamport: 2, wallTime: 11, type: 'removeField', field: 'title' },
    { opId: 'opS', actorId: 'b', projectId: 'p1', collection: 'todos', docId: '1', lamport: 2, wallTime: 10, type: 'setField', field: 'title', value: 'X' }]);
  assert.equal(local.getState('p1', 'todos', '1').state.title, undefined);

  const before = JSON.stringify(local.getState('p1', 'todos', '1'));
  await local.applyOps([opA, opB]);
  assert.equal(JSON.stringify(local.getState('p1', 'todos', '1')), before);

  await local.applyOps([{ opId: 'opD', actorId: 'a', projectId: 'p1', collection: 'todos', docId: '1', lamport: 3, wallTime: 12, type: 'deleteDoc' }]);
  await local.applyOps([{ opId: 'opLate', actorId: 'b', projectId: 'p1', collection: 'todos', docId: '1', lamport: 4, wallTime: 13, type: 'setField', field: 'title', value: 'late' }]);
  assert.equal(local.getState('p1', 'todos', '1').state, null);

  const tenant = tenants.ensureProject({ organization: 'o1', project: 'p1', environment: 'dev' });
  identity.rotateKeys();
  await identity.signup({ tenant, email: 'sync@x.com', password: 'password123', ip: '1.1.1.1' });
  const login = await identity.login({ tenant, email: 'sync@x.com', password: 'password123', ip: '1.1.1.1' });

  const srv = app.listen(0);
  const port = srv.address().port;
  const r1 = await req(port, login.accessToken, { actorId: 'deviceA', sinceVersion: 0, ops: [{ collection: 'tasks', docId: 'x', lamport: 1, wallTime: 1, type: 'setField', field: 'done', value: false }] });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.newVersion >= 1);
  const dbDoc = docdb.collection('tasks').doc('x').get();
  assert.equal(dbDoc.done, false);

  const tooMany = await req(port, login.accessToken, { actorId: 'deviceA', sinceVersion: 0, ops: Array.from({ length: 501 }, (_, i) => ({ collection: 'tasks', docId: 'x', lamport: 2 + i, wallTime: 2 + i, type: 'setField', field: `f${i}`, value: i })) });
  assert.equal(tooMany.status, 400);

  // compaction path
  for (let i = 0; i < 210; i += 1) {
    await syncService.sync('p1', 'deviceA', { actorId: 'deviceA', sinceVersion: 0, ops: [{ collection: 'tasks', docId: 'x', lamport: 10 + i, wallTime: 10 + i, type: 'setField', field: `k${i}`, value: i }] }, { uid: 'sync@x.com' });
  }
  const out = await syncService.sync('p1', 'deviceA', { actorId: 'deviceA', sinceVersion: 0, ops: [] }, { uid: 'sync@x.com' });
  assert.ok(out.snapshot);
  assert.ok(syncService.metrics.sync_compactions_total >= 1);
  assert.ok(syncService.metrics.sync_requests_total >= 1);

  srv.close();
});
