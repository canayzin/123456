const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, identity, orgStore, appcheck } = require('../server/index');

const ORG = 'org_a19';
const PROJECT = 'p19';

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const txt = Buffer.concat(chunks).toString('utf8'); let json=null; try{json=JSON.parse(txt);}catch{} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}

async function mkUser(port, email, role) {
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email, password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email, password: 'password1' } });
  const uid = String(identity.verifyAccessToken(login.json.accessToken).sub).split(':').pop();
  const org = orgStore.ensureProject(ORG, PROJECT);
  org.projects[PROJECT].members = org.projects[PROJECT].members.filter((x) => x.uid !== uid).concat([{ uid, role }]);
  orgStore.save(ORG, org);
  return login.json.accessToken;
}

test('phase19 appcheck', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data', 'appcheck'), { recursive: true, force: true });
  const server = app.listen(0); t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const owner = await mkUser(port, 'owner@x.com', 'owner');

  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { appId: 'app_1', platform: 'web', provider: 'debug' } });
  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/debugTokens`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'dbg_abc' } });
  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps/app_1/enforcement`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { serviceKey: 'remoteconfig.fetch', mode: 'enforce' } });

  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/remoteconfig/template`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { parameters: { a: { defaultValue: { value: '1' } } }, conditions: [], minimumFetchIntervalSeconds: 0 } });

  const ex = await req(port, 'POST', `/v1/projects/${PROJECT}/appcheck/exchangeDebug`, { body: { appId: 'app_1', debugToken: 'dbg_abc' } });
  assert.equal(ex.status, 200);

  const deniedMissing = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'app_1', platform: 'web', uid: 'u1', client: { minimumFetchIntervalSeconds: 0 } }, headers: { 'x-app-id': 'app_1' } });
  assert.equal(deniedMissing.status, 400);

  const ok = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'app_1', platform: 'web', uid: 'u1', client: { minimumFetchIntervalSeconds: 0 } }, headers: { 'x-app-id': 'app_1', 'x-appcheck': ex.json.token } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'OK');

  const replay = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'app_1', platform: 'web', uid: 'u1', client: { minimumFetchIntervalSeconds: 0 } }, headers: { 'x-app-id': 'app_1', 'x-appcheck': ex.json.token } });
  assert.equal(replay.status, 400);

  const invalid = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'app_1', platform: 'web', uid: 'u1', client: { minimumFetchIntervalSeconds: 0 } }, headers: { 'x-app-id': 'app_1', 'x-appcheck': `${ex.json.token}x` } });
  assert.equal(invalid.status, 400);

  // monitor mode allows
  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps/app_1/enforcement`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { serviceKey: 'remoteconfig.fetch', mode: 'monitor' } });
  const monitorOk = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'app_1', platform: 'web', uid: 'u1', client: { minimumFetchIntervalSeconds: 0 } }, headers: { 'x-app-id': 'app_1' } });
  assert.equal(monitorOk.status, 200);

  // messaging tokens enforce
  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps/app_1/enforcement`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { serviceKey: 'messaging.tokens', mode: 'enforce' } });
  const msgDenied = await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/tokens`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT, 'x-app-id': 'app_1' }, body: { token: 't1', platform: 'web', appId: 'app_1' } });
  assert.equal(msgDenied.status, 400);

  const ex2 = await req(port, 'POST', `/v1/projects/${PROJECT}/appcheck/exchangeDebug`, { body: { appId: 'app_1', debugToken: 'dbg_abc' } });
  const msgOk = await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/tokens`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT, 'x-app-id': 'app_1', 'x-appcheck': ex2.json.token }, body: { token: 't1', platform: 'web', appId: 'app_1' } });
  assert.equal(msgOk.status, 201);

  // storage sign enforce
  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps/app_1/enforcement`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { serviceKey: 'storage.sign', mode: 'enforce' } });
  const signDenied = await req(port, 'POST', `/v1/projects/${PROJECT}/storage/sign`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT, 'x-app-id': 'app_1' }, body: { method: 'GET', bucket: 'b1', key: 'k1' } });
  assert.equal(signDenied.status, 400);

  assert.equal(appcheck.metrics.appcheck_exchange_total > 0, true);
  assert.equal(appcheck.metrics.appcheck_verify_total > 0, true);
});
