const crypto = require('crypto');
const { TemplateStore } = require('./store');
const { appendVersion, listVersions, findVersion } = require('./versions');
const { validateTemplate } = require('./validator');
const { evalAst } = require('./dsl/eval');
const { createMetrics } = require('./metrics');
const { appendAudit } = require('./audit');
const { rcError } = require('./errors');

class RemoteConfigService {
  constructor({ billing, quotaEngine }) {
    this.store = new TemplateStore();
    this.billing = billing;
    this.quota = quotaEngine;
    this.metrics = createMetrics();
    this.evalMs = [];
    this.compiledCache = new Map();
  }

  _plan(projectId, orgId) { return this.billing.ensureProject(projectId, orgId).plan || 'free'; }
  _limits(plan) { return plan === 'free' ? { params: 50, conds: 10 } : { params: 1000, conds: 200 }; }
  _etag(t) { return crypto.createHash('sha256').update(JSON.stringify({ p: t.parameters, c: t.conditions, m: t.minimumFetchIntervalSeconds })).digest('hex'); }

  getTemplate(projectId) { return this.store.get(projectId); }

  publish(projectId, orgId, actor, payload, meta = {}) {
    const parsed = validateTemplate(payload);
    const lim = this._limits(this._plan(projectId, orgId));
    if (Object.keys(parsed.parameters).length > lim.params) throw rcError('RESOURCE_EXHAUSTED', 'Parameter limit exceeded');
    if (parsed.conditions.length > lim.conds) throw rcError('RESOURCE_EXHAUSTED', 'Condition limit exceeded');
    const cur = this.store.get(projectId);
    const next = {
      templateId: 'tmpl_active',
      version: Number(cur.version || 0) + 1,
      etag: '',
      publishedAt: Date.now(),
      publishedBy: actor,
      parameters: parsed.parameters,
      conditions: parsed.conditions,
      minimumFetchIntervalSeconds: parsed.minimumFetchIntervalSeconds
    };
    next.etag = this._etag(next);
    this.store.save(projectId, next);
    appendVersion(projectId, { ...next, reason: meta.reason || 'publish' });
    this.compiledCache.set(projectId, parsed.compiled);
    this.metrics.remoteconfig_publish_total += 1;
    this.metrics.remoteconfig_versions_total = Number(next.version);
    this.quota.meter({ projectId, service: 'remoteconfig', op: 'publish', count: 1 });
    appendAudit({ type: 'template.publish', projectId, actor, version: next.version });
    return next;
  }

  versions(projectId, limit = 20) { return listVersions(projectId, limit); }

  rollback(projectId, orgId, actor, version) {
    const row = findVersion(projectId, version);
    if (!row) throw rcError('NOT_FOUND', 'Version not found');
    const next = this.publish(projectId, orgId, actor, row, { reason: `rollback:${version}` });
    this.metrics.remoteconfig_rollbacks_total += 1;
    appendAudit({ type: 'template.rollback', projectId, actor, fromVersion: version, toVersion: next.version });
    return next;
  }

  _compiled(projectId, tpl) {
    if (this.compiledCache.has(projectId)) return this.compiledCache.get(projectId);
    const parsed = validateTemplate(tpl);
    this.compiledCache.set(projectId, parsed.compiled);
    return parsed.compiled;
  }

  _evaluate(tpl, projectId, ctx) {
    const started = Date.now();
    const compiled = this._compiled(projectId, tpl);
    const out = {};
    for (const [k, p] of Object.entries(tpl.parameters || {})) {
      let v = String(p.defaultValue?.value || '');
      for (const c of tpl.conditions || []) {
        const ast = compiled[c.name];
        if (!ast) continue;
        if (evalAst(ast, ctx) && p.conditionalValues && p.conditionalValues[c.name] && typeof p.conditionalValues[c.name].value === 'string') v = p.conditionalValues[c.name].value;
      }
      out[k] = v;
    }
    const d = Date.now() - started;
    this.evalMs.push(d); if (this.evalMs.length > 200) this.evalMs.shift();
    const arr = this.evalMs.slice().sort((a, b) => a - b); this.metrics.remoteconfig_eval_ms_p95 = arr.length ? arr[Math.floor(arr.length * 0.95)] : 0;
    return out;
  }

  fetch(projectId, reqBody = {}) {
    const t = this.store.get(projectId);
    const client = reqBody.client || {};
    const now = Date.now();
    this.metrics.remoteconfig_fetch_total += 1;
    this.quota.meter({ projectId, service: 'remoteconfig', op: 'fetch', count: 1 });

    const minFetch = Number(client.minimumFetchIntervalSeconds || t.minimumFetchIntervalSeconds || 3600);
    const lastFetch = Number(client.lastFetchAt || 0);
    const nextFetchAt = lastFetch + minFetch * 1000;
    if (lastFetch && now < nextFetchAt) {
      this.metrics.remoteconfig_fetch_throttled_total += 1;
      return { status: 'THROTTLED', etag: t.etag, nextFetchAt };
    }
    if (client.etag && String(client.etag) === String(t.etag)) {
      this.metrics.remoteconfig_not_modified_total += 1;
      return { status: 'NOT_MODIFIED', etag: t.etag, parameters: null };
    }
    const parameters = this._evaluate(t, projectId, { platform: reqBody.platform || '', appId: reqBody.appId || '', country: reqBody.country || '', uid: reqBody.uid || '', attributes: reqBody.attributes || {} });
    return { status: 'OK', etag: t.etag, parameters };
  }
}

module.exports = { RemoteConfigService };
