const fs = require('fs');
const path = require('path');

class OrgsStore {
  file(orgId) {
    const dir = path.join(process.cwd(), 'data', 'control', 'orgs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${orgId}.json`);
  }
  get(orgId) {
    try { return JSON.parse(fs.readFileSync(this.file(orgId), 'utf8')); } catch { return null; }
  }
  save(orgId, row) {
    fs.writeFileSync(this.file(orgId), JSON.stringify(row, null, 2));
    return row;
  }
  list() {
    const dir = path.join(process.cwd(), 'data', 'control', 'orgs');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')));
  }
}

module.exports = { OrgsStore };
