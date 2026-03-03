const fs = require('fs');
const path = require('path');
const { dayKey } = require('./partitions');

class AnalyticsStore {
  eventsFile(projectId, day) {
    const dir = path.join(process.cwd(), 'data', 'analytics', 'events', projectId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${day}.ndjson`);
  }

  appendEvents(projectId, rows = []) {
    const buckets = new Map();
    for (const row of rows) {
      const d = dayKey(row.ts || Date.now());
      buckets.set(d, (buckets.get(d) || []).concat([row]));
    }
    for (const [d, entries] of buckets.entries()) {
      const file = this.eventsFile(projectId, d);
      const txt = entries.map((x) => JSON.stringify(x)).join('\n') + '\n';
      fs.appendFileSync(file, txt);
    }
  }

  listEventFiles(projectId) {
    const dir = path.join(process.cwd(), 'data', 'analytics', 'events', projectId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((x) => x.endsWith('.ndjson')).sort().map((x) => path.join(dir, x));
  }
}

module.exports = { AnalyticsStore };
