class MemoryStore {
  constructor() { this.projects = new Map(); }
  ensure(projectId) { if (!this.projects.has(projectId)) this.projects.set(projectId, {}); return this.projects.get(projectId); }
  reset(projectId) { if (projectId) this.projects.delete(projectId); else this.projects.clear(); }
}
module.exports = { MemoryStore };
