const fs = require('fs');
const path = require('path');

/** File-backed document store with per-doc versioning. */
class DocStore {
  constructor(root = path.join(process.cwd(), 'data', 'docdbv2')) {
    this.root = root;
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** Build per-project storage path. */
  _file(projectId) {
    return path.join(this.root, `${projectId}.json`);
  }

  /** Load state from disk with safe fallback. */
  _read(projectId) {
    try {
      return JSON.parse(fs.readFileSync(this._file(projectId), 'utf8'));
    } catch {
      return { collections: {} };
    }
  }

  /** Persist full project state. */
  _write(projectId, state) {
    fs.writeFileSync(this._file(projectId), JSON.stringify(state, null, 2));
  }

  /** Return whole collection map (creating if absent). */
  _collection(state, collection) {
    if (!state.collections[collection]) state.collections[collection] = {};
    return state.collections[collection];
  }

  /** Read single doc by id. */
  getDoc(projectId, collection, docId) {
    const state = this._read(projectId);
    const doc = state.collections?.[collection]?.[docId];
    return doc ? { ...doc } : null;
  }

  /** Write full doc and auto-manage metadata/version. */
  setDoc(projectId, collection, docId, data, now) {
    const state = this._read(projectId);
    const col = this._collection(state, collection);
    const prev = col[docId] || null;
    const version = (prev?._v || 0) + 1;
    const createdAt = prev?._createdAt || now;
    const next = {
      _id: docId,
      _collection: collection,
      _projectId: projectId,
      _v: version,
      _createdAt: createdAt,
      _updatedAt: now,
      data: { ...data }
    };
    col[docId] = next;
    this._write(projectId, state);
    return { prev, next };
  }

  /** Delete doc and return previous value. */
  deleteDoc(projectId, collection, docId) {
    const state = this._read(projectId);
    const col = this._collection(state, collection);
    const prev = col[docId] || null;
    delete col[docId];
    this._write(projectId, state);
    return prev;
  }

  /** Return snapshot array for collection. */
  listDocs(projectId, collection) {
    const state = this._read(projectId);
    return Object.values(state.collections?.[collection] || {}).map((d) => ({ ...d }));
  }
}

module.exports = { DocStore };
