function ensureMember(orgStore, orgId, projectId, uid) {
  const org = orgStore.get(orgId);
  const members = org?.projects?.[projectId]?.members || [];
  return members.some((m) => m.uid === uid);
}

function requireScope({ iam, orgId, projectId, actor, scope, requestId }) {
  iam.check({ orgId, projectId, actor, requestId }, scope);
}

module.exports = { ensureMember, requireScope };
