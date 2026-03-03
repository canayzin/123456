const fs = require('fs');
const path = require('path');
const { FileLogStore } = require('../platform/adapters/store');
const { startSpan, endSpan } = require('../observability/trace');
const ROOT = path.join(process.cwd(), 'data', 'usage');
const logStore = new FileLogStore();
class UsageEvents {
  constructor() { this.buf = new Map(); this.maxBuffered = 128; }
  _file(projectId) { fs.mkdirSync(ROOT, { recursive: true }); return path.join(ROOT, `${projectId}.ndjson`); }
  append(evt) {
    const arr = this.buf.get(evt.projectId) || [];
    arr.push(evt);
    this.buf.set(evt.projectId, arr);
    if (arr.length >= this.maxBuffered) return this.flush(evt.projectId);
    return 0;
  }
  flush(projectId) { const arr = this.buf.get(projectId) || []; if (!arr.length) return 0; const span = startSpan('usage.flush', { projectId, count: arr.length }); for (const x of arr) logStore.append(this._file(projectId), JSON.stringify(x)); this.buf.set(projectId, []); endSpan(span, 'ok'); return arr.length; }
  read(projectId) { this.flush(projectId); try { return logStore.readLines(this._file(projectId)).map((x)=>JSON.parse(x)); } catch { return []; } }
}
module.exports = { UsageEvents };
