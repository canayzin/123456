const fs = require('fs');
const path = require('path');
const { AnalyticsStore } = require('./store');
const { AnalyticsCheckpoints } = require('./checkpoints');
const { AnalyticsAggregator } = require('./aggregator');
const { AnalyticsDashboard } = require('./dashboard');
const { CohortsState } = require('./cohorts');
const { createMetrics } = require('./metrics');
const { appendAudit } = require('./audit');
const { validatePayload } = require('./validator');
const { analyticsError } = require('./errors');

class AnalyticsService {
  constructor({ billing, quotaEngine, appcheck }) {
    this.billing = billing;
    this.quota = quotaEngine;
    this.appcheck = appcheck;
    this.metrics = createMetrics();
    this.store = new AnalyticsStore();
    this.checkpoints = new AnalyticsCheckpoints();
    this.cohortsState = new CohortsState();
    this.aggregator = new AnalyticsAggregator({ store: this.store, checkpoints: this.checkpoints, metrics: this.metrics, cohortsState: this.cohortsState });
    this.dashboard = new AnalyticsDashboard();
    this.timer = setInterval(() => this.runAll(), 1000);
    this.timer.unref();
  }

  close() { clearInterval(this.timer); }

  maxEventsPerDay(projectId) {
    const plan = this.billing.ensureProject(projectId).plan || 'free';
    if (plan === 'free') return 50000;
    if (plan === 'pro') return 500000;
    return 5000000;
  }

  _todayCount(projectId) {
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(process.cwd(), 'data', 'analytics', 'events', projectId, `${day}.ndjson`);
    try {
      const txt = fs.readFileSync(file, 'utf8');
      return txt.split('\n').filter((x) => x.trim()).length;
    } catch {
      return 0;
    }
  }

  ingest({ projectId, req, requestId, payload, bytes, uid = '', ip = '' }) {
    const hdrAppId = String(req.headers['x-app-id'] || '');
    const bodyAppId = String(payload.appId || '');
    if (hdrAppId && bodyAppId && hdrAppId !== bodyAppId) throw analyticsError('PERMISSION_DENIED', 'APP_ID_MISMATCH');
    const appId = hdrAppId || bodyAppId;
    if (!appId) throw analyticsError('INVALID_ARGUMENT', 'APP_ID_REQUIRED');

    const reqForAppCheck = hdrAppId ? req : { ...req, headers: { ...req.headers, 'x-app-id': appId } };
    const appCheck = this.appcheck.verifyForService(reqForAppCheck, { projectId, serviceKey: 'analytics.ingest' });

    const v = validatePayload(payload);
    if (!v.ok) {
      this.metrics.analytics_rejected_total += 1;
      appendAudit({ type: 'analytics.ingest.reject', projectId, requestId, reason: v.reason });
      throw analyticsError('INVALID_ARGUMENT', v.reason);
    }
    this.metrics.analytics_invalid_total += v.invalid;
    this.metrics.analytics_pii_rejected_total += Number(v.piiRejected || 0);
    if (v.piiRejected > 0) appendAudit({ type: 'analytics.ingest.pii', projectId, requestId, rejected: v.piiRejected, reasons: v.invalidReasons || {} });
    if (v.invalid > v.valid.length) {
      this.metrics.analytics_rejected_total += 1;
      appendAudit({ type: 'analytics.ingest.reject', projectId, requestId, reason: 'TOO_MANY_INVALID', invalid: v.invalid, reasons: v.invalidReasons || {} });
      throw analyticsError('INVALID_ARGUMENT', 'TOO_MANY_INVALID');
    }

    const limit = this.maxEventsPerDay(projectId);
    if ((this._todayCount(projectId) + v.valid.length) > limit) {
      this.metrics.analytics_rejected_total += 1;
      appendAudit({ type: 'analytics.ingest.reject', projectId, requestId, reason: 'ANALYTICS_DAILY_CAP_EXCEEDED', limit });
      throw analyticsError('RESOURCE_EXHAUSTED', 'ANALYTICS_DAILY_CAP_EXCEEDED', { limit });
    }

    const now = Date.now();
    const rows = v.valid.map((ev) => ({
      projectId,
      appId,
      platform: payload.platform || '',
      uid: payload.uid || '',
      deviceId: payload.deviceId || '',
      country: payload.country || '',
      name: ev.name,
      ts: Number(ev.ts),
      receivedAt: now,
      params: ev.params || {},
      requestId,
      region: req.headers['x-region'] || 'primary',
      appCheck: { mode: appCheck.mode, result: appCheck.result || 'skipped' }
    }));

    this.store.appendEvents(projectId, rows);
    this.metrics.analytics_batches_ingested_total += 1;
    this.metrics.analytics_events_ingested_total += rows.length;
    this.quota.preCheck({ projectId, ip, uid, service: 'analytics', op: 'ingest', amount: rows.length });
    this.quota.meter({ projectId, service: 'analytics', op: 'ingest', count: rows.length, bytes, uid, ip, requestId });
    return { accepted: rows.length, dropped: v.invalid };
  }

  run(projectId) { return this.aggregator.run(projectId); }

  runAll() {
    const dir = path.join(process.cwd(), 'data', 'analytics', 'events');
    if (!fs.existsSync(dir)) return;
    for (const projectId of fs.readdirSync(dir)) this.run(projectId);
  }

  projectSummary(projectId, from, to) { return this.dashboard.projectSummary(projectId, from, to); }
  projectHourly(projectId, date) { return this.dashboard.projectHourly(projectId, date); }
  projectCohorts(projectId, month) { return this.dashboard.projectCohorts(projectId, month); }
}

module.exports = { AnalyticsService };
