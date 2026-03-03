const { QuotaConfigStore } = require('./configStore');
const { SlidingCounter } = require('./rateLimit');
const { CountersStore } = require('./counters');
const { UsageEvents } = require('./usageEvents');
const { quotaError } = require('./errors');
const { append } = require('../functions/logs');

class QuotaEngine {
  constructor({ policyProvider = null } = {}) {
    this.cfg = new QuotaConfigStore();
    this.rate = new SlidingCounter(60);
    this.counters = new CountersStore();
    this.usage = new UsageEvents();
    this.policyProvider = policyProvider;
    this.metrics = { quota_denied_total: 0, quota_checked_total: 0, rate_limit_denied_total: 0, usage_events_written_total: 0, service_totals: {} };
  }
  _dayKey(ts = Date.now()) { return new Date(ts).toISOString().slice(0, 10); }
  _count(projectId, key, by = 1) {
    const st = this.counters.load(projectId);
    const d = this._dayKey();
    st.day[d] = st.day[d] || {};
    st.day[d][key] = (st.day[d][key] || 0) + by;
    st.totals[key] = (st.totals[key] || 0) + by;
    this.counters.save(projectId, st);
    return { day: st.day[d][key], total: st.totals[key] };
  }

  preCheck({ projectId, ip = 'unknown', uid = '', service = 'http', op = 'request', amount = 1 }) {
    this.metrics.quota_checked_total += 1;
    if (this.policyProvider) this.policyProvider({ projectId, service, op, amount });
    const cfg = this.cfg.get(projectId);
    const ipCount = this.rate.add(`ip:${projectId}:${ip}`, amount);
    const uidCount = uid ? this.rate.add(`uid:${projectId}:${uid}`, amount) : 0;
    const deny = (kind, current, limit) => {
      this.metrics.quota_denied_total += 1;
      this.metrics.rate_limit_denied_total += kind === 'rate' ? 1 : 0;
      append({ projectId, type: 'quota.denied', service, op, current, limit });
      throw quotaError('Quota exceeded', { service, op, current, limit, resetSec: 60 });
    };
    if (cfg.mode === 'enforce') {
      if (ipCount > cfg.rateLimit.ip.reqPerMin) deny('rate', ipCount, cfg.rateLimit.ip.reqPerMin);
      if (uid && uidCount > cfg.rateLimit.uid.reqPerMin) deny('rate', uidCount, cfg.rateLimit.uid.reqPerMin);
      if (service === 'functions' && op === 'invoke') {
        const v = this.rate.add(`svc:${projectId}:functions.invoke`, amount);
        if (v > cfg.limits.functions.invocationsPerMin) deny('svc', v, cfg.limits.functions.invocationsPerMin);
      }
      if (service === 'sync' && op === 'ops') {
        const v = this.rate.add(`svc:${projectId}:sync.ops`, amount);
        if (v > cfg.limits.sync.opsPerMin) deny('svc', v, cfg.limits.sync.opsPerMin);
      }
      if (service === 'storage' && op === 'ops') {
        const v = this.rate.add(`svc:${projectId}:storage.ops`, amount);
        if (v > cfg.limits.storage.opsPerMin) deny('svc', v, cfg.limits.storage.opsPerMin);
      }
      if (service === 'docdb' && op === 'read') {
        const v = this.rate.add(`svc:${projectId}:docdb.read`, amount);
        if (v > cfg.limits.docdb.readsPerMin) deny('svc', v, cfg.limits.docdb.readsPerMin);
      }
      if (service === 'docdb' && op === 'write') {
        const v = this.rate.add(`svc:${projectId}:docdb.write`, amount);
        if (v > cfg.limits.docdb.writesPerMin) deny('svc', v, cfg.limits.docdb.writesPerMin);
      }
    }
  }

  meter({ projectId, service, op, count = 1, bytes = 0, uid = '', ip = '', requestId = '' }) {
    this._count(projectId, `${service}.${op}.count`, count);
    if (bytes) this._count(projectId, `${service}.${op}.bytes`, bytes);
    this.metrics.service_totals[`${service}.${op}`] = (this.metrics.service_totals[`${service}.${op}`] || 0) + count;
    if (service === 'storage' && op === 'writeBytes') {
      const cfg = this.cfg.get(projectId);
      const c = this._count(projectId, 'storage.bytesWritePerDay', bytes).day;
      if (cfg.mode === 'enforce' && c > cfg.limits.storage.bytesWritePerDay) throw quotaError('Quota exceeded', { service, op, current: c, limit: cfg.limits.storage.bytesWritePerDay });
    }
    if (service === 'storage' && op === 'readBytes') {
      const cfg = this.cfg.get(projectId);
      const c = this._count(projectId, 'storage.bytesReadPerDay', bytes).day;
      if (cfg.mode === 'enforce' && c > cfg.limits.storage.bytesReadPerDay) throw quotaError('Quota exceeded', { service, op, current: c, limit: cfg.limits.storage.bytesReadPerDay });
    }
    this.metrics.usage_events_written_total += this.usage.append({ ts: Date.now(), projectId, service, op, count, bytes, uid, ip, requestId });
  }

  getQuota(projectId) { return this.cfg.get(projectId); }
  setQuota(projectId, cfg) { append({ projectId, type: 'quota.config.update' }); return this.cfg.set(projectId, cfg); }
  getUsage(projectId, from = 0, to = Date.now()) { return this.usage.read(projectId).filter((x) => x.ts >= Number(from) && x.ts <= Number(to)); }
}
module.exports = { QuotaEngine };
