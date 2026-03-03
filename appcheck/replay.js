const fs = require('fs');
const path = require('path');
class ReplayStore {
  constructor(windowMs = 11 * 60 * 1000) {
    this.windowMs = windowMs;
    this.map = new Map();
    this.timer = setInterval(() => this.prune(), 30_000);
    if (this.timer.unref) this.timer.unref();
  }
  file(projectId) { const dir = path.join(process.cwd(), 'data', 'appcheck', 'jti'); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, `${projectId}.ndjson`); }
  seen(projectId, jti) {
    const key = `${projectId}:${jti}`;
    const ts = this.map.get(key);
    return Boolean(ts && (Date.now() - ts) <= this.windowMs);
  }
  add(projectId, jti, ts = Date.now()) {
    const key = `${projectId}:${jti}`;
    this.map.set(key, ts);
    fs.appendFileSync(this.file(projectId), `${JSON.stringify({ ts, jti })}\n`);
  }
  prune() {
    const now = Date.now();
    for (const [k, v] of this.map.entries()) if (now - v > this.windowMs) this.map.delete(k);
  }
  close() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
module.exports = { ReplayStore };
