const http = require('node:http');
const { app, identity, orgStore, analytics } = require('../server/index');

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString('utf8') }));
    });
    r.on('error', reject); if (payload) r.write(payload); r.end();
  });
}

(async () => {
  const ORG = 'org_b20'; const PROJECT = `p20bench_${Date.now()}`;
  const server = app.listen(0); const port = server.address().port;
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'o20@x.com', password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'o20@x.com', password: 'password1' } });
  const token = JSON.parse(login.text).accessToken;
  const uid = String(identity.verifyAccessToken(token).sub).split(':').pop();
  const org = orgStore.ensureProject(ORG, PROJECT); org.projects[PROJECT].members = [{ uid, role: 'owner' }]; orgStore.save(ORG, org);
  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { appId: 'app_1', platform: 'web', provider: 'debug' } });
  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/debugTokens`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'dbg_20' } });
  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps/app_1/enforcement`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { serviceKey: 'analytics.ingest', mode: 'off' } });

  const n = 10000;
  const batch = { appId: 'app_1', platform: 'web', uid: 'u1', deviceId: 'd1', country: 'TR', events: [] };
  for (let i = 0; i < 100; i += 1) batch.events.push({ name: 'screen_view', ts: Date.now() + i, params: { screen: `s${i % 10}` } });

  const started = Date.now();
  for (let i = 0; i < n / 100; i += 1) {
    await req(port, 'POST', `/v1/projects/${PROJECT}/analytics/events`, { headers: { 'x-app-id': 'app_1' }, body: batch });
  }
  const ingestMs = Date.now() - started;
  const aggStarted = Date.now();
  const out = analytics.run(PROJECT);
  const aggMs = Date.now() - aggStarted;
  const mem = process.memoryUsage();
  console.log(`phase20 bench events=${n} ingestMs=${ingestMs} ingestOpsPerSec=${Math.round(n / Math.max(1, ingestMs / 1000))} aggProcessed=${out.processed} aggMs=${aggMs} rssMb=${Math.round(mem.rss / 1024 / 1024)}`);
  server.close();
})();
