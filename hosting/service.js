const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hostingError } = require('./errors');
const { appendAudit } = require('./audit');
const { EdgeCache } = require('./edgeCache');
const { match } = require('./patterns');
const { safeRel, contentTypeFor, sha256File, etagFromHash, writeManifest } = require('./files');
const { appendRelease, readReleases } = require('./releases');
const { createDeploy, getDeploy, saveDeploy } = require('./deploys');
const { canAddCustomDomain } = require('./domains');

class HostingService {
  constructor({ billing, functionsService }) {
    this.billing = billing;
    this.functionsService = functionsService;
    this.edge = new EdgeCache();
    this.metrics = {
      hosting_requests_total: 0,
      hosting_cache_hits_total: 0,
      hosting_cache_misses_total: 0,
      hosting_deploys_total: 0,
      hosting_upload_bytes_total: 0,
      hosting_releases_active_total: 0,
      hosting_rollbacks_total: 0,
      hosting_rewrite_function_total: 0,
      hosting_304_total: 0
    };
  }

  _siteFile(projectId) {
    const dir = path.join(process.cwd(), 'data', 'hosting', 'sites');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${projectId}.json`);
  }

  _readSites(projectId) {
    try { return JSON.parse(fs.readFileSync(this._siteFile(projectId), 'utf8')); }
    catch { return { projectId, sites: [] }; }
  }

  _saveSites(projectId, row) { fs.writeFileSync(this._siteFile(projectId), JSON.stringify(row, null, 2)); }

  ensureSite(projectId, siteId = 'default') {
    const row = this._readSites(projectId);
    let site = row.sites.find((x) => x.siteId === siteId);
    if (!site) {
      site = {
        siteId,
        createdAt: Date.now(),
        activeReleaseId: '',
        domains: [`${projectId}.localhost`],
        config: { cleanUrls: true, trailingSlash: 'ignore', headers: [], redirects: [], rewrites: [] }
      };
      row.sites.push(site);
      this._saveSites(projectId, row);
    }
    return site;
  }

  _plan(projectId, orgId) { return this.billing.ensureProject(projectId, orgId).plan || 'free'; }

  createDeploySession({ orgId, projectId, siteId, actorId, message, config }) {
    const row = this._readSites(projectId);
    const exists = row.sites.some((x) => x.siteId === siteId);
    if (!exists && this._plan(projectId, orgId) === 'free' && row.sites.length >= 1) throw hostingError('RESOURCE_EXHAUSTED', 'Free plan supports 1 site');
    this.ensureSite(projectId, siteId);
    const dep = createDeploy({ projectId, siteId, actor: actorId, message, config });
    const stagingDir = path.join(process.cwd(), 'hosting_artifacts', projectId, siteId, `${dep.releaseId}.staging`);
    fs.mkdirSync(stagingDir, { recursive: true });
    this.metrics.hosting_deploys_total += 1;
    appendAudit({ type: 'hosting.deploy.created', orgId, projectId, siteId, deployId: dep.deployId, releaseId: dep.releaseId, actor: actorId });
    return { deployId: dep.deployId, releaseId: dep.releaseId, uploadUrlBase: '/v1/hosting/upload', configHash: dep.configHash };
  }

  async uploadFile({ req, projectId, siteId, deployId, relPath, contentType, cacheControl, maxFileSize = 20 * 1024 * 1024 }) {
    const dep = getDeploy(deployId);
    if (dep.finalized) throw hostingError('FAILED_PRECONDITION', 'Deploy finalized');
    if (dep.projectId !== projectId || dep.siteId !== siteId) throw hostingError('INVALID_ARGUMENT', 'Deploy scope mismatch');
    const p = safeRel(relPath);
    const stagingDir = path.join(process.cwd(), 'hosting_artifacts', projectId, siteId, `${dep.releaseId}.staging`);
    const file = path.join(stagingDir, p.replace(/^\//, ''));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const out = fs.createWriteStream(file);
    const h = crypto.createHash('sha256');
    let size = 0;
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxFileSize) { reject(hostingError('RESOURCE_EXHAUSTED', 'File too large')); return; }
        h.update(chunk);
      });
      req.pipe(out);
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
    });
    const hash = h.digest('hex');
    const etag = etagFromHash(hash);
    dep.files[p] = { size, contentType: contentType || contentTypeFor(p), cacheControl: cacheControl || '', hash, etag };
    dep.bytesTotal += size;
    saveDeploy(dep);
    this.metrics.hosting_upload_bytes_total += size;
    return { ok: true, path: p, size, etag };
  }

  finalizeDeploy({ orgId, projectId, siteId, deployId, actorId, activate = false }) {
    const dep = getDeploy(deployId);
    if (dep.finalized) throw hostingError('FAILED_PRECONDITION', 'Already finalized');
    const stagingDir = path.join(process.cwd(), 'hosting_artifacts', projectId, siteId, `${dep.releaseId}.staging`);
    const releaseDir = path.join(process.cwd(), 'hosting_artifacts', projectId, siteId, dep.releaseId);
    fs.renameSync(stagingDir, releaseDir);
    const manifestFile = path.join(process.cwd(), 'data', 'hosting', 'files', projectId, siteId, `${dep.releaseId}.json`);
    writeManifest(manifestFile, dep.files);
    dep.finalized = true;
    saveDeploy(dep);
    appendRelease(projectId, siteId, { releaseId: dep.releaseId, ts: Date.now(), actor: actorId, status: 'staged', message: dep.message || '', filesCount: Object.keys(dep.files).length, bytesTotal: dep.bytesTotal, configHash: dep.configHash });
    const row = this._readSites(projectId);
    const site = this.ensureSite(projectId, siteId);
    site.config = dep.config;
    row.sites = row.sites.filter((x) => x.siteId !== siteId).concat([site]);
    this._saveSites(projectId, row);
    appendAudit({ type: 'hosting.deploy.finalized', orgId, projectId, siteId, deployId, releaseId: dep.releaseId, actor: actorId });
    this._pruneReleases(projectId, siteId, orgId);
    if (activate) this.activateRelease({ orgId, projectId, siteId, releaseId: dep.releaseId, actorId });
    return { releaseId: dep.releaseId, status: 'staged' };
  }

  activateRelease({ orgId, projectId, siteId, releaseId, actorId }) {
    const row = this._readSites(projectId);
    const site = this.ensureSite(projectId, siteId);
    site.activeReleaseId = releaseId;
    row.sites = row.sites.filter((x) => x.siteId !== siteId).concat([site]);
    this._saveSites(projectId, row);
    appendRelease(projectId, siteId, { releaseId, ts: Date.now(), actor: actorId, status: 'active', message: 'activated', filesCount: 0, bytesTotal: 0, configHash: '' });
    this.edge.clearProject(projectId);
    this.metrics.hosting_releases_active_total += 1;
    appendAudit({ type: 'hosting.release.activated', orgId, projectId, siteId, releaseId, actor: actorId });
    return { ok: true, activeReleaseId: releaseId };
  }

  rollback({ orgId, projectId, siteId, releaseId, actorId }) {
    this.activateRelease({ orgId, projectId, siteId, releaseId, actorId });
    appendRelease(projectId, siteId, { releaseId, ts: Date.now(), actor: actorId, status: 'rolled_back', message: 'rollback', filesCount: 0, bytesTotal: 0, configHash: '' });
    this.metrics.hosting_rollbacks_total += 1;
    appendAudit({ type: 'hosting.release.rollback', orgId, projectId, siteId, releaseId, actor: actorId });
    return { ok: true, activeReleaseId: releaseId };
  }

  addDomain({ orgId, projectId, siteId, domain, actorId }) {
    const plan = this._plan(projectId, orgId);
    if (!canAddCustomDomain(plan) && !String(domain).endsWith('.localhost')) throw hostingError('PERMISSION_DENIED', 'Custom domains require pro plan');
    const row = this._readSites(projectId);
    const site = this.ensureSite(projectId, siteId);
    site.domains = Array.from(new Set([...(site.domains || []), domain]));
    row.sites = row.sites.filter((x) => x.siteId !== siteId).concat([site]);
    this._saveSites(projectId, row);
    appendAudit({ type: 'hosting.domain.added', orgId, projectId, siteId, domain, actor: actorId });
    return { domains: site.domains };
  }

  _manifest(projectId, siteId, releaseId) {
    const file = path.join(process.cwd(), 'data', 'hosting', 'files', projectId, siteId, `${releaseId}.json`);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }

  _resolveSiteByHost(host) {
    const dir = path.join(process.cwd(), 'data', 'hosting', 'sites');
    if (!fs.existsSync(dir)) return null;
    for (const f of fs.readdirSync(dir)) {
      const projectId = f.replace('.json', '');
      const row = this._readSites(projectId);
      for (const site of row.sites || []) if ((site.domains || []).includes(host)) return { projectId, site };
    }
    return null;
  }

  _maxAge(cacheControl = '') {
    const m = String(cacheControl).match(/max-age=(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  _applyTrailing(pathname, mode) {
    if (mode === 'add' && !pathname.endsWith('/')) return `${pathname}/`;
    if (mode === 'remove' && pathname !== '/' && pathname.endsWith('/')) return pathname.slice(0, -1);
    return pathname;
  }

  async serve(req, res, { requestId }) {
    const host = String(req.headers.host || '').split(':')[0];
    const resolved = this._resolveSiteByHost(host);
    if (!resolved) return false;
    this.metrics.hosting_requests_total += 1;
    const { projectId, site } = resolved;
    const rel = site.activeReleaseId;
    if (!rel) return false;
    const u = new URL(req.url, 'http://localhost');
    let p = u.pathname || '/';

    for (const r of site.config.redirects || []) {
      if (match(r.source, p)) {
        res.writeHead(Number(r.type || 302), { location: r.destination, 'x-request-id': requestId });
        res.end('');
        return true;
      }
    }

    p = this._applyTrailing(p, site.config.trailingSlash || 'ignore');

    let rewriteFn = '';
    let rewriteStatic = '';
    for (const r of site.config.rewrites || []) {
      if (match(r.source, p)) { rewriteFn = r.function || ''; rewriteStatic = r.static || ''; break; }
    }

    if (rewriteFn) {
      this.metrics.hosting_rewrite_function_total += 1;
      const payload = { method: req.method, path: p, query: Object.fromEntries(u.searchParams.entries()) };
      try {
        const out = await this.functionsService.invoker.invoke(projectId, rewriteFn, payload, { auth: null, requestId });
        const body = JSON.stringify(out.result || out.error || {});
        res.writeHead(out.error ? 500 : 200, { 'content-type': 'application/json', 'x-request-id': requestId });
        res.end(body);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json', 'x-request-id': requestId });
        res.end(JSON.stringify({ error: { code: e.code || 'FUNCTION_ERROR', message: e.message } }));
      }
      return true;
    }

    let filePath = rewriteStatic || p;
    if (filePath === '/') filePath = '/index.html';
    const manifest = this._manifest(projectId, site.siteId, rel);
    if (site.config.cleanUrls && !path.posix.extname(filePath)) {
      if (manifest[`${filePath}.html`]) filePath = `${filePath}.html`;
    }
    if (!manifest[filePath]) return false;

    const meta = manifest[filePath];
    const cacheControl = meta.cacheControl || (filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
    const etag = meta.etag;
    if (String(req.headers['if-none-match'] || '') === etag) {
      this.metrics.hosting_304_total += 1;
      res.writeHead(304, { etag, 'cache-control': cacheControl, 'x-request-id': requestId });
      res.end('');
      return true;
    }

    const cached = this.edge.get(host, filePath, etag);
    if (cached) {
      this.metrics.hosting_cache_hits_total += 1;
      res.writeHead(200, cached.headers);
      if (req.method === 'HEAD') { res.end(''); return true; }
      res.end(cached.body);
      return true;
    }
    this.metrics.hosting_cache_misses_total += 1;

    const disk = path.join(process.cwd(), 'hosting_artifacts', projectId, site.siteId, rel, filePath.replace(/^\//, ''));
    const body = fs.readFileSync(disk);
    const headers = { 'content-type': meta.contentType || contentTypeFor(filePath), etag, 'cache-control': cacheControl, 'x-request-id': requestId };
    for (const h of site.config.headers || []) if (match(h.source, filePath)) for (const kv of h.headers || []) headers[String(kv.key).toLowerCase()] = String(kv.value);
    const ttl = this._maxAge(headers['cache-control']);
    if (!String(headers['cache-control']).includes('no-store') && !String(headers['cache-control']).includes('private')) this.edge.set(host, filePath, etag, { headers, body, projectId }, ttl);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(''); return true; }
    res.end(body);
    return true;
  }

  _pruneReleases(projectId, siteId, orgId) {
    const plan = this._plan(projectId, orgId);
    const keep = plan === 'free' ? 3 : 20;
    const rows = readReleases(projectId, siteId);
    const uniq = Array.from(new Set(rows.map((x) => x.releaseId)));
    if (uniq.length <= keep) return;
    const sites = this._readSites(projectId);
    const site = sites.sites.find((x) => x.siteId === siteId) || { activeReleaseId: '' };
    const removable = uniq.filter((id) => id !== site.activeReleaseId).slice(0, Math.max(0, uniq.length - keep));
    for (const rel of removable) {
      fs.rmSync(path.join(process.cwd(), 'hosting_artifacts', projectId, siteId, rel), { recursive: true, force: true });
      fs.rmSync(path.join(process.cwd(), 'data', 'hosting', 'files', projectId, siteId, `${rel}.json`), { force: true });
    }
  }
}

module.exports = { HostingService };
