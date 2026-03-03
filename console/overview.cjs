function orgOverview({ control, orgStore, billing, analytics, messaging, quota, orgId, from, to }) {
  const org = control.getOrg(orgId) || orgStore.get(orgId) || { orgId, projects: {} };
  const projects = (control.listProjects(orgId) || []).sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)));
  const active = projects.filter((p) => p.status !== 'deleted');
  const deleted = projects.filter((p) => p.status === 'deleted');
  let totalEvents = 0; let totalSends = 0; let quotaDenies = 0;
  const topProjects = [];
  for (const p of active) {
    const sum = analytics.projectSummary(p.projectId, from, to);
    totalEvents += Number(sum.eventsTotal || 0);
    const m = messaging.status(p.projectId);
    totalSends += Number(m.queueDepth || 0);
    const q = quota.getUsage(p.projectId, Date.parse(`${from}T00:00:00.000Z`), Date.parse(`${to}T23:59:59.999Z`));
    quotaDenies += q.filter((x) => x.type === 'quota.denied').length;
    topProjects.push({ projectId: p.projectId, events: sum.eventsTotal || 0 });
  }
  topProjects.sort((a, b) => (b.events - a.events) || String(a.projectId).localeCompare(String(b.projectId)));
  return {
    org: { orgId: org.orgId || orgId, name: org.name || orgId, plan: org.plan || 'free', status: org.status || 'active' },
    projects: { active: active.length, deleted: deleted.length },
    billing: { revenueCents: 0, currentMonthEstimateCents: 0 },
    usage: { analyticsEvents: totalEvents, messagingSends: totalSends, storageBytes: 0, functionsInvocations: 0 },
    topProjects: topProjects.slice(0, 10),
    alerts: { budget: 0, quotaDenies, appcheckDenies: 0 }
  };
}

function projectOverview({ control, projectId, from, to, analytics, messaging, remoteconfig }) {
  const p = control.getProject(projectId) || { projectId, status: 'active', environment: 'dev', regionPrimary: 'us-east' };
  const a = analytics.projectSummary(projectId, from, to);
  const m = messaging.status(projectId);
  const versions = remoteconfig.versions(projectId, 1);
  return {
    project: { projectId: p.projectId, env: p.environment, region: p.regionPrimary, status: p.status },
    usage: a,
    billing: { plan: control.getOrg(p.orgId || 'default-org')?.plan || 'free', monthToDateEstimateCents: 0, lastInvoiceTotal: 0 },
    health: { realtimeConnectionsActive: 0, queueDepth: m.queueDepth || 0, storageObjectsCount: 0, recentErrors: 0 },
    config: { activeHostingReleaseId: '', remoteconfigVersion: versions[0]?.version || 0, appcheckEnforcementSummary: {} }
  };
}

module.exports = { orgOverview, projectOverview };
