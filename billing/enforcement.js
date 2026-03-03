const { quotaError } = require('../quota/errors');

class BillingEnforcement {
  constructor({ plansStore, projectStore }) { this.plansStore = plansStore; this.projectStore = projectStore; }
  policy(projectId, service, op, amount = 1) {
    const state = this.projectStore.get(projectId);
    const plan = state.plan || 'free';
    const caps = this.plansStore.get(plan).hardCaps || {};
    if (plan === 'free') {
      const map = {
        'docdb.read': 'docdb.readsPerMonth',
        'docdb.write': 'docdb.writesPerMonth',
        'storage.writeBytes': 'storage.bytesWritePerMonth',
        'storage.readBytes': 'storage.bytesReadPerMonth',
        'functions.invoke': 'functions.invocationsPerMonth',
        'sync.ops': 'sync.opsPerMonth'
      };
      const key = map[`${service}.${op}`];
      if (key && caps[key] != null) {
        const cur = Number(state.monthState.usage[key] || 0);
        if (cur + Number(amount || 0) > Number(caps[key])) {
          throw quotaError('Quota exceeded', { billing: { plan, limit: caps[key], resetMonth: state.monthState.currentMonth }, service, op, current: cur, limit: caps[key] });
        }
      }
    }
    return { plan, allowOverage: plan !== 'free' };
  }
}

module.exports = { BillingEnforcement };
