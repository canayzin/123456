const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { app, storageService, functionsService, quotaEngine } = require('../server/index');

function reset() {
  fs.rmSync(path.join(process.cwd(), 'data', 'object_store'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'storage'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'functions'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'audit'), { recursive: true, force: true });
  fs.mkdirSync(path.join(process.cwd(), 'data', 'audit'), { recursive: true });
}

function requestRaw(port, method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('phase6 storage bucket/signed/rules/limits/triggers/metrics', async () => {
  reset();
  quotaEngine.setQuota('p1', { ...quotaEngine.getQuota('p1'), mode: 'observe' });
  const server = app.listen(0);
  const port = server.address().port;

  const bCreate = await requestRaw(port, 'POST', '/v1/projects/p1/buckets', Buffer.from(JSON.stringify({ bucketName: 'bkt1' })), { 'content-type': 'application/json' });
  assert.equal(bCreate.status, 201);
  const bList = await requestRaw(port, 'GET', '/v1/projects/p1/buckets');
  assert.equal(JSON.parse(bList.body.toString()).buckets.length, 1);

  // sign write should fail without auth due to rules
  const signDeny = await requestRaw(port, 'POST', '/v1/projects/p1/storage/sign', Buffer.from(JSON.stringify({ bucket: 'bkt1', key: 'a.txt', method: 'PUT', expSeconds: 60 })), { 'content-type': 'application/json' });
  assert.equal(signDeny.status, 400);

  // issue directly with auth context
  const writeUrl = storageService.signUrl('p1', { bucket: 'bkt1', key: 'a.txt', method: 'PUT', expSeconds: 60, contentType: 'text/plain', contentLength: 5, ownerUid: 'u1' }, { auth: { uid: 'u1' } });
  const put = await requestRaw(port, 'PUT', writeUrl, Buffer.from('hello'), { 'content-type': 'text/plain', 'content-length': '5', 'x-owner-uid': 'u1' });
  assert.equal(put.status, 200);
  const meta = JSON.parse(put.body.toString()).metadata;
  assert.equal(meta.size, 5);
  assert.ok(meta.etag);

  const readUrl = storageService.signUrl('p1', { bucket: 'bkt1', key: 'a.txt', method: 'GET', expSeconds: 60 }, { auth: { uid: 'u1' } });
  const get = await requestRaw(port, 'GET', readUrl);
  assert.equal(get.body.toString(), 'hello');
  assert.equal(get.headers.etag, meta.etag);

  const expired = storageService.signUrl('p1', { bucket: 'bkt1', key: 'a.txt', method: 'GET', expSeconds: -1 }, { auth: { uid: 'u1' } });
  const expRes = await requestRaw(port, 'GET', expired);
  assert.equal(expRes.status, 400);

  const mismatch = await requestRaw(port, 'DELETE', readUrl);
  assert.equal(mismatch.status, 400);

  assert.throws(() => storageService.createBucket('p1', '../evil'), /Invalid/);

  const big = Buffer.alloc(11 * 1024 * 1024, 1);
  const bigUrl = storageService.signUrl('p1', { bucket: 'bkt1', key: 'big.bin', method: 'PUT', expSeconds: 60, ownerUid: 'u1' }, { auth: { uid: 'u1' } });
  let bigDenied = false;
  try {
    const bigRes = await requestRaw(port, 'PUT', bigUrl, big, { 'content-type': 'application/octet-stream', 'x-owner-uid': 'u1', 'content-length': String(big.length) });
    bigDenied = bigRes.status === 400;
  } catch {
    bigDenied = true;
  }
  assert.equal(bigDenied, true);

  functionsService.deploy('p1', { name: 'onStorageFinalize', entryPath: 'functions/handlers/onStorageFinalize.js', exportName: 'onStorageFinalize', triggerType: 'storage.finalize' });
  const trigUrl = storageService.signUrl('p1', { bucket: 'bkt1', key: 't.txt', method: 'PUT', expSeconds: 60, ownerUid: 'u1' }, { auth: { uid: 'u1' } });
  const trigPut = await requestRaw(port, 'PUT', trigUrl, Buffer.from('x'), { 'content-type': 'application/octet-stream', 'x-owner-uid': 'u1' });
  assert.equal(trigPut.status, 200);
  const logs = functionsService.logs('p1', 'onStorageFinalize');
  assert.ok(logs.find((x) => x.type === 'functions.invoke'));

  assert.ok(storageService.metrics.storage_put_total >= 2);
  assert.ok(storageService.metrics.storage_get_total >= 1);

  const m = await requestRaw(port, 'GET', '/metrics');
  const parsed = JSON.parse(m.body.toString());
  assert.ok(parsed.storage.storage_signed_url_issued_total >= 1);

  server.close();
});
