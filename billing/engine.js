const fs = require('fs');
const path = require('path');
const { PlansStore } = require('./plansStore');
const { ProjectStore } = require('./projectStore');
const { Checkpoints } = require('./checkpoints');
const { BillingAggregator } = require('./aggregator');
const { PricingEngine } = require('./pricing');
const { BudgetEngine } = require('./budgets');
const { BillingEnforcement } = require('./enforcement');
const { appendAudit } = require('./audit');

class BillingEngine {
  constructor() {
    this.plans = new PlansStore();
    this.projects = new ProjectStore();
    this.checkpoints = new Checkpoints();
    this.aggregator = new BillingAggregator({ checkpoints: this.checkpoints, projectStore: this.projects });
    this.pricing = new PricingEngine();
    this.metrics = {
      billing_invoices_generated_total: 0,
      billing_aggregation_runs_total: 0,
      billing_budget_alerts_total: 0,
      billing_plan_changes_total: 0,
      billing_overage_cents_total: 0,
      billing_usage_events_processed_total: 0
    };
    this.budgets = new BudgetEngine(this.metrics);
    this.enforcement = new BillingEnforcement({ plansStore: this.plans, projectStore: this.projects });
  }

  ensureProject(projectId, orgId = 'default-org') { return this.projects.get(projectId, orgId); }

  runAggregation(projectId) {
    const out = this.aggregator.run(projectId);
    this.metrics.billing_aggregation_runs_total += 1;
    this.metrics.billing_usage_events_processed_total += out.processed;
    appendAudit({ orgId: this.projects.get(projectId).orgId, projectId, actor: 'system', type: 'aggregation.run', details: { processed: out.processed } });
    return out;
  }

  setBilling(projectId, orgId, update, actor = 'system', requestId = '') {
    const st = this.projects.get(projectId, orgId);
    if (update.plan) st.plan = update.plan;
    if (update.budget) st.budget = { ...st.budget, ...update.budget };
    this.projects.save(projectId, st);
    this.metrics.billing_plan_changes_total += update.plan ? 1 : 0;
    appendAudit({ orgId, projectId, actor, requestId, type: 'plan.change', details: update });
    return st;
  }

  generateInvoice(projectId, month, actor = 'system', requestId = '') {
    this.runAggregation(projectId);
    const st = this.projects.get(projectId);
    const planCfg = this.plans.get(st.plan);
    const usage = st.monthState.usage || {};
    const totalCents = this.pricing.estimateCents(st.plan, planCfg, usage);
    const invoice = { month: month || st.monthState.currentMonth, plan: st.plan, totalCents, total: (totalCents / 100).toFixed(2), usage };
    const dir = path.join(process.cwd(), 'data', 'billing', 'invoices', projectId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${invoice.month}.json`);
    fs.writeFileSync(file, JSON.stringify(invoice, null, 2));
    st.monthState.invoice = invoice;
    st.monthState.charges = { totalCents };
    this.projects.save(projectId, st);
    this.budgets.check(st, totalCents, { actor, requestId });
    this.metrics.billing_invoices_generated_total += 1;
    this.metrics.billing_overage_cents_total += Math.max(0, totalCents - Number(planCfg.pricePerMonth || 0));
    appendAudit({ orgId: st.orgId, projectId, actor, requestId, type: 'invoice.generate', details: invoice });
    return invoice;
  }

  getAlerts(projectId, month) {
    const st = this.projects.get(projectId);
    return { month: month || st.monthState.currentMonth, alerts: st.budget.lastAlerted[month || st.monthState.currentMonth] || [] };
  }

  usageSummary(projectId, from, to) { this.runAggregation(projectId); return this.aggregator.summary(projectId, from, to); }

  policyProvider() {
    return ({ projectId, service, op, amount }) => this.enforcement.policy(projectId, service, op, amount);
  }
}

module.exports = { BillingEngine };
