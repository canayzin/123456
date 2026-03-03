function normalizePlan(plan) {
  if (plan === 'pro' || plan === 'enterprise') return plan;
  return 'free';
}

module.exports = { normalizePlan };
