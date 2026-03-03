const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, identity, orgStore } = require('../server/index');

const ORG = 'org_r18';
const PROJECT = 'p18';

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}

async function mkUser(port, email, role) {
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email, password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email, password: 'password1' } });
  const uid = String(identity.verifyAccessToken(login.json.accessToken).sub).split(':').pop();
  const org = orgStore.ensureProject(ORG, PROJECT);
  org.projects[PROJECT].members = org.projects[PROJECT].members.filter((m) => m.uid !== uid).concat([{ uid, role }]);
  orgStore.save(ORG, org);
  return login.json.accessToken;
}

test('phase18 remote config', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data', 'remoteconfig'), { recursive: true, force: true });
  const server = app.listen(0); t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const owner = await mkUser(port, 'owner@x.com', 'owner');
  const viewer = await mkUser(port, 'viewer@x.com', 'viewer');
  const editor = await mkUser(port, 'editor@x.com', 'editor');

  const invalid = await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/remoteconfig/template`, { headers: { authorization: `Bearer ${editor}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { parameters: {}, conditions: [{ name: 'bad', expression: "unknown('x')" }] } });
  assert.equal(invalid.status, 400);

  const tpl = {
    parameters: {
      welcome_text: { defaultValue: { value: 'hello' }, conditionalValues: { cond_ios: { value: 'hello ios' } } },
      feature_x_enabled: { defaultValue: { value: 'false' }, conditionalValues: { cond_rollout_10: { value: 'true' } } }
    },
    conditions: [
      { name: 'cond_ios', expression: "platform == 'ios'" },
      { name: 'cond_rollout_10', expression: "percent(uid, 'feature_x') < 10" }
    ],
    minimumFetchIntervalSeconds: 3600
  };

  const deniedViewer = await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/remoteconfig/template`, { headers: { authorization: `Bearer ${viewer}`, 'x-organization': ORG, 'x-project': PROJECT }, body: tpl });
  assert.equal(deniedViewer.status, 400);

  const pub = await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/remoteconfig/template`, { headers: { authorization: `Bearer ${editor}`, 'x-organization': ORG, 'x-project': PROJECT }, body: tpl });
  assert.equal(pub.status, 200);

  const fIos = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'a1', platform: 'ios', uid: 'u1', country: 'TR', attributes: {}, client: { etag: '', lastFetchAt: 0, minimumFetchIntervalSeconds: 0 } } });
  assert.equal(fIos.status, 200);
  assert.equal(fIos.json.status, 'OK');
  assert.equal(fIos.json.parameters.welcome_text, 'hello ios');

  const fAnd = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'a1', platform: 'android', uid: 'u1', country: 'TR', attributes: {}, client: { etag: '', lastFetchAt: 0, minimumFetchIntervalSeconds: 0 } } });
  assert.equal(fAnd.json.parameters.welcome_text, 'hello');

  const fStable1 = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'a1', platform: 'android', uid: 'same-user', country: 'TR', attributes: {}, client: { etag: '', lastFetchAt: 0, minimumFetchIntervalSeconds: 0 } } });
  const fStable2 = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'a1', platform: 'android', uid: 'same-user', country: 'TR', attributes: {}, client: { etag: '', lastFetchAt: 0, minimumFetchIntervalSeconds: 0 } } });
  assert.equal(fStable1.json.parameters.feature_x_enabled, fStable2.json.parameters.feature_x_enabled);

  const notMod = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'a1', platform: 'android', uid: 'u1', country: 'TR', attributes: {}, client: { etag: pub.json.etag, lastFetchAt: 0, minimumFetchIntervalSeconds: 0 } } });
  assert.equal(notMod.json.status, 'NOT_MODIFIED');

  const throttled = await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { appId: 'a1', platform: 'android', uid: 'u1', country: 'TR', attributes: {}, client: { etag: '', lastFetchAt: Date.now(), minimumFetchIntervalSeconds: 3600 } } });
  assert.equal(throttled.json.status, 'THROTTLED');

  const vers = await req(port, 'GET', `/v1/orgs/${ORG}/projects/${PROJECT}/remoteconfig/versions?limit=10`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(vers.status, 200);

  const rb = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/remoteconfig/rollback`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { version: 1 } });
  assert.equal(rb.status, 200);
  assert.equal(rb.json.version > 1, true);

  // free plan gate params > 50
  const many = { parameters: {}, conditions: [], minimumFetchIntervalSeconds: 60 };
  for (let i = 0; i < 51; i += 1) many.parameters[`k${i}`] = { defaultValue: { value: 'x' } };
  const gate = await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/remoteconfig/template`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: many });
  assert.equal(gate.status, 429);
});
