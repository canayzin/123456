const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { IndexEngine } = require('./indexEngine');
const { QueryPlanner } = require('./queryPlanner');
const { WriteAheadLog } = require('./wal');
const { applyTransforms } = require('./transforms');

const DB_FILE = path.join(process.cwd(), 'data', 'firestore-docdb.json');

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { collections: {} };
  }
}

function writeDb(data) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

class FirestoreEngine {
  constructor({ rules } = {}) {
    this.db = readDb();
    this.indexEngine = new IndexEngine();
    this.queryPlanner = new QueryPlanner(this.indexEngine);
    this.wal = new WriteAheadLog();
    this.rules = rules || {
      canRead: () => true,
      canWrite: () => true
    };
    this.txQueue = Promise.resolve();
  }

  _col(name) {
    if (!this.db.collections[name]) this.db.collections[name] = {};
    return this.db.collections[name];
  }

  _persist() {
    writeDb(this.db);
  }

  createIndex(def) {
    const name = this.indexEngine.createIndex(def);
    const col = this._col(def.collection);
    for (const [id, doc] of Object.entries(col)) this.indexEngine.upsertDoc(def.collection, id, doc.data);
    return name;
  }

  beginTransaction() {
    return {
      id: crypto.randomUUID(),
      readVersions: new Map(),
      writes: []
    };
  }

  async runInTransaction(handler) {
    const tx = this.beginTransaction();
    return this._enqueue(async () => {
      this.wal.append({ type: 'BEGIN_TX', txId: tx.id });
      try {
        const result = await handler(this._txApi(tx));
        this._commitTx(tx);
        this.wal.append({ type: 'COMMIT_TX', txId: tx.id });
        return result;
      } catch (e) {
        this.wal.append({ type: 'ROLLBACK_TX', txId: tx.id, reason: e.message });
        throw e;
      }
    });
  }

  _txApi(tx) {
    return {
      get: (collection, id) => {
        const doc = this.getDoc(collection, id);
        tx.readVersions.set(`${collection}/${id}`, doc ? doc._version : null);
        return doc;
      },
      set: (collection, id, data, context = {}) => {
        tx.writes.push({ op: 'set', collection, id, data, context });
      },
      update: (collection, id, patch, transforms, context = {}) => {
        tx.writes.push({ op: 'update', collection, id, patch, transforms, context });
      },
      delete: (collection, id, context = {}) => {
        tx.writes.push({ op: 'delete', collection, id, context });
      }
    };
  }

  _commitTx(tx) {
    for (const [key, version] of tx.readVersions.entries()) {
      const [collection, id] = key.split('/');
      const current = this.getDoc(collection, id);
      const currentVersion = current ? current._version : null;
      if (currentVersion !== version) throw new Error('TX_CONFLICT');
    }

    const backup = JSON.stringify(this.db);
    try {
      for (const w of tx.writes) {
        if (w.op === 'set') this.setDoc(w.collection, w.id, w.data, w.context);
        if (w.op === 'update') this.updateDoc(w.collection, w.id, w.patch, w.transforms, w.context);
        if (w.op === 'delete') this.deleteDoc(w.collection, w.id, w.context);
      }
    } catch (e) {
      this.db = JSON.parse(backup);
      this._persist();
      throw new Error(`TX_ROLLBACK:${e.message}`);
    }
  }

  _enqueue(fn) {
    this.txQueue = this.txQueue.then(fn, fn);
    return this.txQueue;
  }

  getDoc(collection, id) {
    const entry = this._col(collection)[id];
    return entry ? { id, ...entry.data, _version: entry.version } : null;
  }

  setDoc(collection, id, data, context = {}) {
    if (!this.rules.canWrite({ collection, id, data, context })) throw new Error('RULE_DENY_WRITE');
    const col = this._col(collection);
    const current = col[id];
    const version = (current?.version || 0) + 1;
    col[id] = { data: { ...data }, version };
    this.indexEngine.upsertDoc(collection, id, col[id].data);
    this.wal.append({ type: 'SET', collection, id, version });
    this._persist();
    return this.getDoc(collection, id);
  }

  updateDoc(collection, id, patch, transforms = {}, context = {}) {
    const col = this._col(collection);
    if (!col[id]) throw new Error('NOT_FOUND');
    const merged = applyTransforms({ ...col[id].data, ...patch }, transforms);
    return this.setDoc(collection, id, merged, context);
  }

  deleteDoc(collection, id, context = {}) {
    const col = this._col(collection);
    if (!this.rules.canWrite({ collection, id, data: null, context })) throw new Error('RULE_DENY_WRITE');
    delete col[id];
    this.indexEngine.removeDoc(collection, id);
    this.wal.append({ type: 'DELETE', collection, id });
    this._persist();
  }

  batchWrite(ops) {
    const tx = this.beginTransaction();
    for (const op of ops) tx.writes.push(op);
    this.wal.append({ type: 'BEGIN_BATCH', txId: tx.id, count: ops.length });
    try {
      this._commitTx(tx);
      this.wal.append({ type: 'COMMIT_BATCH', txId: tx.id });
      return { ok: true };
    } catch (e) {
      this.wal.append({ type: 'ROLLBACK_BATCH', txId: tx.id, reason: e.message });
      throw e;
    }
  }

  query(collection, query, context = {}) {
    const snapshot = JSON.parse(JSON.stringify(this._col(collection)));
    const all = Object.entries(snapshot).map(([id, row]) => ({ id, ...row.data, _version: row.version }));
    const plan = this.queryPlanner.plan(collection, query, all.length);

    let rows = all;
    for (const cond of plan.parsed.where) {
      const v = cond.value;
      rows = rows.filter((r) => {
        const x = r[cond.field];
        if (cond.op === '==') return x === v;
        if (cond.op === '!=') return x !== v;
        if (cond.op === '<') return x < v;
        if (cond.op === '<=') return x <= v;
        if (cond.op === '>') return x > v;
        if (cond.op === '>=') return x >= v;
        if (cond.op === 'in') return Array.isArray(v) && v.includes(x);
        if (cond.op === 'array-contains') return Array.isArray(x) && x.includes(v);
        return false;
      });
    }

    for (const sort of plan.parsed.orderBy) {
      rows.sort((a, b) => {
        if (a[sort.field] === b[sort.field]) return 0;
        const r = a[sort.field] > b[sort.field] ? 1 : -1;
        return (sort.direction || 'asc').toLowerCase() === 'desc' ? -r : r;
      });
    }

    const cursorField = plan.parsed.orderBy[0]?.field || 'id';
    if (plan.parsed.cursor.startAfter !== undefined) rows = rows.filter((r) => r[cursorField] > plan.parsed.cursor.startAfter);
    if (plan.parsed.cursor.startAt !== undefined) rows = rows.filter((r) => r[cursorField] >= plan.parsed.cursor.startAt);
    if (plan.parsed.cursor.endBefore !== undefined) rows = rows.filter((r) => r[cursorField] < plan.parsed.cursor.endBefore);
    if (plan.parsed.cursor.endAt !== undefined) rows = rows.filter((r) => r[cursorField] <= plan.parsed.cursor.endAt);

    if (plan.parsed.cursor.limitToLast && plan.parsed.limit) rows = rows.slice(-plan.parsed.limit);
    else if (plan.parsed.limit) rows = rows.slice(0, plan.parsed.limit);

    const filtered = rows.filter((r) => this.rules.canRead({ collection, id: r.id, data: r, context }));
    const nextCursor = filtered.length ? filtered[filtered.length - 1][cursorField] : null;
    return { docs: filtered, nextCursor, explain: this.explain(collection, query) };
  }

  explain(collection, query) {
    const size = Object.keys(this._col(collection)).length;
    const plan = this.queryPlanner.plan(collection, query, size);
    return {
      strategy: plan.strategy,
      estimatedCost: plan.estimatedCost,
      usedIndex: plan.usedIndex,
      suggestion: plan.suggestion
    };
  }
}

module.exports = { FirestoreEngine };
