const fs = require('fs');
const path = require('path');

class ClocksStore {
  constructor(root = path.join(process.cwd(), 'data', 'sync', 'clocks')) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }
  _file(projectId) { return path.join(this.root, `${projectId}.json`); }
  read(projectId) {
    try { return JSON.parse(fs.readFileSync(this._file(projectId), 'utf8')); }
    catch { return { version: 0, actors: {}, seen: {}, actorUid: {}, compactedVersion: 0 }; }
  }
  write(projectId, state) {
    fs.mkdirSync(this.root, { recursive: true });
    const file = this._file(projectId);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }
}
module.exports = { ClocksStore };
