const { orgOverview, projectOverview } = require('./overview.cjs');
const { analyticsEventsSeries, flatZeroSeries } = require('./charts.cjs');
const { projectsList, apiKeysList, hostingReleases, remoteConfigVersions } = require('./lists.cjs');
const { projectLogs } = require('./logs.cjs');
const { usageExport, analyticsExport, invoicesExport } = require('./exports.cjs');

function routeConsole({ req, res, send, ctx, services }) {
  const { control, analytics, messaging, remoteconfig, quotaEngine, billing, orgStore, iam, identityCtx, resolveActor } = services;
  const u = new URL(req.url, 'http://localhost');
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'v1' || parts[1] !== 'console') return false;

  const requireActor = (orgId, projectId, scope) => {
    const actor = resolveActor({ ...identityCtx, orgId, projectId });
    if (actor.kind === 'anonymous') throw Object.assign(new Error('Missing required scope'), { code: 'PERMISSION_DENIED', details: { requiredScope: scope, requestId: ctx.requestId } });
    const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };
    iam.check({ orgId, projectId, actor: iamActor, requestId: ctx.requestId }, scope);
    return actor;
  };

  if (req.method === 'GET' && parts[2] === 'orgs' && parts[4] === 'overview') {
    const orgId = parts[3];
    requireActor(orgId, req.headers['x-project'] || 'default-project', 'console.read');
    const from = u.searchParams.get('from') || new Date().toISOString().slice(0, 10);
    const to = u.searchParams.get('to') || from;
    return send(res, 200, orgOverview({ control, orgStore, billing, analytics, messaging, quota: quotaEngine, orgId, from, to }), ctx.requestId), true;
  }

  if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'overview') {
    const projectId = parts[3];
    const project = control.getProject(projectId) || { orgId: req.headers['x-organization'] || 'default-org' };
    requireActor(project.orgId, projectId, 'console.read');
    const from = u.searchParams.get('from') || new Date().toISOString().slice(0, 10);
    const to = u.searchParams.get('to') || from;
    return send(res, 200, projectOverview({ control, projectId, from, to, analytics, messaging, remoteconfig }), ctx.requestId), true;
  }

  if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'charts') {
    const projectId = parts[3];
    const chartType = parts[5];
    requireActor((control.getProject(projectId)?.orgId) || req.headers['x-organization'] || 'default-org', projectId, 'console.read');
    const from = u.searchParams.get('from') || new Date().toISOString().slice(0, 10);
    const to = u.searchParams.get('to') || from;
    if (chartType === 'analytics' && parts[6] === 'events') return send(res, 200, analyticsEventsSeries(projectId, from, to), ctx.requestId), true;
    if (chartType === 'messaging') return send(res, 200, flatZeroSeries(from, to, ['sends', 'delivered', 'failed', 'dlq', 'retries']), ctx.requestId), true;
    if (chartType === 'storage') return send(res, 200, flatZeroSeries(from, to, ['bytesWritten', 'bytesRead']), ctx.requestId), true;
    if (chartType === 'billing') return send(res, 200, flatZeroSeries(from, to, ['estimatedCents', 'invoiceCents']), ctx.requestId), true;
  }

  if (req.method === 'GET' && parts[2] === 'orgs' && parts[4] === 'projects') {
    const orgId = parts[3];
    requireActor(orgId, req.headers['x-project'] || 'default-project', 'console.read');
    return send(res, 200, projectsList(control, orgId, { status: u.searchParams.get('status') || 'all', limit: u.searchParams.get('limit'), cursor: u.searchParams.get('cursor') || '' }), ctx.requestId), true;
  }

  if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'apikeys') {
    const projectId = parts[3];
    requireActor((control.getProject(projectId)?.orgId) || req.headers['x-organization'] || 'default-org', projectId, 'console.read');
    return send(res, 200, apiKeysList(control, projectId, { limit: u.searchParams.get('limit'), cursor: u.searchParams.get('cursor') || '' }), ctx.requestId), true;
  }

  if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'hosting' && parts[5] === 'releases') {
    const projectId = parts[3];
    requireActor((control.getProject(projectId)?.orgId) || req.headers['x-organization'] || 'default-org', projectId, 'console.read');
    return send(res, 200, hostingReleases(projectId, u.searchParams.get('siteId') || 'default', { limit: u.searchParams.get('limit'), cursor: u.searchParams.get('cursor') || '' }), ctx.requestId), true;
  }

  if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'remoteconfig' && parts[5] === 'versions') {
    const projectId = parts[3];
    requireActor((control.getProject(projectId)?.orgId) || req.headers['x-organization'] || 'default-org', projectId, 'console.read');
    return send(res, 200, remoteConfigVersions(remoteconfig, projectId, { limit: u.searchParams.get('limit'), cursor: u.searchParams.get('cursor') || '' }), ctx.requestId), true;
  }

  
  if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'messaging' && parts[5] === 'receipts') {
    const projectId = parts[3];
    requireActor((control.getProject(projectId)?.orgId) || req.headers['x-organization'] || 'default-org', projectId, 'logs.read');
    const rows = (messaging.listReceipts(projectId) || []).map((x) => ({ ...x, id: x.id || '' }));
    rows.sort((a, b) => (Number(b.ts || 0) - Number(a.ts || 0)) || String(a.id).localeCompare(String(b.id)));
    const { paginate } = require('./pagination.cjs');
    return send(res, 200, paginate(rows, { limit: u.searchParams.get('limit'), cursor: u.searchParams.get('cursor') || '' }), ctx.requestId), true;
  }

  if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'messaging' && parts[5] === 'dlq') {
    const projectId = parts[3];
    requireActor((control.getProject(projectId)?.orgId) || req.headers['x-organization'] || 'default-org', projectId, 'logs.read');
    const rows = (messaging.listDLQ(projectId) || []).map((x) => ({ ...x, id: x.id || '' }));
    rows.sort((a, b) => (Number(b.ts || 0) - Number(a.ts || 0)) || String(a.id).localeCompare(String(b.id)));
    const { paginate } = require('./pagination.cjs');
    return send(res, 200, paginate(rows, { limit: u.searchParams.get('limit'), cursor: u.searchParams.get('cursor') || '' }), ctx.requestId), true;
  }

  if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'appcheck' && parts[5] === 'denies') {
    const projectId = parts[3];
    requireActor((control.getProject(projectId)?.orgId) || req.headers['x-organization'] || 'default-org', projectId, 'logs.read');
    const { readNdjson } = require('./sources/ndjsonReader.cjs');
    const path = require('path');
    const rows = readNdjson(path.join(process.cwd(), 'data', 'appcheck', 'audit.ndjson')).filter((x) => x.projectId === projectId && x.type === 'verify.deny');
    rows.sort((a, b) => (Number(b.ts || 0) - Number(a.ts || 0)) || String(a.appId || '').localeCompare(String(b.appId || '')));
    const { paginate } = require('./pagination.cjs');
    return send(res, 200, paginate(rows, { limit: u.searchParams.get('limit'), cursor: u.searchParams.get('cursor') || '' }), ctx.requestId), true;
  }

if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'logs') {
    const projectId = parts[3];
    requireActor((control.getProject(projectId)?.orgId) || req.headers['x-organization'] || 'default-org', projectId, 'logs.read');
    return send(res, 200, projectLogs(projectId, { type: u.searchParams.get('type') || 'audit', from: Number(u.searchParams.get('from') || 0), to: Number(u.searchParams.get('to') || Date.now()), limit: u.searchParams.get('limit'), cursor: u.searchParams.get('cursor') || '' }), ctx.requestId), true;
  }

  if (req.method === 'GET' && parts[2] === 'projects' && parts[4] === 'exports') {
    const projectId = parts[3];
    requireActor((control.getProject(projectId)?.orgId) || req.headers['x-organization'] || 'default-org', projectId, 'exports.read');
    const kind = parts[5];
    const format = u.searchParams.get('format') || 'json';
    res.writeHead(200, { 'content-type': format === 'ndjson' ? 'application/x-ndjson' : 'application/json', 'x-request-id': ctx.requestId });
    if (kind === 'usage') { res.end(usageExport(quotaEngine, projectId, Number(u.searchParams.get('from') || 0), Number(u.searchParams.get('to') || Date.now()), format)); return true; }
    if (kind === 'analytics') { res.end(analyticsExport(projectId, u.searchParams.get('date') || new Date().toISOString().slice(0, 10), format)); return true; }
    if (kind === 'invoices') { res.end(invoicesExport(projectId, u.searchParams.get('month') || new Date().toISOString().slice(0, 7), format)); return true; }
  }

  return false;
}

module.exports = { routeConsole };
