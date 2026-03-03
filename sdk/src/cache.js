class MemoryStore {
  constructor() { this.map = new Map(); }
  get(key) { return this.map.get(key); }
  set(key, value) { this.map.set(key, value); }
  remove(key) { this.map.delete(key); }
}

module.exports = { MemoryStore };
