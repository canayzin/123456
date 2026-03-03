const fs = require('fs');
const path = require('path');

class OpsLog {
  constructor(root = path.join(process.cwd(), 'data', 'sync', 'ops')) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }
  _file(projectId) { return path.join(this.root, `${projectId}.ndjson`); }
  append(projectId, rows) {
    if (!rows.length) return;
    fs.mkdirSync(this.root, { recursive: true });
    fs.appendFileSync(this._file(projectId), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  }
  readAll(projectId) {
    try {
      const t = fs.readFileSync(this._file(projectId), 'utf8').trim();
      if (!t) return [];
      return t.split('\n').map((x) => JSON.parse(x));
    } catch { return []; }
  }
  replace(projectId, rows) {
    fs.mkdirSync(this.root, { recursive: true });
    const file = this._file(projectId);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, rows.length ? `${rows.map((r) => JSON.stringify(r)).join('\n')}\n` : '');
    fs.renameSync(tmp, file);
  }
}
module.exports = { OpsLog };
