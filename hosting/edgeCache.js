class EdgeCache {
  constructor(limit = 2000) {
    this.limit = limit;
    this.map = new Map();
  }
  _key(host, path, etag) { return `${host}|${path}|${etag}`; }
  get(host, path, etag) {
    const key = this._key(host, path, etag);
    const row = this.map.get(key);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) { this.map.delete(key); return null; }
    row.hit = (row.hit || 0) + 1;
    return row;
  }
  set(host, path, etag, value, ttlSec) {
    if (ttlSec <= 0) return;
    const key = this._key(host, path, etag);
    this.map.set(key, { ...value, expiresAt: Date.now() + ttlSec * 1000, hit: 0 });
    if (this.map.size > this.limit) {
      const first = this.map.keys().next().value;
      if (first) this.map.delete(first);
    }
  }
  clearSite(host) {
    for (const k of this.map.keys()) if (k.startsWith(`${host}|`)) this.map.delete(k);
  }
  clearProject(projectId) {
    for (const [k, v] of this.map.entries()) if (v.projectId === projectId) this.map.delete(k);
  }
}

module.exports = { EdgeCache };
