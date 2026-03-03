const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { FunctionsService } = require('../functions');
const { RulesEngine } = require('../rules/engine');
const { app, functionsService, docdb, identity, tenants } = require('../server/index');
const flaky = require('../functions/handlers/flaky');

function resetFiles() {
  fs.mkdirSync(path.join(process.cwd(), 'data', 'functions'), { recursive: true });
  fs.mkdirSync(path.join(process.cwd(), 'data', 'secrets'), { recursive: true });
  fs.mkdirSync(path.join(process.cwd(), 'data', 'audit'), { recursive: true });
  for (const f of fs.readdirSync(path.join(process.cwd(), 'data', 'functions'))) fs.unlinkSync(path.join(process.cwd(), 'data', 'functions', f));
  for (const f of fs.readdirSync(path.join(process.cwd(), 'data', 'audit'))) fs.unlinkSync(path.join(process.cwd(), 'data', 'audit', f));
  fs.writeFileSync(path.join(process.cwd(), 'data', 'secrets', 'p1.json'), JSON.stringify({ secrets: { TOKEN: { value: 'abc' } } }));
}

function post(port, url, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out || '{}') }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body || {}));
  });
}

test('phase5 deploy/version/http/callable/triggers/retry/timeout/secrets/coldstart/emulator/isolation', async () => {
  resetFiles();
  flaky.reset();

  const rules = new RulesEngine("rules_version = '1'; match /databases/{db}/documents { match /posts/{id} { allow read: if false; } }");
  const svc = new FunctionsService({ emulator: false, rulesEngine: rules });

  const d1 = svc.deploy('p1', { name: 'helloHttp', entryPath: 'functions/handlers/helloHttp.js', exportName: 'helloHttp', triggerType: 'http' });
  const d2 = svc.deploy('p1', { name: 'helloHttp', entryPath: 'functions/handlers/helloHttp.js', exportName: 'helloHttp', triggerType: 'http' });
  assert.equal(d1.version, 1);
  assert.equal(d2.version, 2);

  const out = await svc.invoker.invoke('p1', 'helloHttp', { a: 1 }, { auth: { uid: 'u1' }, requestId: 'r1' });
  assert.equal(out.result.message, 'hello');

  const unauth = await svc.call('p1', 'helloHttp', {}, { x: 1 });
  assert.equal(unauth.error.code, 'UNAUTHORIZED');
  const callable = await svc.call('p1', 'helloHttp', { auth: { uid: 'u1' } }, { x: 1 });
  assert.equal(callable.result.echo.x, 1);

  svc.deploy('p1', { name: 'transformDoc', entryPath: 'functions/handlers/transformDoc.js', exportName: 'transformDoc', triggerType: 'doc.write', retryPolicy: { mode: 'at_most_once', maxAttempts: 1 } });
  await svc.triggerDocWrite({ projectId: 'p1', collection: 'posts', docId: '1', before: { owner: 'u1' }, after: { owner: 'u1' } });
  const logs = svc.logs('p1', 'transformDoc');
  assert.ok(logs.find((x) => x.type === 'functions.secrets.read'));

  svc.deploy('p1', { name: 'flaky', entryPath: 'functions/handlers/flaky.js', exportName: 'flaky', triggerType: 'doc.write', retryPolicy: { mode: 'at_least_once', maxAttempts: 3, baseDelayMs: 5 } });
  await svc.triggerDocWrite({ projectId: 'p1', collection: 'posts', docId: '2', before: null, after: { owner: 'u1' } });
  assert.ok(svc.metrics.snapshot().functions_retries_total >= 2);

  svc.deploy('p1', { name: 'hang', entryPath: 'functions/handlers/hang.js', exportName: 'hang', triggerType: 'callable', timeoutMs: 20, retryPolicy: { mode: 'at_most_once', maxAttempts: 1 } });
  const timed = await svc.call('p1', 'hang', { auth: { uid: 'u1' } }, {});
  assert.equal(timed.error.code, 'FUNCTION_TIMEOUT');

  const m = svc.metrics.snapshot();
  assert.ok(m.functions_cold_starts_total >= 1);

  const emu = new FunctionsService({ emulator: true, rulesEngine: rules });
  emu.deploy('p1', { name: 'helloHttp', entryPath: 'functions/handlers/helloHttp.js', exportName: 'helloHttp', triggerType: 'http' });
  const emuOut = await emu.invoker.invoke('p1', 'helloHttp', {}, { auth: { uid: 'u1' } });
  assert.equal(emuOut.result.message, 'hello');

  const failOut = await emu.invoker.invoke('p1', 'missingFn', {}, {} ).catch((e) => e);
  assert.ok(failOut instanceof Error);

  // integration path: server http wrapper + doc/auth hooks don't crash
  functionsService.deploy('default-project', { name: 'helloHttp', entryPath: 'functions/handlers/helloHttp.js', exportName: 'helloHttp', triggerType: 'http' });
  const srv = app.listen(0);
  const port = srv.address().port;
  const resp = await post(port, '/functions/default-project/helloHttp', { z: 9 });
  assert.equal(resp.status, 200);
  assert.equal(resp.body.result.message, 'hello');
  const tenant = tenants.ensureProject({ organization: 'o1', project: 'p1', environment: 'dev' });
  identity.rotateKeys();
  await identity.signup({ tenant, email: 'phase5@example.com', password: 'password123', ip: '1.1.1.1' });
  docdb.collection('posts').doc('z1').set({ owner: 'u1' });
  srv.close();
});
