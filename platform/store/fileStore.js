const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(root = path.join(process.cwd(), 'data', 'platform-store')) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  _path(key) {
    const clean = String(key || '').replace(/^\/+/, '');
    const full = path.join(this.root, clean);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    return full;
  }

  read(key, fallback = null) {
    try { return JSON.parse(fs.readFileSync(this._path(key), 'utf8')); } catch { return fallback; }
  }

  write(key, value) {
    fs.writeFileSync(this._path(key), JSON.stringify(value, null, 2));
    return value;
  }

  atomicWrite(key, value) {
    const file = this._path(key);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
    return value;
  }

  list(prefix = '') {
    const dir = this._path(prefix || '.');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
  }
}

module.exports = { FileStore };
