const http = require('http');
const { Kernel } = require('../core/kernel');
const { TenantModel } = require('../tenant/model');
const { IdentityPlatform } = require('../services/auth/index');
const { DocDbEngine } = require('../services/docdb');
const { RealtimeServer } = require('../realtime/wsServer');
const { RulesEngine } = require('../rules/engine');
const { FunctionsService } = require('../functions');
const { StorageService } = require('../storage');
const { URL } = require('url');
const { SyncService } = require('../sync/engine');
const { QuotaEngine } = require('../quota/engine');
const { quotaMiddleware } = require('../quota/middleware');
const { EmulatorController, clock } = require('../emulator/controller');
const { append } = require('../functions/logs');
const { getPlatform } = require('../platform/container');
const { OrgStore } = require('../iam/orgStore');
const { ServiceAccounts } = require('../iam/serviceAccounts');
const { IamEngine } = require('../iam/engine');
const { requiredScopeFor } = require('../iam/middleware');
const { BillingEngine } = require('../billing/engine');
const { HostingService } = require('../hosting/service');
const { parseHostingOrgPath, requireScope } = require('../hosting/router');
const { MessagingService } = require('../messaging/service');
const { DeviceServer } = require('../messaging/deviceServer');
const { RemoteConfigService } = require('../remoteconfig/service');
const { AppCheckService } = require('../appcheck/service');
const { AnalyticsService } = require('../analytics/service');
const { readJsonWithLimit } = require('../analytics/ingest');
const { ControlPlaneService } = require('../control/service');
const { resolveApiKey } = require('../control/middleware');
const { routeConsole } = require('../console/index.cjs');
const logger = require('../observability/logger');
const trace = require('../observability/trace');
const { loadConfig } = require('../config');
const { attachGracefulShutdown } = require('./shutdown');

const cfg = loadConfig();
const kernel = new Kernel();
const tenants = new TenantModel();
const identity = new IdentityPlatform();
const docdb = new DocDbEngine();
const rulesEngine = new RulesEngine("rules_version = '1'; match /databases/{db}/documents { match /{collection}/{docId} { allow read, write; } }");
const functionsService = new FunctionsService({ rulesEngine });
const storageService = new StorageService({ functionsService });
const syncService = new SyncService({ docdb });
const billing = new BillingEngine();
const hosting = new HostingService({ billing, functionsService });
const quotaEngine = new QuotaEngine({ policyProvider: billing.policyProvider() });
const messaging = new MessagingService({ billing, quotaEngine });
const remoteconfig = new RemoteConfigService({ billing, quotaEngine });
const appcheck = new AppCheckService({ billing });
const analytics = new AnalyticsService({ billing, quotaEngine, appcheck });
const control = new ControlPlaneService({ billing, analytics, messaging, quota: quotaEngine, appcheck });
const applyQuota = quotaMiddleware(quotaEngine, (req, ctx) => {
  const mProject = String(req.url || '').match(/^\/v1\/projects\/([^\/]+)/);
  const mOrgProject = String(req.url || '').match(/^\/v1\/orgs\/[^\/]+\/projects\/([^\/]+)/);
  return {
    projectId: ctx.projectId || req.headers['x-project'] || (mProject && mProject[1]) || (mOrgProject && mOrgProject[1]) || 'default-project',
    ip: req.socket.remoteAddress || '127.0.0.1',
    uid: ctx.uid || ''
  };
});
const emulator = new EmulatorController({ tenants, identity, docdb, storage: storageService, quota: quotaEngine });
const platform = getPlatform();
platform.start();
const orgStore = new OrgStore();
const serviceAccounts = new ServiceAccounts(orgStore);
const iam = new IamEngine({ orgStore, serviceAccounts });
kernel.register('tenant', tenants);
kernel.register('identity', identity);

function send(res, status, payload, reqId, req = null) {
  const headers = {
    'content-type': 'application/json',
    'x-request-id': reqId || '',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'"
  };
  const origin = req?.headers?.origin ? String(req.headers.origin) : '';
  if (origin && (cfg.cors.allowlist || []).includes(origin)) headers['access-control-allow-origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function err(code, message, details = {}) {
  return { error: { code, message, details } };
}


const sensitiveHits = new Map();
function checkSensitiveRate(req) {
  const url = String(req.url || '');
  const sensitive = (req.method === 'POST' && (url === '/auth/login' || url === '/auth/signup' || url.includes('/appcheck/exchange')));
  if (!sensitive) return;
  const ip = req.socket.remoteAddress || '127.0.0.1';
  const key = `${ip}:${url}`;
  const now = Date.now();
  const row = sensitiveHits.get(key) || { c: 0, ts: now };
  if (now - row.ts > 60_000) { row.c = 0; row.ts = now; }
  row.c += 1;
  sensitiveHits.set(key, row);
  if (row.c > 120) {
    const e = new Error('Rate limit exceeded');
    e.code = 'RESOURCE_EXHAUSTED';
    throw e;
  }
}

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    const max = Number(cfg.limits.bodyBytes || 1024 * 1024);
    req.on('data', (c) => { s += c; if (s.length > max) { reject(err('RESOURCE_EXHAUSTED', 'Body too large')); try { req.destroy(); } catch {} } });
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch { reject(err('INVALID_JSON', 'Invalid JSON')); }
    });
    req.on('error', () => reject(err('REQUEST_ERROR', 'Request stream error')));
  });
}

function tenantContext(req) {
  const organization = req.headers['x-organization'] || 'default-org';
  const project = req.headers['x-project'] || 'default-project';
  const environment = req.headers['x-environment'] || 'dev';
  return tenants.ensureProject({ organization, project, environment });
}

function bearerToken(req) {
  return req.headers.authorization ? String(req.headers.authorization).replace('Bearer ', '') : '';
}

function parseUidFromClaims(claims) {
  const sub = claims && claims.sub ? String(claims.sub) : '';
  return sub ? sub.split(':').pop() : '';
}

function buildRequestIdentity(req, { orgId, projectId }) {
  const token = bearerToken(req);
  const claims = token ? identity.verifyAccessToken(token) : null;
  const uid = parseUidFromClaims(claims);
  const auth = uid ? { uid, role: claims?.role || null } : null;
  const svc = token ? serviceAccounts.verify(orgId, projectId, token) : { ok: false };
  const service = svc.ok && svc.payload?.sub ? {
    sub: String(svc.payload.sub),
    orgId: svc.payload.orgId,
    projectId: svc.payload.projectId,
    scopes: svc.payload.scopes || []
  } : null;
  return { token, claims, auth, service };
}

async function timedService(name, fn) {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    kernel.observeService(name, Date.now() - started);
  }
}


function resolveActor(ctx = {}) {
  if (ctx.auth?.uid) return { kind: 'user', id: ctx.auth.uid, orgId: ctx.orgId, projectId: ctx.projectId, scopes: [] };
  if (ctx.service?.sub) return { kind: 'service', id: ctx.service.sub, orgId: ctx.orgId, projectId: ctx.projectId, scopes: ctx.service.scopes || [] };
  return { kind: 'anonymous', id: '', orgId: ctx.orgId, projectId: ctx.projectId, scopes: [] };
}

function enforceIam(req, ctx, identityCtx) {
  const required = requiredScopeFor(req);
  if (!required) return;
  const orgId = req.headers['x-organization'] || 'default-org';
  const m = String(req.url || '').match(/^\/v1\/projects\/([^\/]+)/);
  const projectId = (m && m[1]) || ctx.projectId || req.headers['x-project'] || 'default-project';
  if (identityCtx?.auth?.role === 'admin') return;
  const actor = resolveActor({ ...identityCtx, orgId, projectId });
  if (actor.kind === 'anonymous') {
    const e = new Error('Missing required scope');
    e.code = 'PERMISSION_DENIED';
    e.details = { requiredScope: required, requestId: ctx.requestId };
    throw e;
  }
  iam.check({ orgId, projectId, actor: actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes }, requestId: ctx.requestId }, required);
}

const app = http.createServer(async (req, res) => {
  const reqStartedAt = Date.now();
  const span = trace.startSpan('http.request', { method: req.method, url: req.url });
  const deterministicId = process.env.EMULATOR === '1' ? req.headers['x-deterministic-id'] : '';
  const ctx = kernel.startRequest(`${req.method} ${req.url}`, { requestId: deterministicId || undefined });
  res.on('finish', () => {
    const latencyMs = Date.now() - reqStartedAt;
    logger.info('request.complete', { requestId: ctx.requestId, route: req.url, latencyMs, status: res.statusCode });
    trace.endSpan(span, res.statusCode >= 500 ? 'error' : 'ok', { requestId: ctx.requestId, route: req.url, latencyMs, status: res.statusCode });
  });
  try {
    checkSensitiveRate(req);
    const headerOrgId = req.headers['x-organization'] || 'default-org';
    const headerProjectId = req.headers['x-project'] || 'default-project';
    const identityCtx = buildRequestIdentity(req, { orgId: headerOrgId, projectId: headerProjectId });
    const apiKeyHeader = req.headers['x-api-key'] ? String(req.headers['x-api-key']) : '';
    const apiResolved = apiKeyHeader ? resolveApiKey(control.projects, apiKeyHeader) : null;
    const quotaCtx = applyQuota(req, { uid: identityCtx.auth?.uid || '' });
    enforceIam(req, ctx, identityCtx);
    const mAnyProject = String(req.url || '').match(/^\/v1\/projects\/([^\/]+)/);
    const writeVerb = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';
    const bypass = String(req.url || '').includes('/restore') || String(req.url || '').includes('/public-config') || String(req.url || '').includes('/apikeys');
    if (mAnyProject && writeVerb && !bypass && !control.isProjectWritable(mAnyProject[1])) throw Object.assign(new Error('Project deleted'), { code: 'PERMISSION_DENIED', details: { projectId: mAnyProject[1], reason: 'PROJECT_DELETED' } });



    if (req.method === 'GET' && req.url === '/healthz') {
      kernel.endRequest(ctx, 200);
      return send(res, 200, { status: 'ok' }, ctx.requestId, req);
    }

    if (req.method === 'GET' && req.url === '/readyz') {
      const reasons = [];
      const fs = require('fs');
      const path = require('path');
      const dirs = [
        path.join(process.cwd(), 'data'),
        path.join(process.cwd(), 'data', 'audit'),
        path.join(process.cwd(), 'data', 'usage')
      ];
      for (const d of dirs) { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.R_OK | fs.constants.W_OK); } catch { reasons.push(`dir_unavailable:${d}`); } }
      if (cfg.readiness.diskWriteTest) {
        try {
          const f = path.join(process.cwd(), 'data', '.readyz.tmp');
          fs.writeFileSync(f, String(Date.now()));
          fs.unlinkSync(f);
        } catch { reasons.push('disk_write_failed'); }
      }
      const status = reasons.length ? 503 : 200;
      kernel.endRequest(ctx, status);
      return send(res, status, reasons.length ? { status: 'not_ready', reasons } : { status: 'ok' }, ctx.requestId, req);
    }

    if (req.method === 'GET' && req.url.startsWith('/__trace')) {
      if (process.env.EMULATOR !== '1') {
        kernel.endRequest(ctx, 404);
        return send(res, 404, err('NOT_FOUND', 'Route not found'), ctx.requestId, req);
      }
      const u = new URL(req.url, 'http://localhost');
      const limit = Number(u.searchParams.get('limit') || 100);
      kernel.endRequest(ctx, 200);
      return send(res, 200, { items: trace.listSpans(limit) }, ctx.requestId, req);
    }

    if (req.url.startsWith('/v1/console/')) {
      const handled = routeConsole({
        req,
        res,
        send,
        ctx,
        services: { control, analytics, messaging, remoteconfig, quotaEngine, billing, orgStore, iam, identityCtx, resolveActor }
      });
      if (handled) { kernel.endRequest(ctx, 200); return; }
    }

    if (req.url.startsWith('/__emulator/')) {
      if (process.env.EMULATOR !== '1') {
        kernel.endRequest(ctx, 404);
        return send(res, 404, err('NOT_FOUND', 'Route not found'), ctx.requestId);
      }

      if (req.method === 'GET' && req.url === '/__emulator/status') {
        append({ projectId: 'global', type: 'emulator.status', tag: 'emulator', requestId: ctx.requestId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, emulator.status(), ctx.requestId);
      }

      if (req.method === 'POST' && req.url === '/__emulator/mode') {
        const payload = await body(req);
        append({ projectId: 'global', type: 'emulator.mode.request', tag: 'emulator', requestId: ctx.requestId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, emulator.setMode(payload.mode), ctx.requestId);
      }

      if (req.method === 'POST' && req.url === '/__emulator/seed') {
        const payload = await body(req);
        await emulator.seed(payload);
        append({ projectId: payload.projectId || 'global', type: 'emulator.seed.request', tag: 'emulator', requestId: ctx.requestId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, { ok: true, requestId: ctx.requestId }, ctx.requestId);
      }

      if (req.method === 'POST' && req.url === '/__emulator/reset') {
        const payload = await body(req);
        const out = emulator.reset(payload.projectId);
        append({ projectId: payload.projectId || 'global', type: 'emulator.reset.request', tag: 'emulator', requestId: ctx.requestId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }

      if (req.method === 'GET' && req.url.startsWith('/__emulator/doc/')) {
        const u = new URL(req.url, 'http://localhost');
        const parts = u.pathname.split('/').filter(Boolean);
        const collection = parts[2];
        const docId = parts[3];
        const projectId = u.searchParams.get('projectId');
        const primaryRead = () => docdb.collection(collection).doc(docId).get();
        const out = platform.replication.regionReadDoc(projectId || 'default-project', collection, docId, primaryRead, req.headers['x-region'] || 'us-east');
        const filtered = projectId && out && out._projectId !== projectId ? null : out;
        kernel.endRequest(ctx, 200);
        return send(res, 200, { doc: filtered }, ctx.requestId);
      }

      if (req.method === 'GET' && req.url.startsWith('/__emulator/quota/')) {
        const parts = req.url.split('?')[0].split('/').filter(Boolean);
        const projectId = parts[2];
        kernel.endRequest(ctx, 200);
        return send(res, 200, quotaEngine.getQuota(projectId), ctx.requestId);
      }
    }

    
    if (req.url.startsWith('/__replication/')) {
      if (process.env.EMULATOR !== '1') {
        kernel.endRequest(ctx, 404);
        return send(res, 404, err('NOT_FOUND', 'Route not found'), ctx.requestId);
      }
      if (req.method === 'POST' && req.url === '/__replication/failover') {
        const payload = await body(req);
        const out = platform.replication.failover(payload.primaryNodeId);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && req.url === '/__replication/lag') {
        const payload = await body(req);
        const lagMs = platform.replication.setLag(payload.lagMs);
        kernel.endRequest(ctx, 200);
        return send(res, 200, { lagMs }, ctx.requestId);
      }
      if (req.method === 'POST' && req.url === '/__replication/consistency') {
        const payload = await body(req);
        const consistency = platform.replication.setConsistency(payload.consistency);
        kernel.endRequest(ctx, 200);
        return send(res, 200, { consistency }, ctx.requestId);
      }
      if (req.method === 'GET' && req.url.startsWith('/__replication/status')) {
        kernel.endRequest(ctx, 200);
        return send(res, 200, {
          consistency: platform.replication.getConsistency(),
          primaryNodeId: platform.replication.primaryNodeId(),
          lagMs: platform.replication.getLag(),
          queueDepth: platform.metrics.replication_queue_depth
        }, ctx.requestId);
      }
    }

    
    if (req.url.startsWith('/__regions/')) {
      if (process.env.EMULATOR !== '1') {
        kernel.endRequest(ctx, 404);
        return send(res, 404, err('NOT_FOUND', 'Route not found'), ctx.requestId);
      }
      if (req.method === 'POST' && req.url === '/__regions/failover') {
        const payload = await body(req);
        const out = platform.replication.regionFailover(payload.region);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && req.url === '/__regions/read-mode') {
        const payload = await body(req);
        const readMode = platform.replication.setReadMode(payload.readMode);
        kernel.endRequest(ctx, 200);
        return send(res, 200, { readMode }, ctx.requestId);
      }
      if (req.method === 'POST' && req.url === '/__regions/lag') {
        const payload = await body(req);
        const lagMs = platform.replication.setCrossRegionDelay(payload.lagMs);
        kernel.endRequest(ctx, 200);
        return send(res, 200, { lagMs }, ctx.requestId);
      }
      if (req.method === 'POST' && req.url === '/__regions/snapshot') {
        const payload = await body(req);
        const out = platform.replication.createSnapshot(payload.region);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && req.url === '/__regions/restore') {
        const payload = await body(req);
        const out = platform.replication.restoreSnapshot(payload.region, payload.ts);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
    }

        if (req.method === 'GET' && req.url === '/metrics') {
      kernel.endRequest(ctx, 200);
      return send(res, 200, { ...kernel.metrics.snapshot(), latency: kernel.latency.summary(), slo: { queueLag: platform.metrics.queueLag, outboxSize: platform.metrics.outboxSize, publishLatencyP95: (() => { const arr = platform.metrics.publishLatencyMs.slice().sort((a,b)=>a-b); return arr.length ? arr[Math.floor(arr.length*0.95)] : 0; })(), leaderState: platform.metrics.leaderState, replicationLagMs: platform.metrics.replication_lag_ms, replicationQueueDepth: platform.metrics.replication_queue_depth, replicationEventsTotal: platform.metrics.replication_events_total, failoverCount: platform.metrics.failover_count, followerReplayLatencyP95: platform.replication.p95Replay(), crossRegionLagMs: platform.metrics.cross_region_lag_ms, crossRegionQueueDepth: platform.metrics.cross_region_queue_depth, rpoSeconds: platform.metrics.rpo_seconds, rtoSecondsLastFailover: platform.metrics.rto_seconds_last_failover, regionPrimary: platform.metrics.region_primary, regionHealthStatus: platform.metrics.region_health_status }, realtime: realtime.metricsSnapshot(), functions: functionsService.metrics.snapshot(), storage: storageService.metrics, sync: syncService.metrics, quota: quotaEngine.metrics, iam: iam.metrics, billing: billing.metrics, hosting: hosting.metrics, messaging: messaging.metrics, remoteconfig: remoteconfig.metrics, appcheck: appcheck.metrics, analytics: analytics.metrics, control: control.metrics }, ctx.requestId);
    }

    if (req.method === 'POST' && req.url === '/auth/signup') {
      const payload = await body(req);
      const out = await timedService('auth.signup', () => identity.signup({ tenant: tenantContext(req), ...payload, ip: req.socket.remoteAddress }));
      quotaEngine.meter({ projectId: tenantContext(req).projectId, service: 'auth', op: 'signup', count: 1, uid: quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
      kernel.endRequest(ctx, 201);
      return send(res, 201, out, ctx.requestId);
    }

    if (req.method === 'POST' && req.url === '/auth/login') {
      const payload = await body(req);
      const out = await timedService('auth.login', () => identity.login({ tenant: tenantContext(req), ...payload, ip: req.socket.remoteAddress }));
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if (req.method === 'POST' && req.url === '/auth/refresh') {
      const payload = await body(req);
      const out = await identity.refresh({ ...payload, ip: req.socket.remoteAddress });
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }


    if (req.url.startsWith('/v1/projects/') && (req.url.includes('/quota') || req.url.includes('/usage'))) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const projectId = parts[2];
      if (req.method === 'GET' && parts[3] === 'quota') {
        kernel.endRequest(ctx, 200);
        return send(res, 200, quotaEngine.getQuota(projectId), ctx.requestId);
      }
      if (req.method === 'PUT' && parts[3] === 'quota') {
        const payload = await body(req);
        const out = quotaEngine.setQuota(projectId, payload);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'GET' && parts[3] === 'usage') {
        const from = u.searchParams.get('from') || 0;
        const to = u.searchParams.get('to') || clock.now();
        kernel.endRequest(ctx, 200);
        return send(res, 200, { events: quotaEngine.getUsage(projectId, from, to) }, ctx.requestId);
      }
    }

    if (req.method === 'POST' && req.url === '/auth/custom-token') {
      const payload = await body(req);
      const out = identity.issueCustomToken({ tenant: tenantContext(req), uid: payload.uid, claims: payload.claims || {} });
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }


    if (req.method === 'POST' && req.url.startsWith('/v1/projects/') && req.url.includes('/sync')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const projectId = parts[2];
      const payload = await body(req);
      const scopedIdentity = buildRequestIdentity(req, { orgId: headerOrgId, projectId });
      if (!scopedIdentity.auth?.uid) throw Object.assign(new Error('Unauthorized'), { code: 'UNAUTHORIZED' });
      quotaEngine.preCheck({ projectId, ip: quotaCtx.ip, uid: scopedIdentity.auth.uid, service: 'sync', op: 'ops', amount: (payload.ops || []).length || 1 });
      const out = await timedService('sync.ops', () => syncService.sync(projectId, payload.actorId, payload, { uid: scopedIdentity.auth.uid, role: scopedIdentity.auth.role }));
      quotaEngine.meter({ projectId, service: 'sync', op: 'ops', count: (payload.ops || []).length || 0, uid: scopedIdentity.auth.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if (req.url.startsWith('/v1/projects/')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const projectId = parts[2];
      if (parts[3] === 'buckets' && req.method === 'POST') {
        const payload = await body(req);
        const out = storageService.createBucket(projectId, payload.bucketName, payload.options || {});
        quotaEngine.meter({ projectId, service: 'storage', op: 'ops', count: 1, uid: quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
        kernel.endRequest(ctx, 201);
        return send(res, 201, out, ctx.requestId);
      }
      if (parts[3] === 'buckets' && req.method === 'GET') {
        const out = storageService.listBuckets(projectId);
        quotaEngine.meter({ projectId, service: 'storage', op: 'ops', count: 1, uid: quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, { buckets: out }, ctx.requestId);
      }
      if (parts[3] === 'storage' && parts[4] === 'sign' && req.method === 'POST') {
        const payload = await body(req);
        appcheck.verifyForService(req, { projectId, serviceKey: 'storage.sign' });
        const scopedIdentity = buildRequestIdentity(req, { orgId: headerOrgId, projectId });
        const ctxAuth = { auth: scopedIdentity.auth };
        quotaEngine.preCheck({ projectId, ip: quotaCtx.ip, uid: quotaCtx.uid, service: 'storage', op: 'ops', amount: 1 });
        const url = await timedService('storage.sign', () => Promise.resolve(storageService.signUrl(projectId, payload, ctxAuth)));
        quotaEngine.meter({ projectId, service: 'storage', op: 'sign', count: 1, uid: quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, { url }, ctx.requestId);
      }
    }

    if (req.url.startsWith('/v1/storage/object')) {
      const u = new URL(req.url, 'http://localhost');
      const q = Object.fromEntries(u.searchParams.entries());
      storageService.verifySigned(q, req.method, req.headers);
      if (req.method === 'PUT') {
        if (Number(req.headers['content-length'] || 0) > storageService.maxObjectSize) throw Object.assign(new Error('Object too large'), { code: 'SIZE_LIMIT' });
        quotaEngine.preCheck({ projectId: q.projectId, ip: quotaCtx.ip, uid: q.signedUid || quotaCtx.uid, service: 'storage', op: 'ops', amount: 1 });
        const meta = await timedService('storage.put', () => storageService.putObject(q.projectId, q.bucket, q.key, req, { contentType: req.headers['content-type'] || 'application/octet-stream', ownerUid: req.headers['x-owner-uid'] || q.signedUid || null }, { auth: { uid: q.signedUid || null } }));
        quotaEngine.meter({ projectId: q.projectId, service: 'storage', op: 'ops', count: 1, uid: q.signedUid || quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
        quotaEngine.meter({ projectId: q.projectId, service: 'storage', op: 'writeBytes', count: 1, bytes: meta.size || 0, uid: q.signedUid || quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, { metadata: meta }, ctx.requestId);
      }
      if (req.method === 'GET') {
        quotaEngine.preCheck({ projectId: q.projectId, ip: quotaCtx.ip, uid: q.signedUid || quotaCtx.uid, service: 'storage', op: 'ops', amount: 1 });
        const out = await timedService('storage.get', () => storageService.getObject(q.projectId, q.bucket, q.key, { auth: { uid: q.signedUid || null } }));
        quotaEngine.meter({ projectId: q.projectId, service: 'storage', op: 'ops', count: 1, uid: q.signedUid || quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
        quotaEngine.meter({ projectId: q.projectId, service: 'storage', op: 'readBytes', count: 1, bytes: out.buffer.length || 0, uid: q.signedUid || quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
        res.writeHead(200, { 'content-type': out.metadata.contentType, etag: out.metadata.etag, 'x-request-id': ctx.requestId });
        res.end(out.buffer);
        kernel.endRequest(ctx, 200);
        return;
      }
      if (req.method === 'DELETE') {
        quotaEngine.preCheck({ projectId: q.projectId, ip: quotaCtx.ip, uid: q.signedUid || quotaCtx.uid, service: 'storage', op: 'ops', amount: 1 });
        const out = storageService.deleteObject(q.projectId, q.bucket, q.key, { auth: { uid: q.signedUid || null } });
        quotaEngine.meter({ projectId: q.projectId, service: 'storage', op: 'ops', count: 1, uid: q.signedUid || quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, { deleted: Boolean(out) }, ctx.requestId);
      }
    }

    if (req.url.startsWith('/v1/projects/') && req.url.includes('/appcheck/exchangeDebug')) {
      const parts = String(req.url).split('/').filter(Boolean);
      const projectId = parts[2];
      const payload = await body(req);
      const out = appcheck.exchangeDebug(projectId, payload.appId, payload.debugToken);
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if (req.url.startsWith('/v1/projects/') && req.url.includes('/appcheck/exchangeCustom')) {
      const parts = String(req.url).split('/').filter(Boolean);
      const projectId = parts[2];
      const payload = await body(req);
      const out = appcheck.exchangeCustom(projectId, payload.appId, payload.secret);
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if (req.url.startsWith('/v1/orgs/') && req.url.includes('/appcheck/')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const orgId = parts[2];
      const projectId = parts[4];
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
      if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'appcheck.read', requestId: ctx.requestId } });
      const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };

      if (req.method === 'POST' && parts[5] === 'appcheck' && parts[6] === 'apps') {
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'appcheck.admin');
        const payload = await body(req);
        const out = appcheck.registerApp(projectId, orgId, payload);
        kernel.endRequest(ctx, 201);
        return send(res, 201, out, ctx.requestId);
      }
      if (req.method === 'GET' && parts[5] === 'appcheck' && parts[6] === 'apps') {
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'appcheck.read');
        kernel.endRequest(ctx, 200);
        return send(res, 200, { apps: appcheck.listApps(projectId) }, ctx.requestId);
      }
      if (req.method === 'PUT' && parts[5] === 'appcheck' && parts[6] === 'apps' && parts[8] === 'enforcement') {
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'appcheck.admin');
        const payload = await body(req);
        const out = appcheck.setEnforcement(projectId, parts[7], payload.serviceKey, payload.mode);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[5] === 'appcheck' && parts[6] === 'debugTokens') {
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'appcheck.admin');
        const payload = await body(req);
        const out = appcheck.addDebugToken(projectId, payload.token);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[5] === 'appcheck' && parts[6] === 'customSecrets') {
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'appcheck.admin');
        const payload = await body(req);
        const out = appcheck.setCustomSecret(projectId, payload.appId, payload.secretBase64);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
    }



    if (req.method === 'POST' && req.url === '/v1/orgs') {
      const payload = await body(req);
      const out = control.createOrg({ orgId: payload.orgId || `org_${Date.now()}`, name: payload.name, ownerUid: payload.ownerUid || identityCtx.auth?.uid || '', plan: payload.plan || 'free' });
      kernel.endRequest(ctx, 201);
      return send(res, 201, out, ctx.requestId);
    }

    if (req.url.startsWith('/v1/orgs/') && !req.url.includes('/projects/') && req.method === 'GET') {
      const orgId = String(req.url.split('/')[3] || '');
      const out = control.getOrg(orgId);
      if (!out) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if (req.method === 'PUT' && req.url.startsWith('/v1/orgs/') && req.url.includes('/plan')) {
      const orgId = String(req.url.split('/')[3] || '');
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId: req.headers['x-project'] || 'default-project' });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId: req.headers['x-project'] || 'default-project' });
      if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'org.admin', requestId: ctx.requestId } });
      const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };
      iam.check({ orgId, projectId: req.headers['x-project'] || 'default-project', actor: iamActor, requestId: ctx.requestId }, 'org.admin');
      const payload = await body(req);
      const out = control.setOrgPlan(orgId, payload.plan, actor.id || 'system');
      if (out) billing.setBilling(req.headers['x-project'] || 'default-project', orgId, { plan: out.plan }, actor.id || 'system', ctx.requestId);
      kernel.endRequest(ctx, 200);
      return send(res, 200, out || {}, ctx.requestId);
    }

    if (req.method === 'DELETE' && req.url.startsWith('/v1/orgs/') && String(req.url).split('/').filter(Boolean).length === 3) {
      const orgId = String(req.url.split('/')[3] || '');
      const out = control.deleteOrg(orgId);
      kernel.endRequest(ctx, 200);
      return send(res, 200, out || {}, ctx.requestId);
    }

    if (req.method === 'POST' && req.url.startsWith('/v1/orgs/') && req.url.includes('/projects')) {
      const parts = String(req.url).split('/').filter(Boolean);
      if (parts.length === 4) {
        const orgId = parts[2];
        const scopedIdentity = buildRequestIdentity(req, { orgId, projectId: req.headers['x-project'] || 'default-project' });
        const actor = resolveActor({ ...scopedIdentity, orgId, projectId: req.headers['x-project'] || 'default-project' });
        if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'project.admin', requestId: ctx.requestId } });
        const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };
        iam.check({ orgId, projectId: req.headers['x-project'] || 'default-project', actor: iamActor, requestId: ctx.requestId }, 'project.admin');
        const payload = await body(req);
        const out = control.createProject({ orgId, projectId: payload.projectId, name: payload.name, environment: payload.environment || 'dev', regionPrimary: payload.regionPrimary || 'us-east' });
        kernel.endRequest(ctx, 201);
        return send(res, 201, out, ctx.requestId);
      }
    }

    if (req.method === 'GET' && req.url.startsWith('/v1/orgs/') && req.url.includes('/projects') && !req.url.includes('/analytics/')) {
      const parts = String(req.url.split('?')[0]).split('/').filter(Boolean);
      if (parts.length === 4) {
        const orgId = parts[2];
        kernel.endRequest(ctx, 200);
        return send(res, 200, { projects: control.listProjects(orgId) }, ctx.requestId);
      }
    }

    if (req.method === 'GET' && req.url.startsWith('/v1/projects/') && String(req.url).split('/').filter(Boolean).length === 3) {
      const projectId = String(req.url.split('/')[3] || '');
      const out = control.getProject(projectId);
      if (out) { kernel.endRequest(ctx, 200); return send(res, 200, out, ctx.requestId); }
    }

    if (req.method === 'DELETE' && req.url.startsWith('/v1/projects/') && String(req.url).split('/').filter(Boolean).length === 3) {
      const projectId = String(req.url.split('/')[3] || '');
      const out = control.deleteProject(projectId);
      kernel.endRequest(ctx, 200);
      return send(res, 200, out || {}, ctx.requestId);
    }

    if (req.method === 'POST' && req.url.startsWith('/v1/projects/') && req.url.endsWith('/restore')) {
      const projectId = String(req.url.split('/')[3] || '');
      const out = control.restoreProject(projectId);
      kernel.endRequest(ctx, 200);
      return send(res, 200, out || {}, ctx.requestId);
    }

    if (req.method === 'POST' && req.url.startsWith('/v1/projects/') && req.url.includes('/apikeys')) {
      const parts = String(req.url).split('/').filter(Boolean);
      if (parts[3] === 'apikeys' && parts.length === 4) {
        const projectId = parts[2];
        const project = control.getProject(projectId);
        const orgId = project?.orgId || (req.headers['x-organization'] || 'default-org');
        const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
        const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
        if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'apikey.admin', requestId: ctx.requestId } });
        const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'apikey.admin');
        const payload = await body(req);
        const out = control.createApiKey(projectId, payload || {});
        kernel.endRequest(ctx, 201);
        return send(res, 201, out, ctx.requestId);
      }
    }

    if (req.method === 'GET' && req.url.startsWith('/v1/projects/') && req.url.includes('/apikeys')) {
      const parts = String(req.url).split('/').filter(Boolean);
      if (parts[3] === 'apikeys') {
        const projectId = parts[2];
        kernel.endRequest(ctx, 200);
        return send(res, 200, { keys: control.listApiKeys(projectId) }, ctx.requestId);
      }
    }

    if (req.method === 'DELETE' && req.url.startsWith('/v1/projects/') && req.url.includes('/apikeys/')) {
      const parts = String(req.url).split('/').filter(Boolean);
      const projectId = parts[2];
      const keyId = parts[4];
      const out = control.revokeApiKey(projectId, keyId);
      kernel.endRequest(ctx, 200);
      return send(res, 200, out || {}, ctx.requestId);
    }

    if (req.method === 'GET' && req.url.startsWith('/v1/projects/') && req.url.endsWith('/public-config')) {
      const projectId = String(req.url.split('/')[3] || '');
      const out = control.publicConfig(projectId);
      if (!out) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if (req.method === 'GET' && req.url.startsWith('/v1/orgs/') && req.url.includes('/usage')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const orgId = parts[2];
      const projectId = parts[4];
      const from = u.searchParams.get('from') || new Date().toISOString().slice(0, 10);
      const to = u.searchParams.get('to') || from;
      kernel.endRequest(ctx, 200);
      return send(res, 200, control.projectUsage(orgId, projectId, from, to) || {}, ctx.requestId);
    }

    if (req.method === 'GET' && req.url.startsWith('/v1/orgs/') && req.url.includes('/overview')) {
      const _uCheck = new URL(req.url, 'http://localhost');
      const _partsCheck = _uCheck.pathname.split('/').filter(Boolean);
      if (_partsCheck[3] !== 'overview') { /* skip non-control overview routes */ } else {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const orgId = parts[2];
      const from = u.searchParams.get('from') || new Date().toISOString().slice(0, 10);
      const to = u.searchParams.get('to') || from;
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId: req.headers['x-project'] || 'default-project' });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId: req.headers['x-project'] || 'default-project' });
      if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'control.read', requestId: ctx.requestId } });
      const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };
      iam.check({ orgId, projectId: req.headers['x-project'] || 'default-project', actor: iamActor, requestId: ctx.requestId }, 'control.read');
      kernel.endRequest(ctx, 200);
      return send(res, 200, control.orgOverview(orgId, from, to), ctx.requestId);
      }
    }

    if (req.method === 'POST' && req.url.startsWith('/v1/projects/') && req.url.includes('/analytics/events')) {
      const parts = String(req.url).split('/').filter(Boolean);
      const projectId = parts[2];
      const { body: payload, bytes } = await readJsonWithLimit(req, 256 * 1024);
      if (apiResolved && apiResolved.project?.projectId === projectId) {
        if (apiResolved.key.revoked) throw Object.assign(new Error('API key revoked'), { code: 'PERMISSION_DENIED', details: { reason: 'API_KEY_REVOKED' } });
        control.touchApiKey(projectId, apiResolved.key.keyId);
      }
      const out = analytics.ingest({ projectId, req, requestId: ctx.requestId, payload, bytes, uid: identityCtx.auth?.uid || '', ip: quotaCtx.ip });
      kernel.endRequest(ctx, 202);
      return send(res, 202, out, ctx.requestId);
    }

    if (req.url.startsWith('/v1/orgs/') && req.url.includes('/analytics/')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const orgId = parts[2];
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId: parts[4] || '' });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId: parts[4] || '' });
      if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'analytics.read', requestId: ctx.requestId } });
      const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };

      if (req.method === 'GET' && parts[3] === 'projects' && parts[5] === 'analytics' && parts[6] === 'summary') {
        const projectId = parts[4];
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'analytics.read');
        const from = u.searchParams.get('from') || new Date().toISOString().slice(0, 10);
        const to = u.searchParams.get('to') || from;
        kernel.endRequest(ctx, 200);
        return send(res, 200, analytics.projectSummary(projectId, from, to), ctx.requestId);
      }
      if (req.method === 'GET' && parts[3] === 'projects' && parts[5] === 'analytics' && parts[6] === 'hourly') {
        const projectId = parts[4];
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'analytics.read');
        const date = u.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        kernel.endRequest(ctx, 200);
        return send(res, 200, analytics.projectHourly(projectId, date), ctx.requestId);
      }
      if (req.method === 'GET' && parts[3] === 'projects' && parts[5] === 'analytics' && parts[6] === 'cohorts') {
        const projectId = parts[4];
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'analytics.read');
        const month = u.searchParams.get('month') || new Date().toISOString().slice(0, 7);
        kernel.endRequest(ctx, 200);
        return send(res, 200, analytics.projectCohorts(projectId, month), ctx.requestId);
      }
      if (req.method === 'GET' && parts[3] === 'analytics' && parts[4] === 'overview') {
        const org = orgStore.get(orgId);
        const sampleProjectId = Object.keys(org.projects || {})[0] || req.headers['x-project'] || 'default-project';
        iam.check({ orgId, projectId: sampleProjectId, actor: iamActor, requestId: ctx.requestId }, 'analytics.admin');
        const from = u.searchParams.get('from') || new Date().toISOString().slice(0, 10);
        const to = u.searchParams.get('to') || from;
        const projects = Object.keys(org.projects || {});
        const byProject = projects.map((projectId) => ({ projectId, summary: analytics.projectSummary(projectId, from, to) }));
        const eventsTotal = byProject.reduce((a, x) => a + Number(x.summary.eventsTotal || 0), 0);
        kernel.endRequest(ctx, 200);
        return send(res, 200, { orgId, from, to, eventsTotal, projects: byProject }, ctx.requestId);
      }
    }

    if (req.url.startsWith('/v1/projects/') && req.url.includes('/remoteconfig/fetch')) {
      const payload = await body(req);
      const projectId = String(req.url.split('/')[3] || 'default-project');
      appcheck.verifyForService(req, { projectId, serviceKey: 'remoteconfig.fetch' });
      const out = remoteconfig.fetch(projectId, payload);
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if (req.url.startsWith('/v1/projects/') && req.url.includes('/messaging/')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const projectId = parts[2];
      const orgId = req.headers['x-organization'] || 'default-org';
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
      const uid = scopedIdentity.auth?.uid || '';
      const ensureAuth = () => { if (!uid) throw Object.assign(new Error('Unauthorized'), { code: 'PERMISSION_DENIED', details: { requestId: ctx.requestId } }); };
      const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : actor.kind === 'service' ? { kind: 'service', id: actor.id, scopes: actor.scopes } : null;

      if (req.method === 'POST' && parts[4] === 'tokens' && parts.length === 5) {
        ensureAuth();
        if (iamActor) iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'messaging.read');
        const payload = await body(req);
        appcheck.verifyForService(req, { projectId, serviceKey: 'messaging.tokens' });
        const out = messaging.registerToken(projectId, uid, payload.token, payload, orgId);
        kernel.endRequest(ctx, 201);
        return send(res, 201, out, ctx.requestId);
      }
      if (req.method === 'DELETE' && parts[4] === 'tokens' && parts[5]) {
        ensureAuth();
        if (iamActor) iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'messaging.read');
        const out = messaging.unregisterToken(projectId, uid, parts[5]);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[4] === 'topics' && parts[6] === 'subscribe') {
        ensureAuth();
        if (iamActor) iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'messaging.read');
        const payload = await body(req);
        const out = messaging.subscribeTopic(projectId, uid, payload.token, parts[5], orgId);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[4] === 'topics' && parts[6] === 'unsubscribe') {
        ensureAuth();
        if (iamActor) iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'messaging.read');
        const payload = await body(req);
        const out = messaging.unsubscribeTopic(projectId, uid, payload.token, parts[5]);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[4] === 'send') {
        if (!iamActor) throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'messaging.send', requestId: ctx.requestId } });
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'messaging.send');
        const payload = await body(req);
        appcheck.verifyForService(req, { projectId, serviceKey: 'messaging.send' });
        const out = messaging.send(projectId, actor.id || uid || 'system', payload.message || {}, orgId);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'GET' && parts[4] === 'receipts') {
        if (!iamActor) throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'messaging.admin', requestId: ctx.requestId } });
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'messaging.admin');
        kernel.endRequest(ctx, 200);
        return send(res, 200, { receipts: messaging.listReceipts(projectId) }, ctx.requestId);
      }
      if (req.method === 'GET' && parts[4] === 'dlq') {
        if (!iamActor) throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'messaging.admin', requestId: ctx.requestId } });
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'messaging.admin');
        kernel.endRequest(ctx, 200);
        return send(res, 200, { messages: messaging.listDLQ(projectId) }, ctx.requestId);
      }
      if (req.method === 'GET' && parts[4] === 'status') {
        if (!iamActor) throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'messaging.admin', requestId: ctx.requestId } });
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'messaging.admin');
        kernel.endRequest(ctx, 200);
        return send(res, 200, messaging.status(projectId), ctx.requestId);
      }
    }


    if (req.url.startsWith('/functions/')) {
      const parts = req.url.split('?')[0].split('/').filter(Boolean);
      const projectId = parts[1];
      const name = parts[2];
      if (req.method === 'POST' && parts[0] === 'functions' && projectId && name) {
        kernel.endRequest(ctx, 200);
        quotaEngine.preCheck({ projectId, ip: quotaCtx.ip, uid: quotaCtx.uid, service: 'functions', op: 'invoke', amount: 1 });
        const out = await timedService('functions.invoke', () => functionsService.invokeHttp(projectId, name, req, res));
        quotaEngine.meter({ projectId, service: 'functions', op: 'invoke', count: 1, uid: quotaCtx.uid, ip: quotaCtx.ip, requestId: ctx.requestId });
        return out;
      }
      if (req.method === 'POST' && parts[0] === 'functions-deploy' && projectId && name) {
        const payload = await body(req);
        const out = functionsService.deploy(projectId, { name, ...payload });
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'GET' && parts[0] === 'functions-list' && projectId) {
        kernel.endRequest(ctx, 200);
        return send(res, 200, { functions: functionsService.list(projectId) }, ctx.requestId);
      }
    }

    const hostingPath = parseHostingOrgPath(req.url || '');
    if (hostingPath) {
      const { u, parts, orgId, projectId, siteId } = hostingPath;
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
      const actorId = actor.id || 'anonymous';
      if (req.method === 'POST' && parts[8] === 'deploys' && parts.length === 9) {
        requireScope(iam, { orgId, projectId, actor, requestId: ctx.requestId }, 'hosting.deploy');
        const payload = await body(req);
        const out = hosting.createDeploySession({ orgId, projectId, siteId, actorId, message: payload.message || '', config: payload.config || {} });
        kernel.endRequest(ctx, 201);
        return send(res, 201, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[8] === 'deploys' && parts[10] === 'finalize') {
        requireScope(iam, { orgId, projectId, actor, requestId: ctx.requestId }, 'hosting.deploy');
        const payload = await body(req);
        const out = hosting.finalizeDeploy({ orgId, projectId, siteId, deployId: parts[9], actorId, activate: Boolean(payload.activate) });
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[8] === 'releases' && parts[10] === 'activate') {
        requireScope(iam, { orgId, projectId, actor, requestId: ctx.requestId }, 'hosting.deploy');
        const out = hosting.activateRelease({ orgId, projectId, siteId, releaseId: parts[9], actorId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[8] === 'releases' && parts[10] === 'rollback') {
        requireScope(iam, { orgId, projectId, actor, requestId: ctx.requestId }, 'hosting.deploy');
        const out = hosting.rollback({ orgId, projectId, siteId, releaseId: parts[9], actorId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[8] === 'domains') {
        requireScope(iam, { orgId, projectId, actor, requestId: ctx.requestId }, 'hosting.deploy');
        const payload = await body(req);
        const out = hosting.addDomain({ orgId, projectId, siteId, domain: payload.domain, actorId });
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'GET' && parts[8] === 'status') {
        requireScope(iam, { orgId, projectId, actor, requestId: ctx.requestId }, 'hosting.read');
        const site = hosting.ensureSite(projectId, siteId);
        kernel.endRequest(ctx, 200);
        return send(res, 200, site, ctx.requestId);
      }
    }

    if (req.method === 'PUT' && req.url.startsWith('/v1/hosting/upload')) {
      const u = new URL(req.url, 'http://localhost');
      const projectId = String(u.searchParams.get('projectId') || '');
      const siteId = String(u.searchParams.get('siteId') || 'default');
      const deployId = String(u.searchParams.get('deployId') || '');
      const relPath = String(u.searchParams.get('path') || '/');
      const orgId = req.headers['x-organization'] || 'default-org';
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
      requireScope(iam, { orgId, projectId, actor, requestId: ctx.requestId }, 'hosting.deploy');
      const out = await hosting.uploadFile({ req, projectId, siteId, deployId, relPath, contentType: req.headers['content-type'] || '', cacheControl: req.headers['cache-control'] || '' });
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if (req.url.startsWith('/v1/orgs/') && req.url.includes('/remoteconfig/')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const orgId = parts[2];
      const projectId = parts[4];
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
      if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'remoteconfig.read', requestId: ctx.requestId } });
      const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };

      if (req.method === 'GET' && parts[5] === 'remoteconfig' && parts[6] === 'template') {
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'remoteconfig.read');
        kernel.endRequest(ctx, 200);
        return send(res, 200, remoteconfig.getTemplate(projectId), ctx.requestId);
      }
      if (req.method === 'PUT' && parts[5] === 'remoteconfig' && parts[6] === 'template') {
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'remoteconfig.publish');
        const payload = await body(req);
        const out = remoteconfig.publish(projectId, orgId, actor.id, payload);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'GET' && parts[5] === 'remoteconfig' && parts[6] === 'versions') {
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'remoteconfig.read');
        const limit = Number(u.searchParams.get('limit') || 20);
        kernel.endRequest(ctx, 200);
        return send(res, 200, { versions: remoteconfig.versions(projectId, limit) }, ctx.requestId);
      }
      if (req.method === 'POST' && parts[5] === 'remoteconfig' && parts[6] === 'rollback') {
        iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'remoteconfig.admin');
        const payload = await body(req);
        const out = remoteconfig.rollback(projectId, orgId, actor.id, payload.version);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
    }


    if (req.url.startsWith('/v1/orgs/')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const orgId = parts[2];
      const projectId = parts[4];
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
      if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'iam.admin', requestId: ctx.requestId } });
      iam.check({ orgId, projectId, actor: actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes }, requestId: ctx.requestId }, 'iam.admin');

      if (req.method === 'POST' && parts[5] === 'service-accounts' && parts.length === 6) {
        const payload = await body(req);
        const out = serviceAccounts.create(orgId, projectId, payload.id, payload.scopes || []);
        kernel.endRequest(ctx, 201);
        return send(res, 201, out, ctx.requestId);
      }
      if (req.method === 'POST' && parts[5] === 'service-accounts' && parts[7] === 'key') {
        const out = serviceAccounts.issueKey(orgId, projectId, parts[6]);
        iam.metrics.service_token_issued_total += 1;
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
      if (req.method === 'DELETE' && parts[5] === 'service-accounts' && parts[6]) {
        const out = serviceAccounts.remove(orgId, projectId, parts[6]);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
    }

    
    if (req.url.startsWith('/v1/orgs/') && req.url.includes('/billing')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const orgId = parts[2];
      const projectId = parts[4];
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
      if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'billing.admin', requestId: ctx.requestId } });
      const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };
      try { iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'billing.admin'); }
      catch { iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'iam.admin'); }

      if (req.method === 'GET' && parts[5] === 'billing' && parts.length === 6) {
        const st = billing.ensureProject(projectId, orgId);
        kernel.endRequest(ctx, 200);
        return send(res, 200, st, ctx.requestId);
      }
      if (req.method === 'PUT' && parts[5] === 'billing' && parts.length === 6) {
        const payload = await body(req);
        const st = billing.setBilling(projectId, orgId, payload, actor.id, ctx.requestId);
        kernel.endRequest(ctx, 200);
        return send(res, 200, st, ctx.requestId);
      }
      if (req.method === 'GET' && parts[5] === 'billing' && parts[6] === 'alerts') {
        const month = u.searchParams.get('month') || undefined;
        const out = billing.getAlerts(projectId, month);
        kernel.endRequest(ctx, 200);
        return send(res, 200, out, ctx.requestId);
      }
    }

    if (req.url.startsWith('/v1/orgs/') && req.url.includes('/invoice')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const orgId = parts[2];
      const projectId = parts[4];
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
      if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'billing.admin', requestId: ctx.requestId } });
      const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };
      try { iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'billing.admin'); }
      catch { iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'iam.admin'); }
      const month = u.searchParams.get('month') || undefined;
      const out = billing.generateInvoice(projectId, month, actor.id, ctx.requestId);
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if (req.url.startsWith('/v1/orgs/') && req.url.includes('/usage/summary')) {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.split('/').filter(Boolean);
      const orgId = parts[2];
      const projectId = parts[4];
      const scopedIdentity = buildRequestIdentity(req, { orgId, projectId });
      const actor = resolveActor({ ...scopedIdentity, orgId, projectId });
      if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: 'billing.admin', requestId: ctx.requestId } });
      const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };
      try { iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'billing.admin'); }
      catch { iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, 'iam.admin'); }
      const out = billing.usageSummary(projectId, u.searchParams.get('from') || '', u.searchParams.get('to') || '');
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

        if (req.method === 'GET' && req.url.startsWith('/auth/oauth/')) {
      const provider = req.url.split('/').pop();
      const out = identity.oauthBegin({ provider });
      kernel.endRequest(ctx, 200);
      return send(res, 200, out, ctx.requestId);
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/v1/') && !req.url.startsWith('/auth/') && !req.url.startsWith('/functions/') && !req.url.startsWith('/__')) {
      const handled = await hosting.serve(req, res, { requestId: ctx.requestId });
      if (handled) { kernel.endRequest(ctx, 200); return; }
    }

    kernel.endRequest(ctx, 404);
    return send(res, 404, err('NOT_FOUND', 'Route not found'), ctx.requestId);
  } catch (e) {
    kernel.metrics.inc('errors.total');
    logger.error('request.error', { requestId: ctx.requestId, route: req.url, code: e.code || 'INTERNAL_ERROR', message: e.message || '' });
    const payload = e?.error ? e : err(e.code || 'INTERNAL_ERROR', e.message || 'Internal error', e.details || {});
    const status = payload.error.code === 'INVALID_JSON' ? 400 : payload.error.code === 'ACCOUNT_LOCKED' ? 423 : payload.error.code === 'RESOURCE_EXHAUSTED' ? 429 : 400;
    kernel.endRequest(ctx, status);
    return send(res, status, payload, ctx.requestId);
  }
});

let _serverInstance = null;
if (require.main === module) {
  _serverInstance = app.listen(cfg.port, () => logger.info('server.listen', { port: cfg.port }));
}

const realtime = new RealtimeServer({ server: app, identity, docdb, rulesEngine });
const messagingDeviceServer = new DeviceServer({ server: app, service: messaging });
messaging.bindDeviceServer(messagingDeviceServer);

platform.bus.subscribe('auth.create', (entry) => {
  const evt = entry.payload || entry;
  functionsService.triggerAuthCreate(evt.projectId, evt);
});
platform.bus.subscribe('docdb.change', (entry) => {
  const evt = entry.payload || entry;
  functionsService.triggerDocWrite({
    projectId: evt.projectId || 'default-project',
    collection: evt.collection,
    docId: evt.docId,
    before: evt.oldDoc || null,
    after: evt.newDoc || null
  });
});

const graceful = attachGracefulShutdown(app, {
  timeoutMs: 5000,
  onBeforeClose: async () => {
    try { functionsService.close && functionsService.close(); } catch {}
    try { messaging.close && messaging.close(); } catch {}
    try { quotaEngine.usage && quotaEngine.usage.flush && quotaEngine.usage.flush('default-project'); } catch {}
  }
});
app.closeGracefully = graceful.closeGracefully;

module.exports = { app, kernel, tenants, identity, docdb, realtime, rulesEngine, functionsService, storageService, syncService, quotaEngine, emulator, clock, platform, iam, orgStore, serviceAccounts, billing, hosting, messaging, remoteconfig, appcheck, analytics, control, cfg };
