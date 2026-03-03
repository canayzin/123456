class PricingEngine {
  estimateCents(planName, plan, usage = {}) {
    if (planName === 'free') return 0;
    let cents = Number(plan.pricePerMonth || 0);
    if (planName === 'enterprise') return cents;
    const add = (n, rate) => { cents += Math.round(Number(n || 0) * Number(rate || 0)); };
    add(usage['docdb.readsPerMonth'], plan.overage['docdb.read']);
    add(usage['docdb.writesPerMonth'], plan.overage['docdb.write']);
    add((usage['storage.bytesWritePerMonth'] || 0) / (1024 ** 3), plan.overage['storage.gbWrite']);
    add((usage['storage.bytesReadPerMonth'] || 0) / (1024 ** 3), plan.overage['storage.gbRead']);
    add(usage['functions.invocationsPerMonth'], plan.overage['functions.invocation']);
    add(usage['ws.messagesPerMonth'], plan.overage['ws.message']);
    add(usage['sync.opsPerMonth'], plan.overage['sync.op']);
    return cents;
  }
}

module.exports = { PricingEngine };
