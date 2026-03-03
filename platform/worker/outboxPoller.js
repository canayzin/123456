const fs = require('fs');

class OutboxPoller {
  constructor({ outbox, bus, metrics, replication }) {
    this.outbox = outbox;
    this.bus = bus;
    this.metrics = metrics;
    this.replication = replication;
  }

  _projects() {
    if (!fs.existsSync(this.outbox.root)) return [];
    return fs.readdirSync(this.outbox.root).filter((f) => f.endsWith('.ndjson')).map((f) => f.replace(/\.ndjson$/, ''));
  }

  runOnce() {
    let published = 0;
    for (const projectId of this._projects()) {
      const pending = this.outbox.unpublished(projectId);
      this.metrics.outboxSize += pending.length;
      for (const entry of pending) {
        const st = Date.now();
        const replicationRow = this.replication ? this.replication.append({ projectId: entry.projectId, type: entry.type, payload: entry.payload }) : entry;
        this.bus.publish(entry.type, replicationRow);
        this.outbox.markPublished(projectId, entry.id);
        this.metrics.publishLatencyMs.push(Date.now() - st);
        published += 1;
      }
    }
    return published;
  }
}

module.exports = { OutboxPoller };
