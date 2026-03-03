const fs = require('fs');
const path = require('path');
const ROOT = path.join(process.cwd(), 'data', 'quota');
const DEFAULT = {
  limits: {
    docdb: { readsPerMin: 6000, writesPerMin: 2000 },
    storage: { bytesWritePerDay: 1073741824, bytesReadPerDay: 1073741824, opsPerMin: 3000 },
    functions: { invocationsPerMin: 500, maxTimeoutMs: 10000 },
    ws: { connections: 1000, messagesPerMin: 30000 },
    sync: { opsPerMin: 10000 }
  },
  rateLimit: { ip: { reqPerMin: 300 }, uid: { reqPerMin: 600 } },
  mode: 'observe'
};
class QuotaConfigStore {
  _file(projectId) { fs.mkdirSync(ROOT, { recursive: true }); return path.join(ROOT, `${projectId}.json`); }
  get(projectId) { try { return { ...DEFAULT, ...JSON.parse(fs.readFileSync(this._file(projectId), 'utf8')) }; } catch { return JSON.parse(JSON.stringify(DEFAULT)); } }
  set(projectId, cfg) { const file = this._file(projectId); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2)); fs.renameSync(tmp, file); return cfg; }
}
module.exports = { QuotaConfigStore, DEFAULT };
