class MemoryStore {
  constructor() { this.map = new Map(); }
  read(key, fallback = null) { return this.map.has(key) ? this.map.get(key) : fallback; }
  write(key, value) { this.map.set(key, value); return value; }
  atomicWrite(key, value) { this.map.set(key, value); return value; }
  list(prefix = '') { return [...this.map.keys()].filter((k) => k.startsWith(prefix)); }
}

module.exports = { MemoryStore };
