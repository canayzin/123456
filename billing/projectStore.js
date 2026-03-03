const fs = require('fs');
const path = require('path');

class ProjectStore {
  constructor(root = path.join(process.cwd(), 'data', 'billing', 'projects')) { this.root = root; fs.mkdirSync(root, { recursive: true }); }
  _file(projectId) { return path.join(this.root, `${projectId}.json`); }
  month() { return new Date().toISOString().slice(0, 7); }
  get(projectId, orgId = 'default-org') {
    try { return JSON.parse(fs.readFileSync(this._file(projectId), 'utf8')); }
    catch {
      const s = { projectId, orgId, plan: 'free', budget: { monthlyLimit: 10000, alerts: [0.5, 0.8, 1.0], lastAlerted: {} }, monthState: { currentMonth: this.month(), usage: {}, charges: {}, invoice: {} } };
      this.save(projectId, s);
      return s;
    }
  }
  save(projectId, state) {
    fs.mkdirSync(this.root, { recursive: true });
    const f = this._file(projectId); const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(state, null, 2)); fs.renameSync(t, f); return state;
  }
}

module.exports = { ProjectStore };
