const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { app, identity, orgStore, remoteconfig, quotaEngine, control } = require('../server/index');

const ORG_ID = 'org_p23';
const PROJECT_ID = 'p23_console';

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({
      hostname: '127.0.0.1',
      port,
      path: url,
      method,
      headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function ensureMember(uid, role) {
  const org = orgStore.ensureProject(ORG_ID, PROJECT_ID);
  const p = org.projects[PROJECT_ID];
  p.members = p.members.filter((m) => m.uid !== uid).concat([{ uid, role }]);
  orgStore.save(ORG_ID, org);
}

function setCustomRole(name, scopes) {
  const org = orgStore.ensureProject(ORG_ID, PROJECT_ID);
  org.projects[PROJECT_ID].customRoles[name] = scopes;
  orgStore.save(ORG_ID, org);
}

function writeNdjson(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((x) => JSON.stringify(x)).join('\n')}\n`);
}

test('phase23 console backend endpoints + iam + redaction + pagination', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data'), { recursive: true, force: true });

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const ownerSignup = await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'owner-p23@example.com', password: 'password1' } });
  assert.equal(ownerSignup.status, 201);
  const ownerLogin = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'owner-p23@example.com', password: 'password1' } });
  assert.equal(ownerLogin.status, 200);
  const ownerToken = ownerLogin.json.accessToken;
  const ownerUid = String(identity.verifyAccessToken(ownerToken).sub).split(':').pop();

  control.createOrg({ orgId: ORG_ID, name: 'Org 23', ownerUid: ownerUid, plan: 'pro' });
  control.createProject({ orgId: ORG_ID, projectId: PROJECT_ID, name: 'Project 23', environment: 'dev' });
  ensureMember(ownerUid, 'owner');

  setCustomRole('consoleReader', ['console.read']);
  setCustomRole('consoleLogs', ['console.read', 'logs.read']);
  setCustomRole('consoleExports', ['console.read', 'exports.read']);

  const mkUser = async (email, role, addMember = true) => {
    const s = await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email, password: 'password1' } });
    assert.equal(s.status, 201);
    const l = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email, password: 'password1' } });
    assert.equal(l.status, 200);
    const uid = String(identity.verifyAccessToken(l.json.accessToken).sub).split(':').pop();
    if (addMember) ensureMember(uid, role);
    return l.json.accessToken;
  };

  const readerToken = await mkUser('reader-p23@example.com', 'consoleReader');
  const logsToken = await mkUser('logs-p23@example.com', 'consoleLogs');
  const exportsToken = await mkUser('exports-p23@example.com', 'consoleExports');
  const outsiderToken = await mkUser('outsider-p23@example.com', 'consoleReader', false);

  const h = (token) => ({ authorization: `Bearer ${token}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID });

  const keyCreate = await req(port, 'POST', `/v1/projects/${PROJECT_ID}/apikeys`, { headers: h(ownerToken), body: { type: 'server', scopes: ['docdb.read'] } });
  assert.equal(keyCreate.status, 201);
  assert.equal(Boolean(keyCreate.json.secret && keyCreate.json.secret.startsWith('sk_live_')), true);

  fs.mkdirSync(path.join(process.cwd(), 'data', 'hosting', 'sites', PROJECT_ID, 'default', 'releases'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'data', 'hosting', 'sites', PROJECT_ID, 'default', 'releases', 'r1.json'), JSON.stringify({ releaseId: 'r1', ts: 1700000000000, status: 'active', filesCount: 2, bytesTotal: 25 }));

  remoteconfig.publish(PROJECT_ID, ORG_ID, 'owner', { conditions: [], parameters: { flagA: { defaultValue: { value: 'true' } } } });

  const receipts = [];
  for (let i = 0; i < 210; i += 1) receipts.push({ ts: 1000 + i, id: `id_${String(i).padStart(3, '0')}`, status: 'delivered' });
  receipts.push({ ts: 5000, id: 'b' }, { ts: 5000, id: 'a' });
  writeNdjson(path.join(process.cwd(), 'data', 'messaging', 'receipts', `${PROJECT_ID}.ndjson`), receipts);
  writeNdjson(path.join(process.cwd(), 'data', 'messaging', 'dlq', `${PROJECT_ID}.ndjson`), [{ ts: 1, id: 'd1', reason: 'OFFLINE' }]);
  writeNdjson(path.join(process.cwd(), 'data', 'appcheck', 'audit.ndjson'), [{ ts: 1, projectId: PROJECT_ID, type: 'verify.deny', appId: 'app1' }]);

  writeNdjson(path.join(process.cwd(), 'data', 'audit.log'), [{ ts: 1700000010000, projectId: PROJECT_ID, type: 'audit', requestId: 'r1', details: { email: 'leak@example.com', token: 'sk_live_abc123' } }]);

  quotaEngine.meter({ projectId: PROJECT_ID, service: 'storage', op: 'writeBytes', count: 1, bytes: 12, uid: 'mail@example.com' });

  writeNdjson(path.join(process.cwd(), 'data', 'analytics', 'events', PROJECT_ID, '2026-01-10.ndjson'), [{ ts: 1, ev: 'open', email: 'person@example.com', token: 'pk_live_secret123' }]);
  fs.mkdirSync(path.join(process.cwd(), 'data', 'billing', 'invoices', PROJECT_ID), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'data', 'billing', 'invoices', PROJECT_ID, '2026-01.json'), JSON.stringify({ month: '2026-01', customerEmail: 'bill@example.com', cardToken: 'sk_live_zzz' }));

  const overviewOrg = await req(port, 'GET', `/v1/console/orgs/${ORG_ID}/overview?from=2026-01-10&to=2026-01-10`, { headers: h(readerToken) });
  assert.equal(overviewOrg.status, 200);
  const overviewProject = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/overview?from=2026-01-10&to=2026-01-10`, { headers: h(readerToken) });
  assert.equal(overviewProject.status, 200);

  const charts = [
    `/v1/console/projects/${PROJECT_ID}/charts/analytics/events?from=2026-01-10&to=2026-01-10`,
    `/v1/console/projects/${PROJECT_ID}/charts/messaging?from=2026-01-10&to=2026-01-10`,
    `/v1/console/projects/${PROJECT_ID}/charts/storage?from=2026-01-10&to=2026-01-10`,
    `/v1/console/projects/${PROJECT_ID}/charts/billing?from=2026-01-10&to=2026-01-10`
  ];
  for (const url of charts) {
    const r = await req(port, 'GET', url, { headers: h(readerToken) });
    assert.equal(r.status, 200);
    assert.equal(Array.isArray(r.json.series), true);
  }

  const orgProjects = await req(port, 'GET', `/v1/console/orgs/${ORG_ID}/projects?status=all&limit=10`, { headers: h(readerToken) });
  assert.equal(orgProjects.status, 200);
  assert.equal(Array.isArray(orgProjects.json.items), true);

  const keysList = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/apikeys`, { headers: h(readerToken) });
  assert.equal(keysList.status, 200);
  assert.equal(Boolean(keysList.json.items[0].secret), false);
  assert.equal(Boolean(keysList.json.items[0].keyHash), false);

  const relList = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/hosting/releases?siteId=default`, { headers: h(readerToken) });
  assert.equal(relList.status, 200);
  const rcVersions = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/remoteconfig/versions`, { headers: h(readerToken) });
  assert.equal(rcVersions.status, 200);

  const receiptsPage1 = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/messaging/receipts?limit=500`, { headers: h(logsToken) });
  assert.equal(receiptsPage1.status, 200);
  assert.equal(receiptsPage1.json.items.length, 200);
  assert.equal(Boolean(receiptsPage1.json.nextCursor), true);
  const sameTs = receiptsPage1.json.items.filter((x) => Number(x.ts) === 5000);
  assert.deepEqual(sameTs.map((x) => x.id), ['a', 'b']);
  const receiptsPage2 = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/messaging/receipts?limit=50&cursor=${encodeURIComponent(receiptsPage1.json.nextCursor)}`, { headers: h(logsToken) });
  assert.equal(receiptsPage2.status, 200);
  assert.equal(receiptsPage2.json.items.length > 0, true);

  const dlq = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/messaging/dlq`, { headers: h(logsToken) });
  assert.equal(dlq.status, 200);
  const denies = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/appcheck/denies`, { headers: h(logsToken) });
  assert.equal(denies.status, 200);

  const logsDenied = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/logs?type=audit&from=0&to=9999999999999&limit=10`, { headers: h(readerToken) });
  assert.equal(logsDenied.status, 400);
  assert.equal(logsDenied.json.error.code, 'PERMISSION_DENIED');
  const logsOk = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/logs?type=audit&from=0&to=9999999999999&limit=10`, { headers: h(logsToken) });
  assert.equal(logsOk.status, 200);
  const logsRaw = JSON.stringify(logsOk.json);
  assert.equal(logsRaw.includes('sk_live_'), false);
  assert.equal(logsRaw.includes('example.com'), false);

  const exportsDenied = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/exports/usage?from=0&to=9999999999999&format=json`, { headers: h(readerToken) });
  assert.equal(exportsDenied.status, 400);
  assert.equal(exportsDenied.json.error.code, 'PERMISSION_DENIED');

  const usageExport = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/exports/usage?from=0&to=9999999999999&format=json`, { headers: h(exportsToken) });
  assert.equal(usageExport.status, 200);
  assert.equal(usageExport.raw.includes('example.com'), false);

  const analyticsExport = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/exports/analytics?date=2026-01-10&format=ndjson`, { headers: h(exportsToken) });
  assert.equal(analyticsExport.status, 200);
  assert.equal(analyticsExport.raw.includes('pk_live_'), false);
  assert.equal(analyticsExport.raw.includes('example.com'), false);

  const invoicesExport = await req(port, 'GET', `/v1/console/projects/${PROJECT_ID}/exports/invoices?month=2026-01&format=json`, { headers: h(exportsToken) });
  assert.equal(invoicesExport.status, 200);
  assert.equal(invoicesExport.raw.includes('sk_live_'), false);
  assert.equal(invoicesExport.raw.includes('example.com'), false);

  const outsider = await req(port, 'GET', `/v1/console/orgs/${ORG_ID}/overview`, { headers: h(outsiderToken) });
  assert.equal(outsider.status, 400);
  assert.equal(outsider.json.error.code, 'PERMISSION_DENIED');
});
