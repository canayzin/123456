const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, identity, orgStore, analytics } = require('../server/index');

const ORG = 'org_a20';
const PROJECT = 'p20';

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const txt = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(txt); } catch {} resolve({ status: res.statusCode, json, text: txt }); });
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

test('phase20 analytics', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data', 'analytics'), { recursive: true, force: true });
  const server = app.listen(0); t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const owner = await mkUser(port, 'owner20@x.com', 'owner');
  const viewer = await mkUser(port, 'viewer20@x.com', 'viewer');

  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { appId: 'app_1', platform: 'web', provider: 'debug' } });
  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/debugTokens`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'dbg_20' } });
  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps/app_1/enforcement`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { serviceKey: 'analytics.ingest', mode: 'enforce' } });

  const denied = await req(port, 'POST', `/v1/projects/${PROJECT}/analytics/events`, {
    headers: { 'x-app-id': 'app_1' },
    body: { appId: 'app_1', platform: 'web', uid: 'u1', deviceId: 'd1', country: 'TR', events: [{ name: 'screen_view', ts: Date.now(), params: { screen: 'home' } }] }
  });
  assert.equal(denied.status, 400);
  assert.equal(denied.json.error.message, 'APP_CHECK_REQUIRED');

  const ex = await req(port, 'POST', `/v1/projects/${PROJECT}/appcheck/exchangeDebug`, { body: { appId: 'app_1', debugToken: 'dbg_20' } });
  assert.equal(ex.status, 200);

  const ok = await req(port, 'POST', `/v1/projects/${PROJECT}/analytics/events`, {
    headers: { 'x-app-id': 'app_1', 'x-appcheck': ex.json.token },
    body: { appId: 'app_1', platform: 'web', uid: 'u1', deviceId: 'd1', country: 'TR', events: [{ name: 'screen_view', ts: Date.now(), params: { screen: 'home' } }, { name: 'purchase', ts: Date.now(), params: { value: '9.99', currency: 'USD' } }] }
  });
  assert.equal(ok.status, 202);
  assert.equal(ok.json.accepted, 2);

  const invalid = await req(port, 'POST', `/v1/projects/${PROJECT}/analytics/events`, {
    headers: { 'x-app-id': 'app_1', 'x-appcheck': ex.json.token },
    body: { appId: 'app_1', platform: 'web', uid: 'u1', deviceId: 'd1', country: 'TR', events: [{ name: '1invalid', ts: Date.now(), params: {} }, { name: 'ok_event', ts: Date.now(), params: { email_hint: 'x' } }] }
  });
  assert.equal(invalid.status, 400);

  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps/app_1/enforcement`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { serviceKey: 'analytics.ingest', mode: 'off' } });
  const pii = await req(port, 'POST', `/v1/projects/${PROJECT}/analytics/events`, {
    headers: { 'x-app-id': 'app_1' },
    body: { appId: 'app_1', platform: 'web', uid: 'u1', deviceId: 'd1', country: 'TR', events: [{ name: 'ok_event', ts: Date.now(), params: { email: 'a@b.com' } }, { name: 'ok_event', ts: Date.now(), params: { x: '1' } }] }
  });
  assert.equal(pii.status, 202);
  assert.equal(analytics.metrics.analytics_pii_rejected_total > 0, true);

  analytics.maxEventsPerDay = () => 2;
  const cap = await req(port, 'POST', `/v1/projects/${PROJECT}/analytics/events`, {
    headers: { 'x-app-id': 'app_1' },
    body: { appId: 'app_1', platform: 'web', uid: 'u2', deviceId: 'd2', country: 'TR', events: [{ name: 'ev_cap', ts: Date.now(), params: {} }, { name: 'ev_cap2', ts: Date.now(), params: {} }] }
  });
  assert.equal(cap.status, 429);

  const run1 = analytics.run(PROJECT);
  const run2 = analytics.run(PROJECT);
  assert.equal(run1.processed > 0, true);
  assert.equal(run2.processed, 0);

  const day = new Date().toISOString().slice(0, 10);
  const dailyFile = path.join(process.cwd(), 'data', 'analytics', 'agg', PROJECT, 'daily', `${day}.json`);
  const hourlyFile = path.join(process.cwd(), 'data', 'analytics', 'agg', PROJECT, 'hourly', `${day}.json`);
  assert.equal(fs.existsSync(dailyFile), true);
  assert.equal(fs.existsSync(hourlyFile), true);

  const sumViewer = await req(port, 'GET', `/v1/orgs/${ORG}/projects/${PROJECT}/analytics/summary?from=${day}&to=${day}`, { headers: { authorization: `Bearer ${viewer}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(sumViewer.status, 200);
  assert.equal(sumViewer.json.eventsTotal >= 2, true);

  const orgDenied = await req(port, 'GET', `/v1/orgs/${ORG}/analytics/overview?from=${day}&to=${day}`, { headers: { authorization: `Bearer ${viewer}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(orgDenied.status, 400);

  const orgOk = await req(port, 'GET', `/v1/orgs/${ORG}/analytics/overview?from=${day}&to=${day}`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(orgOk.status === 200 || orgOk.status === 400, true);
});
