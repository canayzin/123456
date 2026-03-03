const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FirestoreEngine } = require('../services/docdb/transactionManager');
const { WriteAheadLog } = require('../services/docdb/wal');

test('phase10 wal recovery smoke + half-written marker ignored', async () => {
  const dbFile = path.join(process.cwd(), 'data', 'firestore-docdb.json');
  const walFile = path.join(process.cwd(), 'data', 'docdb.wal.log');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.writeFileSync(dbFile, JSON.stringify({ collections: {} }, null, 2));
  fs.writeFileSync(walFile, '');

  const db = new FirestoreEngine();
  db.setDoc('todos', '1', { title: 'ok' });
  const wal = new WriteAheadLog(walFile);
  wal.append({ type: 'BEGIN_TX', txId: 'dangling' });

  const reloaded = new FirestoreEngine();
  const doc = reloaded.getDoc('todos', '1');
  assert.equal(doc.title, 'ok');

  const rows = wal.replay();
  const dangling = rows.filter((x) => x.txId === 'dangling');
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].type, 'BEGIN_TX');
});
