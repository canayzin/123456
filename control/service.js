const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OrgsStore } = require('./orgs');
const { ProjectsStore } = require('./projects');
const { createKey } = require('./apikeys');
const { normalizePlan } = require('./plans');
const { buildPublicConfig } = require('./publicConfig');
const { UsageService } = require('./usage');
const { appendAudit } = require('./audit');
const { createMetrics } = require('./metrics');

class ControlPlaneService {
  constructor({ billing, analytics, messaging, quota, appcheck }) {
    this.orgs = new OrgsStore();
    this.projects = new ProjectsStore();
    this.billing = billing;
    this.analytics = analytics;
    this.messaging = messaging;
    this.quota = quota;
    this.appcheck = appcheck;
    this.metrics = createMetrics();
    this.usage = new UsageService({ billing, analytics, messaging, quota, projectsStore: this.projects });
  }

  createOrg({ orgId, name, ownerUid, plan }) {
    const row = { orgId, name: name || orgId, ownerUid: ownerUid || '', plan: normalizePlan(plan), status: 'active', createdAt: Date.now() };
    this.orgs.save(orgId, row);
    this.metrics.control_orgs_total += 1;
    appendAudit({ type: 'org.create', orgId, ownerUid: row.ownerUid });
    return row;
  }

  getOrg(orgId) { return this.orgs.get(orgId); }

  setOrgPlan(orgId, plan, actor = 'system') {
    const row = this.orgs.get(orgId);
    if (!row) return null;
    row.plan = normalizePlan(plan);
    this.orgs.save(orgId, row);
    this.metrics.control_plan_changes_total += 1;
    appendAudit({ type: 'plan.change', orgId, plan: row.plan, actor });
    return row;
  }

  deleteOrg(orgId) {
    const row = this.orgs.get(orgId);
    if (!row) return null;
    row.status = 'suspended';
    this.orgs.save(orgId, row);
    const ps = this.projects.listByOrg(orgId);
    for (const p of ps) this.deleteProject(p.projectId);
    this.metrics.control_soft_deletes_total += 1;
    return row;
  }

  initProjectRoots(projectId) {
    fs.mkdirSync(path.join(process.cwd(), 'data', 'analytics', 'events', projectId), { recursive: true });
    fs.mkdirSync(path.join(process.cwd(), 'data', 'messaging'), { recursive: true });
    fs.mkdirSync(path.join(process.cwd(), 'data', 'storage', projectId), { recursive: true });
    fs.mkdirSync(path.join(process.cwd(), 'data', 'remoteconfig', 'templates'), { recursive: true });
    fs.mkdirSync(path.join(process.cwd(), 'data', 'appcheck', 'apps'), { recursive: true });
  }

  createProject({ orgId, projectId, name, environment = 'dev', regionPrimary = 'us-east' }) {
    if (this.projects.get(projectId)) throw Object.assign(new Error('Project exists'), { code: 'ALREADY_EXISTS' });
    const row = { projectId, orgId, name: name || projectId, environment, regionPrimary, status: 'active', createdAt: Date.now(), apiKeys: [], publicConfig: {} };
    this.projects.save(projectId, row);
    this.initProjectRoots(projectId);
    this.billing.ensureProject(projectId, orgId);
    try { this.appcheck.apps.save(projectId, { apps: [] }); } catch {}
    this.metrics.control_projects_total += 1;
    appendAudit({ type: 'project.create', orgId, projectId, environment });
    return row;
  }

  listProjects(orgId) { return this.projects.listByOrg(orgId); }
  getProject(projectId) { return this.projects.get(projectId); }
  isProjectWritable(projectId) { const p = this.projects.get(projectId); return !p || p.status !== 'deleted'; }

  deleteProject(projectId) {
    const p = this.projects.get(projectId);
    if (!p) return null;
    p.status = 'deleted';
    this.projects.save(projectId, p);
    this.metrics.control_soft_deletes_total += 1;
    appendAudit({ type: 'project.delete', orgId: p.orgId, projectId });
    return p;
  }

  restoreProject(projectId) {
    const p = this.projects.get(projectId);
    if (!p) return null;
    p.status = 'active';
    this.projects.save(projectId, p);
    appendAudit({ type: 'project.restore', orgId: p.orgId, projectId });
    return p;
  }

  createApiKey(projectId, { type = 'public', scopes = [] }) {
    const p = this.projects.get(projectId);
    if (!p) return null;
    const now = Date.now();
    const g = createKey(type);
    const row = { keyId: g.keyId, projectId, type, scopes, createdAt: now, lastUsedAt: 0, revoked: false, keyHash: g.hash, prefix: g.prefix };
    p.apiKeys = (p.apiKeys || []).concat([row]);
    this.projects.save(projectId, p);
    this.metrics.control_apikeys_total += 1;
    appendAudit({ type: 'apikey.create', projectId, keyId: row.keyId, keyType: type });
    return { ...row, secret: g.secret };
  }

  listApiKeys(projectId) { const p = this.projects.get(projectId); return (p?.apiKeys || []).map((x) => ({ ...x, keyHash: undefined })); }

  revokeApiKey(projectId, keyId) {
    const p = this.projects.get(projectId);
    if (!p) return null;
    p.apiKeys = (p.apiKeys || []).map((x) => x.keyId === keyId ? { ...x, revoked: true } : x);
    this.projects.save(projectId, p);
    appendAudit({ type: 'apikey.revoke', projectId, keyId });
    return { ok: true };
  }

  touchApiKey(projectId, keyId) {
    const p = this.projects.get(projectId);
    if (!p) return;
    p.apiKeys = (p.apiKeys || []).map((x) => x.keyId === keyId ? { ...x, lastUsedAt: Date.now() } : x);
    this.projects.save(projectId, p);
  }

  publicConfig(projectId) {
    const p = this.projects.get(projectId);
    if (!p) return null;
    return buildPublicConfig(p);
  }

  projectUsage(orgId, projectId, from, to) {
    const p = this.projects.get(projectId);
    if (!p || p.orgId !== orgId) return null;
    return this.usage.projectUsage(projectId, from, to);
  }

  orgOverview(orgId, from, to) { return this.usage.orgOverview(orgId, from, to); }
}

module.exports = { ControlPlaneService };
