const http = require('node:http');
const { app, identity, orgStore, messaging } = require('../server/index');

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
  const server = app.listen(0);
  const port = server.address().port;
  const ORG = 'org_b17'; const PROJECT = 'p17bench';
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'o@x.com', password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'o@x.com', password: 'password1' } });
  const token = JSON.parse(login.text).accessToken;
  const uid = String(identity.verifyAccessToken(token).sub).split(':').pop();
  const org = orgStore.ensureProject(ORG, PROJECT); org.projects[PROJECT].members = [{ uid, role: 'owner' }]; orgStore.save(ORG, org);

  await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/tokens`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { token: 'online1', platform: 'web', appId: 'a1' } });

  const started = Date.now();
  for (let i = 0; i < 5000; i += 1) {
    await req(port, 'POST', `/v1/projects/${PROJECT}/messaging/send`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: { token: 'online1', data: { i: String(i) }, ttlSeconds: 3600 } } });
  }
  for (let i = 0; i < 1000; i += 1) await messaging.processDue(Date.now() + i * 10);
  const ms = Date.now() - started;
  console.log(`phase17 bench enq=5000 proc=1000 durationMs=${ms} opsPerSec=${Math.round(6000 / Math.max(1, ms / 1000))} queueDepth=${messaging.metrics.messaging_queue_depth}`);
  server.close();
})();
