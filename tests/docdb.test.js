const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DocDbEngine } = require('../services/docdb');

const dbPath = path.join(process.cwd(), 'data', 'docdb.json');

function reset() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify({ collections: {}, indexes: {} }));
}

test('docdb set/get/update/delete and query', () => {
  reset();
  const db = new DocDbEngine();
  db.collection('todos').doc('1').set({ title: 'A', owner: 'u1', rank: 2 });
  db.collection('todos').doc('2').set({ title: 'B', owner: 'u1', rank: 1 });
  const one = db.collection('todos').doc('1').get();
  assert.equal(one.title, 'A');
  db.collection('todos').doc('1').update({ done: true });
  assert.equal(db.collection('todos').doc('1').get().done, true);
  const result = db.collection('todos').where('owner', '==', 'u1').orderBy('rank', 'asc').limit(1).get();
  assert.equal(result.docs.length, 1);
  assert.equal(result.docs[0].id, '2');
  db.collection('todos').doc('2').delete();
  assert.equal(db.collection('todos').doc('2').get(), null);
});

test('docdb onSnapshot emits updates', async () => {
  reset();
  const db = new DocDbEngine();
  const done = new Promise((resolve) => {
    const unsub = db.collection('todos').doc('x').onSnapshot((doc) => {
      assert.equal(doc.title, 'snap');
      unsub();
      resolve();
    });
  });
  db.collection('todos').doc('x').set({ title: 'snap' });
  await done;
});


test('docdb emits change and collection hooks for realtime', () => {
  reset();
  const db = new DocDbEngine({ projectId: 'p1' });
  const changes = [];
  const collections = [];
  db.events.on('docdb:change', (evt) => changes.push(evt));
  db.events.on('docdb:collectionChange', (evt) => collections.push(evt));

  db.collection('todos').doc('1').set({ title: 'A' });
  db.collection('todos').doc('1').update({ title: 'B' });
  db.collection('todos').doc('1').delete();

  assert.equal(changes.length, 3);
  assert.equal(collections.length, 3);
  assert.equal(changes[0].type, 'set');
  assert.equal(changes[1].type, 'update');
  assert.equal(changes[2].type, 'delete');
  assert.equal(changes[0].projectId, 'p1');
  assert.equal(collections[0].collection, 'todos');
});
