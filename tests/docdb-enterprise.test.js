const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FirestoreEngine } = require('../services/docdb/transactionManager');
const { FieldValue } = require('../services/docdb/transforms');

const files = [
  path.join(process.cwd(), 'data', 'firestore-docdb.json'),
  path.join(process.cwd(), 'data', 'docdb.wal.log')
];

function reset() {
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
  fs.writeFileSync(files[0], JSON.stringify({ collections: {} }));
  fs.writeFileSync(files[1], '');
}

test('composite index + explain + query planner', () => {
  reset();
  const db = new FirestoreEngine();
  db.createIndex({ collection: 'todos', fields: [{ field: 'owner', direction: 'ASC' }, { field: 'rank', direction: 'DESC' }] });
  db.setDoc('todos', '1', { owner: 'u1', rank: 1 });
  db.setDoc('todos', '2', { owner: 'u1', rank: 2 });
  const out = db.query('todos', { where: [{ field: 'owner', op: '==', value: 'u1' }], orderBy: [{ field: 'rank', direction: 'desc' }], limit: 1 });
  assert.equal(out.docs[0].id, '2');
  assert.equal(out.explain.strategy, 'index');
  assert.ok(out.explain.usedIndex);
});

test('rollback on batch failure', () => {
  reset();
  const db = new FirestoreEngine();
  db.setDoc('todos', '1', { owner: 'u1' });
  assert.throws(() => db.batchWrite([
    { op: 'set', collection: 'todos', id: '2', data: { owner: 'u1' }, context: {} },
    { op: 'update', collection: 'todos', id: 'not-exists', patch: { a: 1 }, transforms: {}, context: {} }
  ]));
  assert.equal(db.getDoc('todos', '2'), null);
});

test('field transforms work', () => {
  reset();
  const db = new FirestoreEngine();
  db.setDoc('todos', '1', { n: 1, tags: ['a'] });
  db.updateDoc('todos', '1', {}, {
    n: FieldValue.increment(5),
    tags: FieldValue.arrayUnion('b', 'a'),
    removed: FieldValue.arrayRemove('x'),
    updatedAt: FieldValue.serverTimestamp()
  });
  const doc = db.getDoc('todos', '1');
  assert.equal(doc.n, 6);
  assert.deepEqual(doc.tags, ['a', 'b']);
  assert.ok(typeof doc.updatedAt === 'number');
});

test('cursor deterministic', () => {
  reset();
  const db = new FirestoreEngine();
  for (let i = 1; i <= 5; i += 1) db.setDoc('todos', String(i), { rank: i });
  const page1 = db.query('todos', { orderBy: [{ field: 'rank', direction: 'asc' }], limit: 2 });
  const page2 = db.query('todos', { orderBy: [{ field: 'rank', direction: 'asc' }], startAfter: page1.nextCursor, limit: 2 });
  assert.deepEqual(page1.docs.map((d) => d.rank), [1, 2]);
  assert.deepEqual(page2.docs.map((d) => d.rank), [3, 4]);
});

test('rules rejection deny-before-return', () => {
  reset();
  const db = new FirestoreEngine({
    rules: {
      canRead: ({ data, context }) => data.owner === context.uid,
      canWrite: ({ data, context }) => !data || data.owner === context.uid
    }
  });
  db.setDoc('todos', '1', { owner: 'u1', x: 1 }, { uid: 'u1' });
  db.setDoc('todos', '2', { owner: 'u2', x: 1 }, { uid: 'u2' });
  const out = db.query('todos', { where: [{ field: 'x', op: '==', value: 1 }] }, { uid: 'u1' });
  assert.deepEqual(out.docs.map((d) => d.id), ['1']);
  assert.throws(() => db.setDoc('todos', '3', { owner: 'u2' }, { uid: 'u1' }));
});

test('concurrency conflict + wal replay visibility', async () => {
  reset();
  const db = new FirestoreEngine();
  db.setDoc('todos', '1', { x: 1 });
  const tx = db.beginTransaction();
  const api = db._txApi(tx);
  api.get('todos', '1');
  db.updateDoc('todos', '1', { x: 2 }, {});
  api.update('todos', '1', { x: 3 }, {});
  assert.throws(() => db._commitTx(tx));
  const wal = db.wal.replay();
  assert.ok(Array.isArray(wal));
});

test('10k docs indexed query latency less than scan in plan cost', () => {
  reset();
  const db = new FirestoreEngine();
  for (let i = 0; i < 10000; i += 1) db.setDoc('bulk', String(i), { owner: i % 10, rank: i });
  const scanExplain = db.explain('bulk', { where: [{ field: 'owner', op: '==', value: 3 }] });
  db.createIndex({ collection: 'bulk', fields: [{ field: 'owner', direction: 'ASC' }, { field: 'rank', direction: 'ASC' }] });
  const idxExplain = db.explain('bulk', { where: [{ field: 'owner', op: '==', value: 3 }], orderBy: [{ field: 'rank', direction: 'asc' }] });
  assert.equal(scanExplain.strategy, 'scan');
  assert.equal(idxExplain.strategy, 'index');
  assert.ok(idxExplain.estimatedCost < scanExplain.estimatedCost);
});
