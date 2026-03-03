const { hostingError } = require('./errors');

function parseHostingOrgPath(url) {
  const u = new URL(url, 'http://localhost');
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'v1' || parts[1] !== 'orgs') return null;
  if (parts[3] !== 'projects' || parts[5] !== 'hosting' || parts[6] !== 'sites') return null;
  return { u, parts, orgId: parts[2], projectId: parts[4], siteId: parts[7] };
}

function requireScope(iam, { orgId, projectId, actor, requestId }, preferred) {
  if (!actor || actor.kind === 'anonymous') throw hostingError('PERMISSION_DENIED', 'Missing required scope', { requiredScope: preferred, requestId });
  const iamActor = actor.kind === 'user' ? { kind: 'user', uid: actor.id } : { kind: 'service', id: actor.id, scopes: actor.scopes };
  try { iam.check({ orgId, projectId, actor: iamActor, requestId }, preferred); }
  catch {
    if (preferred === 'hosting.deploy') iam.check({ orgId, projectId, actor: iamActor, requestId }, 'hosting.admin');
    else throw hostingError('PERMISSION_DENIED', 'Missing required scope', { requiredScope: preferred, requestId });
  }
}

module.exports = { parseHostingOrgPath, requireScope };
