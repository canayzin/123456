const http = require('node:http');
const { app, identity, orgStore } = require('../server/index');

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}

(async () => {
  const ORG = 'org_b18'; const PROJECT = 'p18bench';
  const server = app.listen(0); const port = server.address().port;
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'o@x.com', password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'o@x.com', password: 'password1' } });
  const token = JSON.parse(login.text).accessToken;
  const uid = String(identity.verifyAccessToken(token).sub).split(':').pop();
  const org = orgStore.ensureProject(ORG, PROJECT); org.projects[PROJECT].members = [{ uid, role: 'owner' }]; orgStore.save(ORG, org);
  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/remoteconfig/template`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { parameters: { a: { defaultValue: { value: '1' } } }, conditions: [], minimumFetchIntervalSeconds: 0 } });

  const n = 10000; const times = []; const start = Date.now();
  for (let i = 0; i < n; i += 1) {
    const t0 = Date.now();
    await req(port, 'POST', `/v1/projects/${PROJECT}/remoteconfig/fetch`, { body: { platform: 'web', uid: `u${i}`, client: { etag: '', lastFetchAt: 0, minimumFetchIntervalSeconds: 0 } } });
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(n * 0.95)] || 0;
  const ms = Date.now() - start;
  console.log(`phase18 bench n=${n} durationMs=${ms} opsPerSec=${Math.round(n / Math.max(1, ms / 1000))} p95Ms=${p95}`);
  server.close();
})();
