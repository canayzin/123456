function dayRange(from, to) {
  const out = [];
  let d = new Date(`${from}T00:00:00.000Z`);
  const e = new Date(`${to}T00:00:00.000Z`);
  while (d <= e) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

class UsageService {
  constructor({ billing, analytics, messaging, quota, projectsStore }) {
    this.billing = billing;
    this.analytics = analytics;
    this.messaging = messaging;
    this.quota = quota;
    this.projectsStore = projectsStore;
  }

  projectUsage(projectId, from, to) {
    const billing = this.billing.usageSummary(projectId, Date.parse(`${from}T00:00:00.000Z`), Date.parse(`${to}T23:59:59.999Z`));
    const analytics = this.analytics.projectSummary(projectId, from, to);
    const msg = this.messaging.status(projectId);
    const q = this.quota.getUsage(projectId, Date.parse(`${from}T00:00:00.000Z`), Date.parse(`${to}T23:59:59.999Z`));
    const usage = { billing, analytics, messaging: msg, storageBytes: 0, functionsInvocations: 0, quotaDenies: q.filter((x) => x.type === 'quota.denied').length };
    return usage;
  }

  orgOverview(orgId, from, to) {
    const projects = this.projectsStore.listByOrg(orgId).filter((x) => x.status !== 'deleted');
    const rows = projects.map((p) => ({ projectId: p.projectId, usage: this.projectUsage(p.projectId, from, to) }));
    const totalEvents = rows.reduce((a, x) => a + Number(x.usage.analytics.eventsTotal || 0), 0);
    const totalSends = rows.reduce((a, x) => a + Number(x.usage.messaging.queueDepth || 0), 0);
    const topProjects = rows.sort((a, b) => (b.usage.analytics.eventsTotal || 0) - (a.usage.analytics.eventsTotal || 0)).slice(0, 5);
    return { orgId, from, to, activeProjects: projects.length, totalRevenue: 0, totalEvents, totalSends, topProjects };
  }
}

module.exports = { UsageService, dayRange };
