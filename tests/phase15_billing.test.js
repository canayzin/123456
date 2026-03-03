const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, identity, orgStore, billing, serviceAccounts } = require('../server/index');
const { signServiceToken } = require('../iam/token');

const ORG_ID = 'org_b15';
const PROJECT_ID = 'p15';

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let json=null; try{json=JSON.parse(raw);}catch{} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}

function ensureOwner(uid) {
  const org = orgStore.ensureProject(ORG_ID, PROJECT_ID);
  org.projects[PROJECT_ID].members = org.projects[PROJECT_ID].members.filter((m) => m.uid !== uid).concat([{ uid, role: 'owner' }]);
  orgStore.save(ORG_ID, org);
}

function writeUsage(projectId, n, service='docdb', op='read') {
  const file = path.join(process.cwd(), 'data', 'usage', `${projectId}.ndjson`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let out='';
  for (let i=0;i<n;i+=1) out += `${JSON.stringify({ ts: Date.now(), projectId, service, op, count:1, bytes:0 })}\n`;
  fs.appendFileSync(file, out);
}

test('phase15 billing gates', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data', 'billing'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'data', 'usage'), { recursive: true, force: true });

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'o@x.com', password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'o@x.com', password: 'password1' } });
  assert.equal(Boolean(login.json && login.json.accessToken), true);
  const claims = identity.verifyAccessToken(login.json.accessToken);
  assert.equal(Boolean(claims && claims.sub), true);
  const uid = String(claims.sub).split(':').pop();
  ensureOwner(uid);
  const owner = login.json.accessToken;

  const headers = { authorization: `Bearer ${owner}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID };

  const state = billing.ensureProject(PROJECT_ID, ORG_ID);
  assert.equal(state.plan, 'free');

  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'v@x.com', password: 'password1' } });
  const vlogin = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'v@x.com', password: 'password1' } });
  const badPut = await req(port, 'PUT', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/billing`, { headers: { ...headers, authorization: `Bearer ${vlogin.json.accessToken}` }, body: { plan: 'pro' } });
  assert.equal(badPut.status, 400);

  const setPro = await req(port, 'PUT', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/billing`, { headers, body: { plan: 'pro', budget: { monthlyLimit: 1, alerts: [0.5,0.8,1.0], lastAlerted: {} } } });
  assert.equal(setPro.status, 200);

  writeUsage(PROJECT_ID, 1000, 'docdb', 'read');
  const inv1 = await req(port, 'GET', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/invoice?month=2026-03`, { headers });
  const inv2 = await req(port, 'GET', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/invoice?month=2026-03`, { headers });
  assert.equal(inv1.json.totalCents, inv2.json.totalCents);

  const alerts = await req(port, 'GET', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/billing/alerts?month=2026-03`, { headers });
  assert.equal(Array.isArray(alerts.json.alerts), true);

  const sum = await req(port, 'GET', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/usage/summary?from=2026-03-01&to=2026-03-31`, { headers });
  assert.equal(sum.status, 200);

  const cpFile = path.join(process.cwd(), 'data', 'billing', 'checkpoints', `${PROJECT_ID}.json`);
  const cp1 = JSON.parse(fs.readFileSync(cpFile, 'utf8')).lastByteOffset;
  billing.runAggregation(PROJECT_ID);
  const cp2 = JSON.parse(fs.readFileSync(cpFile, 'utf8')).lastByteOffset;
  assert.equal(cp1, cp2);

  await req(port, 'PUT', `/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/billing`, { headers, body: { plan: 'free' } });
  const st = billing.ensureProject(PROJECT_ID, ORG_ID);
  st.monthState.usage['sync.opsPerMonth'] = 100000;
  billing.projects.save(PROJECT_ID, st);
  const denied = await req(port, 'POST', `/v1/projects/${PROJECT_ID}/sync`, { headers, body: { actorId: 'a', ops: [{ collection: 'c', docId: '1', lamport: 1, wallTime: Date.now(), type: 'setField', field: 'x', value: 1 }] } });
  assert.equal(denied.status, 429);

  serviceAccounts.create(ORG_ID, PROJECT_ID, 'svc1', ['docdb.read']);
  const { secret } = serviceAccounts.issueKey(ORG_ID, PROJECT_ID, 'svc1');
  const now = Math.floor(Date.now()/1000);
  const badSvcToken = signServiceToken({ sub:'svc1', orgId:ORG_ID, projectId:PROJECT_ID, scopes:['docdb.read'], iat:now, exp:now-1 }, secret);
  const badSvc = await req(port, 'POST', `/v1/projects/${PROJECT_ID}/buckets`, { headers: { authorization: `Bearer ${badSvcToken}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { bucketName: 'b1' } });
  assert.equal(badSvc.status, 400);
});
