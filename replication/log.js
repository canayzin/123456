const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ReplicationLog {
  constructor(root = path.join(process.cwd(), 'data', 'replication')) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }
  _file(projectId) {
    fs.mkdirSync(this.root, { recursive: true });
    return path.join(this.root, `${projectId || 'global'}.ndjson`);
  }
  append(projectId, entry) {
    const file = this._file(projectId);
    const row = { id: crypto.randomUUID(), ts: Date.now(), projectId: projectId || 'global', version: Number(entry.version || 0), ...entry };
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    return row;
  }
  readAll(projectId) {
    try {
      const t = fs.readFileSync(this._file(projectId), 'utf8').trim();
      if (!t) return [];
      return t.split('\n').filter(Boolean).map((x) => JSON.parse(x));
    } catch {
      return [];
    }
  }
}

module.exports = { ReplicationLog };
