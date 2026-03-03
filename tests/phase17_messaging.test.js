const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, identity, orgStore, serviceAccounts, messaging } = require('../server/index');

const ORG = 'org_m17';
const PROJECT = 'p17';

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function mkUser(port, email, role) {
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email, password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email, password: 'password1' } });
  const uid = String(identity.verifyAccessToken(login.json.accessToken).sub).split(':').pop();
  const org = orgStore.ensureProject(ORG, PROJECT);
  org.projects[PROJECT].members = org.projects[PROJECT].members.filter((x) => x.uid !== uid).concat([{ uid, role }]);
  orgStore.save(ORG, org);
  return { token: login.json.accessToken, uid };
}

test('phase17 messaging', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data', 'messaging'), { recursive: true, force: true });
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const owner = await mkUser(port, 'owner@x.com', 'owner');
  const viewer = await mkUser(port, 'viewer@x.com', 'viewer');

  // token register/unregister auth required
  const reg = await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/tokens`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'tok1', platform: 'web', appId: 'a1' } });
  assert.equal(reg.status, 201);
  const unreg = await req(port, 'DELETE', `/v1/projects/${PROJECT}/messaging/tokens/tok1`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(unreg.status, 200);

  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/tokens`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'tok1', platform: 'web', appId: 'a1' } });
  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/topics/news/subscribe`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'tok1' } });
  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/topics/news/unsubscribe`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'tok1' } });
  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/topics/news/subscribe`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'tok1' } });

  // emulate online device delivery channel
  messaging.bindDeviceServer({
    byToken: (projectId, token) => (projectId === PROJECT && token === 'tok1' ? { projectId, token } : null),
    send: (_conn, payload) => { messaging.onDeviceAck(PROJECT, 'tok1', payload.id); }
  });

  const deniedSend = await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/send`, { headers: { authorization: `Bearer ${viewer.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: { token: 'tok1', data: { a: '1' }, ttlSeconds: 3600 } } });
  assert.equal(deniedSend.status, 400);

  const sendOk = await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/send`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: { token: 'tok1', data: { a: '1' }, ttlSeconds: 3600 } } });
  assert.equal(sendOk.status, 200);

  await messaging.processDue(Date.now());
  await messaging.processDue(Date.now() + 10);

  const receipts = await req(port, 'GET', `/v1/projects/${PROJECT}/messaging/receipts`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(receipts.status, 200);
  assert.equal(receipts.json.receipts.some((x) => x.status === 'delivered'), true);

  // offline retry -> dlq
  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/tokens`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'tok_off', platform: 'web', appId: 'a1' } });
  messaging.maxAttempts = 2;
  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/send`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: { token: 'tok_off', data: { z: '1' }, ttlSeconds: 3600 } } });
  await messaging.processDue(Date.now());
  await messaging.processDue(Date.now() + 2000);
  const dlq = await req(port, 'GET', `/v1/projects/${PROJECT}/messaging/dlq`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(dlq.status, 200);
  assert.equal(dlq.json.messages.length > 0, true);

  // topic fanout + ttl expiry
  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/tokens`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'tok2', platform: 'web', appId: 'a1' } });
  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/topics/news/subscribe`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'tok2' } });
  const fan = await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/send`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: { topic: 'news', data: { n: '1' }, ttlSeconds: 3600 } } });
  assert.equal(fan.json.fanoutCount >= 2, true);

  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/send`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: { token: 'tok2', data: { e: '1' }, ttlSeconds: 0 } } });
  await messaging.processDue(Date.now() + 1000);
  const rec2 = await req(port, 'GET', `/v1/projects/${PROJECT}/messaging/receipts`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(rec2.json.receipts.some((x) => x.status === 'expired' || x.status === 'failed'), true);

  // service account with messaging.send
  const sc = serviceAccounts.create(ORG, PROJECT, 'svc_msg', ['messaging.send']);
  assert.equal(Boolean(sc), true);
  const keyRow = serviceAccounts.issueKey(ORG, PROJECT, 'svc_msg');
  const svcSend = await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/send`, { headers: { authorization: `Bearer ${keyRow.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: { token: 'tok2', data: { s: '1' }, ttlSeconds: 3600 } } });
  assert.equal(svcSend.status, 200);

  // free plan cap enforced
  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/billing`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { plan: 'free' } });
  messaging.metrics.messaging_fanout_total = 100000;
  const cap = await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/send`, { headers: { authorization: `Bearer ${owner.token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: { token: 'tok2', data: { c: '1' }, ttlSeconds: 3600 } } });
  assert.equal(cap.status, 429);

  assert.equal(messaging.metrics.messaging_sends_total > 0, true);
});
