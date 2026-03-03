const http = require('node:http');
const { app, identity, orgStore, control } = require('../server/index');

const ORG_ID = 'org_b23';
const PROJECT_ID = 'p23_bench';

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const started = process.hrtime.bigint();
    const r = http.request({ hostname: '127.0.0.1', port, path: url, method, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const durMs = Number(process.hrtime.bigint() - started) / 1e6;
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json, durMs });
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

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'owner-b23@example.com', password: 'password1' } });
    const ownerLogin = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'owner-b23@example.com', password: 'password1' } });
    const ownerToken = ownerLogin.json.accessToken;
    const ownerUid = String(identity.verifyAccessToken(ownerToken).sub).split(':').pop();
    control.createOrg({ orgId: ORG_ID, ownerUid: ownerUid, plan: 'pro' });
    control.createProject({ orgId: ORG_ID, projectId: PROJECT_ID });

    const org = orgStore.ensureProject(ORG_ID, PROJECT_ID);
    org.projects[PROJECT_ID].customRoles.consoleBench = ['console.read'];
    orgStore.save(ORG_ID, org);

    await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'reader-b23@example.com', password: 'password1' } });
    const readerLogin = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG_ID, 'x-project': PROJECT_ID }, body: { email: 'reader-b23@example.com', password: 'password1' } });
    const readerToken = readerLogin.json.accessToken;
    const readerUid = String(identity.verifyAccessToken(readerToken).sub).split(':').pop();
    ensureMember(readerUid, 'consoleBench');

    const headers = { authorization: `Bearer ${readerToken}`, 'x-organization': ORG_ID, 'x-project': PROJECT_ID };
    const urls = [
      `/v1/console/orgs/${ORG_ID}/overview`,
      `/v1/console/projects/${PROJECT_ID}/overview`,
      `/v1/console/projects/${PROJECT_ID}/charts/analytics/events?from=2026-01-10&to=2026-01-10`,
      `/v1/console/orgs/${ORG_ID}/projects?limit=20`,
      `/v1/console/projects/${PROJECT_ID}/apikeys?limit=20`
    ];

    const results = [];
    for (let i = 0; i < 40; i += 1) {
      const url = urls[i % urls.length];
      const r = await req(port, 'GET', url, { headers });
      if (r.status !== 200) throw new Error(`bench request failed: ${url} -> ${r.status}`);
      results.push(r.durMs);
    }

    results.sort((a, b) => a - b);
    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    const p95 = results[Math.floor(results.length * 0.95)];
    const max = results[results.length - 1];
    console.log(JSON.stringify({ phase: 23, requests: results.length, avgMs: Number(avg.toFixed(2)), p95Ms: Number(p95.toFixed(2)), maxMs: Number(max.toFixed(2)) }, null, 2));
  } catch (e) {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})();
