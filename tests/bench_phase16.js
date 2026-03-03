const http = require('node:http');
const { app, identity, orgStore } = require('../server/index');

function req(port, method, url, { headers = {}, body, rawBody } = {}) {
  return new Promise((resolve, reject) => {
    const payload = rawBody != null ? Buffer.from(rawBody) : (body == null ? null : Buffer.from(JSON.stringify(body)));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-length': payload.length } : {}), ...(rawBody == null && payload ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const ORG = 'org_b16'; const PROJECT = 'p16bench';

  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'owner@x.com', password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'owner@x.com', password: 'password1' } });
  const token = JSON.parse(login.text).accessToken;
  const uid = String(identity.verifyAccessToken(token).sub).split(':').pop();
  const org = orgStore.ensureProject(ORG, PROJECT);
  org.projects[PROJECT].members = [{ uid, role: 'owner' }];
  orgStore.save(ORG, org);

  const d = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/default/deploys`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: 'bench', config: {} } });
  const dep = JSON.parse(d.text);
  for (let i = 0; i < 200; i += 1) {
    await req(port, 'PUT', `/v1/hosting/upload?projectId=${PROJECT}&siteId=default&deployId=${dep.deployId}&path=/assets/f${i}.txt`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT, 'content-type': 'text/plain' }, rawBody: `file-${i}` });
  }
  await req(port, 'PUT', `/v1/hosting/upload?projectId=${PROJECT}&siteId=default&deployId=${dep.deployId}&path=/index.html`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT, 'content-type': 'text/html' }, rawBody: '<html>bench</html>' });
  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/default/deploys/${dep.deployId}/finalize`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { activate: true } });

  const times = [];
  let hit = 0;
  for (let i = 0; i < 1000; i += 1) {
    const t0 = Date.now();
    const r = await req(port, 'GET', '/index.html', { headers: { host: `${PROJECT}.localhost` } });
    times.push(Date.now() - t0);
    if (r.status === 200) hit += 1;
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] || 0;
  const p95 = times[Math.floor(times.length * 0.95)] || 0;
  console.log(`phase16 bench req=1000 ok=${hit} p50Ms=${p50} p95Ms=${p95}`);
  server.close();
})();
