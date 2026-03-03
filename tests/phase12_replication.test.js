const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resetModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/platform/container') || key.includes('/services/docdb')) delete require.cache[key];
  }
}

function cleanup() {
  for (const p of ['data/outbox', 'data/replication', 'data/docdb.json']) {
    fs.rmSync(path.join(process.cwd(), p), { recursive: true, force: true });
  }
}

test('phase12 replication primary/secondary consistency failover and stream', async () => {
  cleanup();
  resetModules();
  const { getPlatform } = require('../platform/container');
  const { DocDbEngine } = require('../services/docdb');

  const platform = getPlatform();
  platform.stop();
  const db = new DocDbEngine({ projectId: 'p12' });

  const stream = [];
  const unsub = platform.replication.subscribeChangeStream('p12', 0, (e) => stream.push(e));

  platform.replication.setLag(500);
  db.collection('todos').doc('1').set({ title: 'v1', _projectId: 'p12' });
  platform.worker.tick();
  assert.equal(platform.metrics.replication_events_total >= 1, true);
  assert.equal(platform.metrics.replication_queue_depth >= 1, true);

  const strongDoc = platform.replication.readDoc('p12', 'todos', '1', () => db.collection('todos').doc('1').get());
  assert.equal(strongDoc.title, 'v1');

  platform.replication.setConsistency('eventual');
  const eventualBefore = platform.replication.readDoc('p12', 'todos', '1', () => db.collection('todos').doc('1').get());
  assert.equal(eventualBefore, null);

  platform.replication.setLag(0);
  await platform.worker.tick();
  const eventualAfter = platform.replication.readDoc('p12', 'todos', '1', () => db.collection('todos').doc('1').get());
  assert.equal(eventualAfter.title, 'v1');

  platform.replication.setConsistency('strong');
  const failover = platform.replication.failover('node-2');
  assert.equal(failover.primaryNodeId, 'node-2');
  assert.equal(platform.metrics.failover_count >= 1, true);

  db.collection('todos').doc('2').set({ title: 'v2', _projectId: 'p12' });
  await platform.worker.tick();

  assert.equal(stream.length >= 2, true);
  for (let i = 1; i < stream.length; i += 1) {
    assert.equal(stream[i].version >= stream[i - 1].version, true);
  }

  const repFile = path.join(process.cwd(), 'data', 'replication', 'p12.ndjson');
  assert.equal(fs.existsSync(repFile), true);
  const rows = fs.readFileSync(repFile, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x));
  assert.equal(rows.length >= 2, true);

  resetModules();
  const { createPlatform } = require('../platform/container');
  const restored = createPlatform({ nodeId: 'node-1', leaderId: 'node-1' });
  restored.replication.setConsistency('eventual');
  const restoredDoc = restored.replication.readDoc('p12', 'todos', '2', () => null);
  assert.equal(restoredDoc.title, 'v2');

  assert.equal(platform.metrics.replication_lag_ms >= 0, true);
  assert.equal(platform.replication.p95Replay() >= 0, true);

  unsub();
  platform.stop();
  restored.stop();
});
