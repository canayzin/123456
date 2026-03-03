const fs = require('fs');
const path = require('path');
const ROOT = path.join(process.cwd(), 'data', 'quota', 'counters');
class CountersStore {
  _file(projectId) { fs.mkdirSync(ROOT, { recursive: true }); return path.join(ROOT, `${projectId}.json`); }
  load(projectId) { try { return JSON.parse(fs.readFileSync(this._file(projectId), 'utf8')); } catch { return { day: {}, totals: {} }; } }
  save(projectId, state) { const file = this._file(projectId); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, file); }
}
module.exports = { CountersStore };
