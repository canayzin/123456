const http = require('node:http');
const { app, identity, orgStore } = require('../server/index');

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
  const ORG = `org_b21_${Date.now()}`;
  const PROJECT = `p21_${Date.now()}`;
  const server = app.listen(0); const port = server.address().port;
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'owner21b@x.com', password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email: 'owner21b@x.com', password: 'password1' } });
  const token = JSON.parse(login.text).accessToken;
  const uid = String(identity.verifyAccessToken(token).sub).split(':').pop();
  const st = orgStore.ensureProject(ORG, PROJECT); st.projects[PROJECT].members = [{ uid, role: 'owner' }]; orgStore.save(ORG, st);

  await req(port, 'POST', '/v1/orgs', { headers: { authorization: `Bearer ${token}` }, body: { orgId: ORG, name: ORG } });
  const pStarted = Date.now();
  for (let i = 0; i < 100; i += 1) {
    await req(port, 'POST', `/v1/orgs/${ORG}/projects`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { projectId: `${PROJECT}_${i}`, name: `P${i}`, environment: 'dev' } });
  }
  const projMs = Date.now() - pStarted;

  const kStarted = Date.now();
  for (let i = 0; i < 1000; i += 1) {
    const p = `${PROJECT}_${i % 100}`;
    await req(port, 'POST', `/v1/projects/${p}/apikeys`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { type: 'public' } });
  }
  const keyMs = Date.now() - kStarted;

  const uStarted = Date.now();
  await req(port, 'GET', `/v1/orgs/${ORG}/overview?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, { headers: { authorization: `Bearer ${token}`, 'x-organization': ORG, 'x-project': PROJECT } });
  const usageMs = Date.now() - uStarted;
  const mem = process.memoryUsage();
  console.log(`phase21 bench projects=100 apiKeys=1000 createProjectsMs=${projMs} createKeysMs=${keyMs} usageMs=${usageMs} rssMb=${Math.round(mem.rss / 1024 / 1024)}`);
  server.close();
})();
