const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { getPlatform } = require('../platform/container');

const DB_PATH = path.join(process.cwd(), 'data', 'docdb.json');

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { collections: {}, indexes: {} };
  }
}

function writeDb(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

class DocDbEngine {
  constructor({ projectId = 'default-project' } = {}) {
    this.events = new EventEmitter();
    this.projectId = projectId;
  }

  _emitChange({ collection, docId, type, newDoc, oldDoc }) {
    const event = {
      projectId: this.projectId,
      collection,
      docId,
      type,
      newDoc: newDoc || null,
      oldDoc: oldDoc || null
    };
    this.events.emit('docdb:change', event);
    this.events.emit('docdb:collectionChange', {
      projectId: this.projectId,
      collection,
      docId,
      type
    });
  }

  _load() {
    return readDb();
  }

  _save(db) {
    writeDb(db);
  }

  _collection(db, name) {
    if (!db.collections[name]) db.collections[name] = {};
    return db.collections[name];
  }

  collection(name) {
    const engine = this;
    const query = { filters: [], order: null, max: null };

    return {
      doc(id) {
        return {
          set(data) {
            const db = engine._load();
            const col = engine._collection(db, name);
            const oldDoc = col[id] || null;
            col[id] = { id, ...data, updatedAt: Date.now() };
            engine._save(db);
            engine.events.emit(`${name}:${id}`, col[id]);
            engine.events.emit(`${name}:*`, col[id]);
            engine._emitChange({ collection: name, docId: id, type: 'set', newDoc: col[id], oldDoc });
            getPlatform().appendOutbox(engine.projectId, 'docdb.change', { collection: name, docId: id, type: 'set', newDoc: col[id], oldDoc });
            return col[id];
          },
          update(data) {
            const db = engine._load();
            const col = engine._collection(db, name);
            if (!col[id]) throw new Error('not_found');
            const oldDoc = { ...col[id] };
            col[id] = { ...col[id], ...data, updatedAt: Date.now() };
            engine._save(db);
            engine.events.emit(`${name}:${id}`, col[id]);
            engine.events.emit(`${name}:*`, col[id]);
            engine._emitChange({ collection: name, docId: id, type: 'update', newDoc: col[id], oldDoc });
            getPlatform().appendOutbox(engine.projectId, 'docdb.change', { collection: name, docId: id, type: 'update', newDoc: col[id], oldDoc });
            return col[id];
          },
          get() {
            const db = engine._load();
            return engine._collection(db, name)[id] || null;
          },
          delete() {
            const db = engine._load();
            const col = engine._collection(db, name);
            const value = col[id] || null;
            delete col[id];
            engine._save(db);
            engine.events.emit(`${name}:${id}`, null);
            engine.events.emit(`${name}:*`, { id, deleted: true });
            engine._emitChange({ collection: name, docId: id, type: 'delete', newDoc: null, oldDoc: value });
            getPlatform().appendOutbox(engine.projectId, 'docdb.change', { collection: name, docId: id, type: 'delete', newDoc: null, oldDoc: value });
            return value;
          },
          onSnapshot(cb) {
            const key = `${name}:${id}`;
            engine.events.on(key, cb);
            return () => engine.events.off(key, cb);
          }
        };
      },
      where(field, operator, value) {
        query.filters.push({ field, operator, value });
        return this;
      },
      orderBy(field, direction = 'asc') {
        query.order = { field, direction };
        return this;
      },
      limit(n) {
        query.max = n;
        return this;
      },
      get() {
        const db = engine._load();
        let docs = Object.values(engine._collection(db, name));
        for (const f of query.filters) {
          if (f.operator === '==') docs = docs.filter((d) => d[f.field] === f.value);
          if (f.operator === '!=') docs = docs.filter((d) => d[f.field] !== f.value);
        }
        if (query.order) {
          const { field, direction } = query.order;
          docs.sort((a, b) => (a[field] > b[field] ? 1 : -1) * (direction === 'desc' ? -1 : 1));
        }
        if (typeof query.max === 'number') docs = docs.slice(0, query.max);
        return { docs };
      },
      onSnapshot(cb) {
        const key = `${name}:*`;
        engine.events.on(key, cb);
        return () => engine.events.off(key, cb);
      }
    };
  }

  generateId() {
    return crypto.randomUUID();
  }
}

module.exports = { DocDbEngine };
