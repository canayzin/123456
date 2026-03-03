const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('../src');
const { app, identity, orgStore } = require('../../server/index');

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const txt = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(txt); } catch {} resolve({ status: res.statusCode, json, text: txt }); });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}

async function mkOwner(port, org, project) {
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': org, 'x-project': project }, body: { email: 'sdk-owner@x.com', password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': org, 'x-project': project }, body: { email: 'sdk-owner@x.com', password: 'password1' } });
  const uid = String(identity.verifyAccessToken(login.json.accessToken).sub).split(':').pop();
  const st = orgStore.ensureProject(org, project);
  st.projects[project].members = [{ uid, role: 'owner' }];
  orgStore.save(org, st);
  return login.json.accessToken;
}

test('sdk smoke', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data', 'control'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'analytics'), { recursive: true, force: true });
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const orgId = `org_sdk_${Date.now()}`;
  const projectId = `p_sdk_${Date.now()}`;
  const owner = await mkOwner(port, orgId, projectId);

  await req(port, 'POST', '/v1/orgs', { headers: { authorization: `Bearer ${owner}` }, body: { orgId, name: orgId, plan: 'free' } });
  await req(port, 'POST', `/v1/orgs/${orgId}/projects`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': orgId, 'x-project': projectId }, body: { projectId, name: projectId, environment: 'dev' } });
  const apiKey = await req(port, 'POST', `/v1/projects/${projectId}/apikeys`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': orgId, 'x-project': projectId }, body: { type: 'public' } });
  const secret = apiKey.json.secret;

  await req(port, 'POST', `/v1/orgs/${orgId}/projects/${projectId}/appcheck/apps`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': orgId, 'x-project': projectId }, body: { appId: 'app_1', platform: 'web', provider: 'debug' } });
  await req(port, 'POST', `/v1/orgs/${orgId}/projects/${projectId}/appcheck/debugTokens`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': orgId, 'x-project': projectId }, body: { token: 'dbg_sdk' } });
  await req(port, 'PUT', `/v1/orgs/${orgId}/projects/${projectId}/appcheck/apps/app_1/enforcement`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': orgId, 'x-project': projectId }, body: { serviceKey: 'analytics.ingest', mode: 'off' } });

  await req(port, 'PUT', `/v1/orgs/${orgId}/projects/${projectId}/remoteconfig/template`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': orgId, 'x-project': projectId }, body: { parameters: { title: { defaultValue: { value: 'hello' } } }, conditions: [], minimumFetchIntervalSeconds: 0 } });

  const client = await createClient({ projectId, orgId, apiKey: secret, baseUrl, appId: 'app_1', platform: 'web', deviceId: 'd1', debugAppCheckToken: 'dbg_sdk' });
  t.after(() => client.close());

  await client.auth.signIn('sdk-owner@x.com', 'password1');

  await client.docdb.collection('users').doc('u1').set({ name: 'A', age: 20 });
  const snap = await client.docdb.collection('users').doc('u1').get();
  assert.equal(snap.name, 'A');

  const rc = await client.remoteConfig.fetch({ minimumFetchIntervalSeconds: 0 });
  assert.equal(String(rc.getString('title')).length > 0, true);

  client.analytics.logEvent('screen_view', { screen: 'home' });
  await client.analytics.flush();

  const sum = await req(port, 'GET', `/v1/orgs/${orgId}/projects/${projectId}/analytics/summary?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': orgId, 'x-project': projectId } });
  assert.equal(sum.status, 200);
});
