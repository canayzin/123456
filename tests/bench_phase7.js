const { SyncService } = require('../sync/engine');
const { DocDbEngine } = require('../services/docdb');

async function main() {
  const s = new SyncService({ docdb: new DocDbEngine() });
  const actors = Array.from({ length: 50 }, (_, i) => `a${i}`);
  const ops = [];
  for (let i = 0; i < 1000; i += 1) {
    const actorId = actors[i % actors.length];
    ops.push({ opId: `b${i}`, actorId, projectId: 'bench', collection: 'c', docId: String(i % 20), lamport: Math.floor(i / 50) + 1, wallTime: i + 1, type: 'setField', field: `f${i % 5}`, value: i });
  }
  const t0 = Date.now();
  await s.applyOps(ops);
  const dt = Date.now() - t0;
  console.log(JSON.stringify({ actors: actors.length, ops: ops.length, ms: dt, metrics: s.metrics }, null, 2));
}
main();
