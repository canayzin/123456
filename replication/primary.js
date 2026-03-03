class PrimaryReplica {
  constructor() { this.version = new Map(); }
  nextVersion(projectId) {
    const v = (this.version.get(projectId) || 0) + 1;
    this.version.set(projectId, v);
    return v;
  }
  getVersion(projectId) { return this.version.get(projectId) || 0; }
  loadVersion(projectId, version) {
    const current = this.version.get(projectId) || 0;
    if (version > current) this.version.set(projectId, version);
  }
}

module.exports = { PrimaryReplica };
