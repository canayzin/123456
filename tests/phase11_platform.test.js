const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FileStore } = require('../platform/store/fileStore');
const { MemoryStore } = require('../platform/store/memoryStore');
const { createPlatform } = require('../platform/container');
const { DocDbEngine } = require('../services/docdb');

function cleanup() {
  for (const p of ['data/outbox', 'data/platform-store', 'data/docdb.json']) {
    fs.rmSync(path.join(process.cwd(), p), { recursive: true, force: true });
  }
}

test('phase11 distributed abstraction layer gates', async () => {
  cleanup();

  const f = new FileStore(path.join(process.cwd(), 'data', 'platform-store'));
  const m = new MemoryStore();
  f.atomicWrite('a.json', { x: 1 });
  m.atomicWrite('k', { y: 2 });
  assert.equal(f.read('a.json').x, 1);
  assert.equal(m.read('k').y, 2);

  const platform = createPlatform({ nodeId: 'n1', leaderId: 'n1' });
  const seen = [];
  platform.bus.subscribe('docdb.change', (e) => seen.push(e));

  const db = new DocDbEngine({ projectId: 'p11' });
  db.collection('todos').doc('1').set({ title: 'x' });
  const outboxFile = path.join(process.cwd(), 'data', 'outbox', 'p11.ndjson');
  assert.equal(fs.existsSync(outboxFile), true);

  await platform.worker.tick();
  assert.ok(seen.length >= 1);

  let leaderRuns = 0;
  const platformFollower = createPlatform({ nodeId: 'n2', leaderId: 'n1' });
  platformFollower.worker.leaderJob = async () => { leaderRuns += 1; };
  await platformFollower.worker.tick();
  assert.equal(leaderRuns, 0);

  let attempts = 0;
  platform.queue.enqueue({ id: 'job1', maxRetries: 2, handler: async () => { attempts += 1; if (attempts < 2) throw new Error('boom'); } });
  await platform.worker.tick();
  await platform.worker.tick();
  assert.equal(attempts, 2);

  const r1 = platform.router.route({ projectId: 'p11' });
  const r2 = platform.router.route({ projectId: 'p11' });
  assert.equal(r1, r2);

  assert.ok(platform.metrics.outboxSize >= 1);
  assert.ok(Array.isArray(platform.metrics.publishLatencyMs));
});
