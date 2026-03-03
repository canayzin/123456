const fs = require('fs');
const path = require('path');
const { paginate } = require('./pagination.cjs');

function sortTsDesc(a, b) {
  return (Number(b.ts || b.createdAt || 0) - Number(a.ts || a.createdAt || 0)) || String(a.id || a.keyId || a.projectId || '').localeCompare(String(b.id || b.keyId || b.projectId || ''));
}

function projectsList(control, orgId, { status = 'all', limit, cursor }) {
  let rows = control.listProjects(orgId) || [];
  if (status === 'active') rows = rows.filter((x) => x.status !== 'deleted');
  if (status === 'deleted') rows = rows.filter((x) => x.status === 'deleted');
  rows = rows.map((x) => ({ projectId: x.projectId, name: x.name, env: x.environment, status: x.status, createdAt: x.createdAt, lastActivityAt: x.createdAt, plan: control.getOrg(orgId)?.plan || 'free' }));
  rows.sort(sortTsDesc);
  return paginate(rows, { limit, cursor });
}

function apiKeysList(control, projectId, { limit, cursor }) {
  const rows = (control.listApiKeys(projectId) || []).map((x) => ({ keyId: x.keyId, type: x.type, createdAt: x.createdAt, lastUsedAt: x.lastUsedAt, revoked: x.revoked }));
  rows.sort(sortTsDesc);
  return paginate(rows, { limit, cursor });
}

function hostingReleases(projectId, siteId = 'default', { limit, cursor }) {
  const dir = path.join(process.cwd(), 'data', 'hosting', 'sites', projectId, siteId, 'releases');
  let rows = [];
  if (fs.existsSync(dir)) {
    rows = fs.readdirSync(dir).filter((x) => x.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
    }).filter(Boolean).map((x) => ({ releaseId: x.releaseId || x.id || '', ts: x.ts || x.createdAt || 0, status: x.status || 'active', message: x.message || '', filesCount: Number(x.filesCount || 0), bytesTotal: Number(x.bytesTotal || 0) }));
  }
  rows.sort(sortTsDesc);
  return paginate(rows, { limit, cursor });
}

function remoteConfigVersions(remoteconfig, projectId, { limit, cursor }) {
  const rows = (remoteconfig.versions(projectId, 500) || []).map((x) => ({ version: x.version, publishedAt: x.publishedAt || x.ts || 0, publishedBy: x.publishedBy || '', etag: x.etag || '' }));
  rows.sort((a, b) => (Number(b.version) - Number(a.version)));
  return paginate(rows, { limit, cursor });
}

module.exports = { projectsList, apiKeysList, hostingReleases, remoteConfigVersions };
