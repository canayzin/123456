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
  for (const p of ['data/outbox', 'data/replication', 'data/snapshots', 'data/docdb.json']) {
    fs.rmSync(path.join(process.cwd(), p), { recursive: true, force: true });
  }
}

test('phase13 multi-region + dr simulation', async () => {
  cleanup();
  resetModules();
  const { getPlatform, createPlatform } = require('../platform/container');
  const { DocDbEngine } = require('../services/docdb');

  const platform = getPlatform();
  platform.stop();
  const db = new DocDbEngine({ projectId: 'p13' });

  platform.replication.setReadMode('strongPrimary');
  platform.replication.setCrossRegionDelay(500);
  db.collection('todos').doc('1').set({ title: 'r1', _projectId: 'p13' });
  await platform.worker.tick();

  const strong = platform.replication.regionReadDoc('p13', 'todos', '1', () => db.collection('todos').doc('1').get(), 'eu-west');
  assert.equal(strong.title, 'r1');

  platform.replication.setReadMode('localRegion');
  const localBefore = platform.replication.regionReadDoc('p13', 'todos', '1', () => db.collection('todos').doc('1').get(), 'eu-west');
  assert.equal(localBefore, null);
  assert.equal(platform.metrics.cross_region_queue_depth >= 1, true);

  platform.replication.setCrossRegionDelay(0);
  await platform.worker.tick();
  const localAfter = platform.replication.regionReadDoc('p13', 'todos', '1', () => db.collection('todos').doc('1').get(), 'eu-west');
  assert.equal(localAfter.title, 'r1');

  const snap = platform.replication.createSnapshot('us-east');
  assert.equal(fs.existsSync(snap.path), true);

  db.collection('todos').doc('2').set({ title: 'r2', _projectId: 'p13' });
  await platform.worker.tick();

  // restore snapshot then rebuild platform from logs
  platform.replication.restoreSnapshot('us-east', snap.ts);
  const repFile = path.join(process.cwd(), 'data/replication', 'p13.ndjson');
  const rowsAfterRestore = fs.readFileSync(repFile, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x));
  assert.equal(rowsAfterRestore.length >= 1, true);

  const fail = platform.replication.regionFailover('eu-west');
  assert.equal(fail.primaryRegion, 'eu-west');
  assert.equal(platform.metrics.failover_count >= 1, true);

  platform.worker.tick();
  assert.equal(platform.metrics.rpo_seconds >= 0, true);
  assert.equal(platform.metrics.rto_seconds_last_failover >= 0, true);
  assert.equal(typeof platform.metrics.region_primary, 'string');
  assert.equal(typeof platform.metrics.region_health_status, 'object');

  resetModules();
  const restored = createPlatform({ nodeId: 'node-1', leaderId: 'node-1' });
  const recoveredRows = restored.replication.recover('p13');
  assert.equal(recoveredRows >= 1, true);

  platform.stop();
  restored.stop();
});
