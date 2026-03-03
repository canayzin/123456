const http = require('node:http');
const { app, identity, orgStore, appcheck } = require('../server/index');

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
  const ORG = 'org_b19'; const PROJECT = 'p19bench';
  const server = app.listen(0); const port = server.address().port;
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'o@x.com', password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'o@x.com', password: 'password1' } });
  const token = JSON.parse(login.text).accessToken;
  const uid = String(identity.verifyAccessToken(token).sub).split(':').pop();
  const org = orgStore.ensureProject(ORG, PROJECT); org.projects[PROJECT].members = [{ uid, role: 'owner' }]; orgStore.save(ORG, org);
  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/apps`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { appId: 'app_1', platform: 'web', provider: 'debug' } });
  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/appcheck/debugTokens`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'dbg_abc' } });
  const n = 50000; const started = Date.now();
  for (let i = 0; i < n; i += 1) {
    const ex = await req(port, 'POST', `/v1/projects/${PROJECT}/appcheck/exchangeDebug`, { body: { appId: 'app_1', debugToken: 'dbg_abc' } });
    const tok = JSON.parse(ex.text).token;
    appcheck.verifyForService({ headers: { 'x-app-id': 'app_1', 'x-appcheck': tok } }, { projectId: PROJECT, serviceKey: 'remoteconfig.fetch' });
  }
  const ms = Date.now() - started;
  const mem = process.memoryUsage();
  console.log(`phase19 bench verify=${n} durationMs=${ms} opsPerSec=${Math.round(n / Math.max(1, ms / 1000))} rssMb=${Math.round(mem.rss/1024/1024)}`);
  server.close();
})();
