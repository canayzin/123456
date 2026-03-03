const { QuotaEngine } = require('../quota/engine');

function main() {
  const q = new QuotaEngine();
  q.setQuota('bench', { ...q.getQuota('bench'), mode: 'observe' });
  const n = 1000;
  const t0 = Date.now();
  for (let i = 0; i < n; i += 1) {
    q.preCheck({ projectId: 'bench', ip: `ip${i % 10}`, uid: `u${i % 20}`, service: 'docdb', op: 'read', amount: 1 });
    q.meter({ projectId: 'bench', service: 'docdb', op: 'read', count: 1, requestId: `r${i}` });
  }
  const dt = Date.now() - t0;
  console.log(JSON.stringify({ requests: n, ms: dt, perReqMs: dt / n, metrics: q.metrics }, null, 2));
}
main();
