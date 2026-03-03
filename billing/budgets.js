const { appendAudit } = require('./audit');

class BudgetEngine {
  constructor(metrics) { this.metrics = metrics; }
  check(state, cents, ctx = {}) {
    const month = state.monthState.currentMonth;
    state.budget.lastAlerted[month] = state.budget.lastAlerted[month] || [];
    const fired = [];
    for (const t of state.budget.alerts || []) {
      if (state.budget.lastAlerted[month].includes(t)) continue;
      if (cents >= Math.round((state.budget.monthlyLimit || 0) * 100 * t)) {
        state.budget.lastAlerted[month].push(t);
        fired.push(t);
        this.metrics.billing_budget_alerts_total += 1;
        appendAudit({ orgId: state.orgId, projectId: state.projectId, actor: ctx.actor || 'system', type: 'budget.alert', requestId: ctx.requestId || '', details: { threshold: t, cents } });
      }
    }
    return fired;
  }
}

module.exports = { BudgetEngine };
