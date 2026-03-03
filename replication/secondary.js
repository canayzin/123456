class SecondaryReplica {
  constructor() {
    this.docs = new Map();
    this.versions = new Map();
  }
  _key(projectId, collection, docId) { return `${projectId}:${collection}:${docId}`; }
  apply(event) {
    const payload = event.payload || {};
    if (event.type !== 'docdb.change') return;
    const key = this._key(event.projectId, payload.collection, payload.docId);
    if (payload.type === 'delete') this.docs.delete(key);
    else this.docs.set(key, payload.newDoc || null);
    this.versions.set(event.projectId, Number(event.version || 0));
  }
  getDoc(projectId, collection, docId) {
    return this.docs.get(this._key(projectId, collection, docId)) || null;
  }
  query(projectId, collection) {
    const prefix = `${projectId}:${collection}:`;
    const out = [];
    for (const [k, v] of this.docs.entries()) {
      if (k.startsWith(prefix) && v) out.push(v);
    }
    return out;
  }
  version(projectId) { return this.versions.get(projectId) || 0; }
}

module.exports = { SecondaryReplica };
