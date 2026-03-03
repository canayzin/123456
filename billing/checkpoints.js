const fs = require('fs');
const path = require('path');

class Checkpoints {
  constructor(root = path.join(process.cwd(), 'data', 'billing', 'checkpoints')) { this.root = root; fs.mkdirSync(root, { recursive: true }); }
  _file(projectId) { return path.join(this.root, `${projectId}.json`); }
  get(projectId) { try { return JSON.parse(fs.readFileSync(this._file(projectId), 'utf8')); } catch { return { lastByteOffset: 0, lastEventTs: 0 }; } }
  save(projectId, cp) { fs.mkdirSync(this.root, { recursive: true }); const f = this._file(projectId); const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(cp, null, 2)); fs.renameSync(t, f); return cp; }
}

module.exports = { Checkpoints };
