const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, identity, orgStore, hosting, functionsService } = require('../server/index');

const ORG = 'org_h16';
const PROJECT = 'p16';
const SITE = 'default';

function req(port, method, url, { headers = {}, body, rawBody } = {}) {
  return new Promise((resolve, reject) => {
    const payload = rawBody != null ? Buffer.from(rawBody) : (body == null ? null : Buffer.from(JSON.stringify(body)));
    const r = http.request({ hostname: '127.0.0.1', port, method, path: url, headers: { ...headers, ...(payload ? { 'content-length': payload.length } : {}), ...(rawBody == null && payload ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function mkUser(port, email, role) {
  await req(port, 'POST', '/auth/signup', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email, password: 'password1' } });
  const login = await req(port, 'POST', '/auth/login', { headers: { 'x-organization': ORG, 'x-project': PROJECT }, body: { email, password: 'password1' } });
  const claims = identity.verifyAccessToken(login.json.accessToken);
  const uid = String(claims.sub).split(':').pop();
  const org = orgStore.ensureProject(ORG, PROJECT);
  org.projects[PROJECT].members = org.projects[PROJECT].members.filter((x) => x.uid !== uid).concat([{ uid, role }]);
  orgStore.save(ORG, org);
  return login.json.accessToken;
}

test('phase16 hosting engine', async (t) => {
  fs.rmSync(path.join(process.cwd(), 'data', 'hosting'), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), 'hosting_artifacts'), { recursive: true, force: true });
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const viewer = await mkUser(port, 'viewer@x.com', 'viewer');
  const owner = await mkUser(port, 'owner@x.com', 'owner');

  const denied = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/deploys`, { headers: { authorization: `Bearer ${viewer}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: 'x', config: {} } });
  assert.equal(denied.status, 400);

  const create = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/deploys`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: 'r1', config: { cleanUrls: true, trailingSlash: 'remove', redirects: [{ source: '/old', destination: '/new', type: 301 }], headers: [{ source: '/assets/**', headers: [{ key: 'Cache-Control', value: 'public, max-age=120' }] }], rewrites: [{ source: '/app/**', static: '/index.html' }, { source: '/api/**', function: 'helloHttp' }] } } });
  assert.equal(create.status, 201);

  const deployId = create.json.deployId;
  const release1 = create.json.releaseId;

  await req(port, 'PUT', `/v1/hosting/upload?projectId=${PROJECT}&siteId=${SITE}&deployId=${deployId}&path=/index.html`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT, 'content-type': 'text/html' }, rawBody: '<html>v1</html>' });
  await req(port, 'PUT', `/v1/hosting/upload?projectId=${PROJECT}&siteId=${SITE}&deployId=${deployId}&path=/about.html`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT, 'content-type': 'text/html' }, rawBody: '<html>about</html>' });
  await req(port, 'PUT', `/v1/hosting/upload?projectId=${PROJECT}&siteId=${SITE}&deployId=${deployId}&path=/assets/app.js`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT, 'content-type': 'application/javascript' }, rawBody: 'console.log(1);' });

  const fin = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/deploys/${deployId}/finalize`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { activate: true } });
  assert.equal(fin.status, 200);

  const fdep = functionsService.deploy(PROJECT, { name: 'helloHttp', entryPath: 'functions/handlers/helloHttp.js', exportName: 'helloHttp', triggerType: 'http' });
  assert.equal(Boolean(fdep && fdep.version), true);

  const h1 = await req(port, 'GET', '/index.html', { headers: { host: `${PROJECT}.localhost` } });
  assert.equal(h1.status, 200);
  assert.equal(h1.text.includes('v1'), true);

  const clean = await req(port, 'GET', '/about', { headers: { host: `${PROJECT}.localhost` } });
  assert.equal(clean.status, 200);

  const redir = await req(port, 'GET', '/old', { headers: { host: `${PROJECT}.localhost` } });
  assert.equal(redir.status, 301);

  const hdr = await req(port, 'GET', '/assets/app.js', { headers: { host: `${PROJECT}.localhost` } });
  assert.equal(String(hdr.headers['cache-control']).includes('max-age=120'), true);

  const rwStatic = await req(port, 'GET', '/app/home', { headers: { host: `${PROJECT}.localhost` } });
  assert.equal(rwStatic.status, 200);
  assert.equal(rwStatic.text.includes('v1'), true);

  const rwFn = await req(port, 'GET', '/api/hello', { headers: { host: `${PROJECT}.localhost` } });
  assert.equal(rwFn.status, 200);
  assert.equal(rwFn.text.includes('hello'), true);

  const et = await req(port, 'GET', '/index.html', { headers: { host: `${PROJECT}.localhost` } });
  const notMod = await req(port, 'GET', '/index.html', { headers: { host: `${PROJECT}.localhost`, 'if-none-match': et.headers.etag } });
  assert.equal(notMod.status, 304);

  const beforeHits = hosting.metrics.hosting_cache_hits_total;
  await req(port, 'GET', '/assets/app.js', { headers: { host: `${PROJECT}.localhost` } });
  await req(port, 'GET', '/assets/app.js', { headers: { host: `${PROJECT}.localhost` } });
  assert.equal(hosting.metrics.hosting_cache_hits_total > beforeHits, true);

  const c2 = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/deploys`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: 'r2', config: { cleanUrls: true, rewrites: [{ source: '**', static: '/index.html' }] } } });
  await req(port, 'PUT', `/v1/hosting/upload?projectId=${PROJECT}&siteId=${SITE}&deployId=${c2.json.deployId}&path=/index.html`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT, 'content-type': 'text/html' }, rawBody: '<html>v2</html>' });
  const fin2 = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/deploys/${c2.json.deployId}/finalize`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { activate: false } });
  assert.equal(fin2.status, 200);
  const act2 = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/releases/${c2.json.releaseId}/activate`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: {} });
  assert.equal(act2.status, 200);

  const st2 = await req(port, 'GET', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/status`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(st2.status, 200);
  assert.equal(st2.json.activeReleaseId, c2.json.releaseId);

  await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/releases/${release1}/rollback`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: {} });
  const st1 = await req(port, 'GET', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/status`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT } });
  assert.equal(st1.json.activeReleaseId, release1);

  // free retention prune
  for (let i = 0; i < 3; i += 1) {
    const cx = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/deploys`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { message: `r${i + 3}`, config: {} } });
    await req(port, 'PUT', `/v1/hosting/upload?projectId=${PROJECT}&siteId=${SITE}&deployId=${cx.json.deployId}&path=/index.html`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT, 'content-type': 'text/html' }, rawBody: `<html>x${i}</html>` });
    await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/deploys/${cx.json.deployId}/finalize`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { activate: true } });
  }
  const artifactDir = path.join(process.cwd(), 'hosting_artifacts', PROJECT, SITE);
  const dirs = fs.existsSync(artifactDir) ? fs.readdirSync(artifactDir).filter((x) => !x.endsWith('.staging')) : [];
  assert.equal(dirs.length <= 3, true);

  const freeDomainDenied = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/domains`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { domain: 'example.com' } });
  assert.equal(freeDomainDenied.status, 400);

  await req(port, 'PUT', `/v1/orgs/${ORG}/projects/${PROJECT}/billing`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { plan: 'pro' } });
  const proDomainOk = await req(port, 'POST', `/v1/orgs/${ORG}/projects/${PROJECT}/hosting/sites/${SITE}/domains`, { headers: { authorization: `Bearer ${owner}`, 'x-organization': ORG, 'x-project': PROJECT }, body: { domain: 'example.com' } });
  assert.equal(proDomainOk.status, 200);
});
