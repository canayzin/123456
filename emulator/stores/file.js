const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(root = path.join(process.cwd(), 'data', 'emulator')) { this.root = root; fs.mkdirSync(root, { recursive: true }); }
  modePath() { return path.join(this.root, 'mode.json'); }
  writeMode(mode) { fs.writeFileSync(this.modePath(), JSON.stringify({ mode, ts: Date.now() }, null, 2)); }
  readMode() { try { return JSON.parse(fs.readFileSync(this.modePath(), 'utf8')).mode; } catch { return 'file'; } }
}
module.exports = { FileStore };
