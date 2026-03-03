const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class OutboxBus {
  constructor({ bus, root = path.join(process.cwd(), 'data', 'outbox'), metrics }) {
    this.bus = bus;
    this.root = root;
    this.metrics = metrics || { outboxSize: 0, publishLatencyMs: [] };
    fs.mkdirSync(root, { recursive: true });
  }

  _file(projectId) {
    fs.mkdirSync(this.root, { recursive: true });
    return path.join(this.root, `${projectId || 'global'}.ndjson`);
  }

  append(projectId, type, payload) {
    const entry = { id: crypto.randomUUID(), ts: Date.now(), projectId: projectId || 'global', type, payload };
    fs.appendFileSync(this._file(projectId), `${JSON.stringify(entry)}\n`);
    return entry;
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

  markPublished(projectId, id) {
    const rows = this.readAll(projectId);
    const next = rows.map((r) => (r.id === id && !r.publishedAt ? { ...r, publishedAt: Date.now() } : r));
    const f = this._file(projectId);
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, next.map((r) => JSON.stringify(r)).join('\n') + (next.length ? '\n' : ''));
    fs.renameSync(tmp, f);
  }

  unpublished(projectId) {
    return this.readAll(projectId).filter((x) => !x.publishedAt);
  }
}

module.exports = { OutboxBus };
