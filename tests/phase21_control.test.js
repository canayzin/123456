const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, identity, orgStore } = require('../server/index');

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const txt = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(txt); } catch {} resolve({ status: res.statusCode, json, text: txt }); });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}

async function mkUser(port, org, project, email, role) {
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': org, 'x-project': project }, body: { email, password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': org, 'x-project': project }, body: { email, password: 'password1' } });
  const uid = String(identity.verifyAccessToken(login.json.accessToken).sub).split(':').pop();
  const st = orgStore.ensureProject(org, project);
  st.projects[project].members = st.projects[project].members.filter((x) => x.uid !== uid).concat([{ uid, role }]);
  orgStore.save(org, st);
  return login.json.accessToken;
}

test('phase21 control plane', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data', 'control'), { recursive: true, force: true });
  const server = app.listen(0); t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const ORG = 'org_c21';
  const PROJECT = 'p21';

  const owner = await mkUser(port, ORG, PROJECT, 'owner21@x.com', 'owner');
  const viewer = await mkUser(port, ORG, PROJECT, 'viewer21@x.com', 'viewer');

  const orgCreate = await req(port, 'POST', '/v1/orgs', { body: { orgId: ORG, name: 'Org 21', plan: 'free' }, headers: { authorization: `Bearer ${owner}` } });
  assert.equal(orgCreate.status, 201);

  const projectCreate = await req(port, 'POST', `/v1/orgs/${ORG}/projects`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { projectId: PROJECT, name: 'Project 21', environment: 'dev' } });
  assert.equal(projectCreate.status === 201 || projectCreate.status === 400, true);

  const projectGet = await req(port, 'GET', `/v1/projects/${PROJECT}`);
  assert.equal(projectGet.status, 200);

  const keyCreate = await req(port, 'POST', `/v1/projects/${PROJECT}/apikeys`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { type: 'public', scopes: ['analytics.ingest'] } });
  assert.equal(keyCreate.status, 201);
  assert.equal(String(keyCreate.json.secret || '').startsWith('pk_live_'), true);

  const projectFile = path.join(process.cwd(), 'data', 'control', 'projects', `${PROJECT}.json`);
  const saved = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  assert.equal(Boolean(saved.apiKeys[0].keyHash), true);
  assert.equal(Boolean(saved.apiKeys[0].secret), false);

  const pub = await req(port, 'GET', `/v1/projects/${PROJECT}/public-config`);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.projectId, PROJECT);
  assert.equal(Boolean(pub.json.endpoints.analytics), true);

  const del = await req(port, 'DELETE', `/v1/projects/${PROJECT}`);
  assert.equal(del.status, 200);

  const ingestBlocked = await req(port, 'POST', `/v1/projects/${PROJECT}/analytics/events`, {
    headers: { 'x-app-id': 'a1' },
    body: { appId: 'a1', platform: 'web', uid: 'u1', deviceId: 'd1', country: 'TR', events: [{ name: 'screen_view', ts: Date.now(), params: { s: '1' } }] }
  });
  assert.equal(ingestBlocked.status, 400);

  const restore = await req(port, 'POST', `/v1/projects/${PROJECT}/restore`);
  assert.equal(restore.status, 200);

  const plan = await req(port, 'PUT', `/v1/orgs/${ORG}/plan`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { plan: 'pro' } });
  assert.equal(plan.status, 200);

  await req(port, 'POST', `/v1/projects/${PROJECT}/analytics/events`, {
    headers: { 'x-app-id': 'a1', 'x-api-key': keyCreate.json.secret },
    body: { appId: 'a1', platform: 'web', uid: 'u1', deviceId: 'd1', country: 'TR', events: [{ name: 'screen_view', ts: Date.now(), params: { s: '1' } }] }
  });

  const usage = await req(port, 'GET', `/v1/orgs/${ORG}/projects/${PROJECT}/usage?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(usage.status === 200 || usage.status === 400, true);
  if (usage.status === 200) assert.equal(Boolean(usage.json.analytics), true);

  const overviewViewer = await req(port, 'GET', `/v1/orgs/${ORG}/overview?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, { headers: { authorization: `Bearer ${viewer}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(overviewViewer.status === 200 || overviewViewer.status === 400, true);

  const revoke = await req(port, 'DELETE', `/v1/projects/${PROJECT}/apikeys/${keyCreate.json.keyId}`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(revoke.status, 200);

  const revokedDenied = await req(port, 'POST', `/v1/projects/${PROJECT}/analytics/events`, {
    headers: { 'x-app-id': 'a1', 'x-api-key': keyCreate.json.secret },
    body: { appId: 'a1', platform: 'web', uid: 'u1', deviceId: 'd1', country: 'TR', events: [{ name: 'screen_view', ts: Date.now(), params: { s: '1' } }] }
  });
  assert.equal(revokedDenied.status, 400);
});
