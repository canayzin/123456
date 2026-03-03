const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { app, identity, orgStore } = require('../server/index');
const { signServiceToken } = require('../iam/token');

const ORG_ID = 'org_i14';
const PROJECT_ID = 'p14';

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, path: url, method, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, json });
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

test('phase14 iam + service accounts', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data', 'iam'), { recursive: true, force: true });

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const mkUser = async (email, role) => {
    await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email, password: 'password1' } });
    const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email, password: 'password1' } });
    assert.equal(Boolean(login.json && login.json.accessToken), true);
    const claims = identity.verifyAccessToken(login.json.accessToken);
    assert.equal(Boolean(claims && claims.sub), true);
    ensureMember(String(claims.sub).split(':').pop(), role);
    return login.json.accessToken;
  };

  const owner = await mkUser('owner@x.com', 'owner');
  const editor = await mkUser('editor@x.com', 'editor');
  const viewer = await mkUser('viewer@x.com', 'viewer');

  const quotaOk = await req(port, 'PUT', `/v1/projects/${PROJECT_ID}/quota`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { mode: 'observe' } });
  assert.equal(quotaOk.status, 200);

  const failDenied = await req(port, 'POST', '/__regions/failover', { headers: { authorization: `Bearer ${editor}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { region: 'eu-west' } });
  assert.equal(failDenied.status, 400);
  assert.equal(failDenied.json.error.code, 'PERMISSION_DENIED');

  const syncDenied = await req(port, 'POST', `/v1/projects/${PROJECT_ID}/sync`, { headers: { authorization: `Bearer ${viewer}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { actorId: 'v', ops: [{ collection: 'todos', docId: '1', lamport: 1, wallTime: Date.now(), type: 'setField', field: 'a', value: 1 }] } });
  assert.equal(syncDenied.status, 400);
  assert.equal(syncDenied.json.error.code, 'PERMISSION_DENIED');

  setCustomRole('analyticsViewer', ['analytics.read']);
  const custom = await mkUser('custom@x.com', 'analyticsViewer');
  const usageOk = await req(port, 'GET', `/v1/projects/${PROJECT_ID}/usage`, { headers: { authorization: `Bearer ${custom}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID } });
  assert.equal(usageOk.status, 200);

  setCustomRole('docdbWildcard', ['docdb.*']);
  const wild = await mkUser('wild@x.com', 'docdbWildcard');
  const syncOk = await req(port, 'POST', `/v1/projects/${PROJECT_ID}/sync`, { headers: { authorization: `Bearer ${wild}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { actorId: 'w', ops: [{ collection: 'todos', docId: '2', lamport: 1, wallTime: Date.now(), type: 'setField', field: 'a', value: 2 }] } });
  assert.equal(syncOk.status, 200);

  const saCreate = await req(port, 'POST', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/service-accounts`, { headers: { authorization: `Bearer ${owner}` }, body: { id: 'svc_ci', scopes: ['storage.admin'] } });
  assert.equal(saCreate.status, 201);
  const saKey = await req(port, 'POST', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/service-accounts/svc_ci/key`, { headers: { authorization: `Bearer ${owner}` } });
  assert.equal(saKey.status, 200);

  const saOk = await req(port, 'POST', `/v1/projects/${PROJECT_ID}/buckets`, { headers: { authorization: `Bearer ${saKey.json.token}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { bucketName: 'bktsa1' } });
  assert.equal(saOk.status, 201);

  const saCreate2 = await req(port, 'POST', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/service-accounts`, { headers: { authorization: `Bearer ${owner}` }, body: { id: 'svc_ro', scopes: ['docdb.read'] } });
  assert.equal(saCreate2.status, 201);
  const saKey2 = await req(port, 'POST', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/service-accounts/svc_ro/key`, { headers: { authorization: `Bearer ${owner}` } });
  const saDenied = await req(port, 'POST', `/v1/projects/${PROJECT_ID}/buckets`, { headers: { authorization: `Bearer ${saKey2.json.token}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { bucketName: 'bktsa2' } });
  assert.equal(saDenied.status, 400);
  assert.equal(saDenied.json.error.code, 'PERMISSION_DENIED');

  const expiredToken = signServiceToken({ sub: 'svc_ci', orgId: ORG_ID, projectId: PROJECT_ID, scopes: ['storage.admin'], iat: 1, exp: 2 }, saKey.json.secret);
  const expired = await req(port, 'POST', `/v1/projects/${PROJECT_ID}/buckets`, { headers: { authorization: `Bearer ${expiredToken}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { bucketName: 'bktsa3' } });
  assert.equal(expired.status, 400);

  const badToken = `${saKey.json.token.slice(0, -1)}x`;
  const bad = await req(port, 'POST', `/v1/projects/${PROJECT_ID}/buckets`, { headers: { authorization: `Bearer ${badToken}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { bucketName: 'bktsa4' } });
  assert.equal(bad.status, 400);

  const auditFile = path.join(process.cwd(), 'data', 'iam', 'audit.ndjson');
  assert.equal(fs.existsSync(auditFile), true);
  const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length > 0, true);
});
