const fs = require('fs');
const path = require('path');

class ProjectsStore {
  file(projectId) {
    const dir = path.join(process.cwd(), 'data', 'control', 'projects');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${projectId}.json`);
  }
  get(projectId) {
    try { return JSON.parse(fs.readFileSync(this.file(projectId), 'utf8')); } catch { return null; }
  }
  save(projectId, row) {
    fs.writeFileSync(this.file(projectId), JSON.stringify(row, null, 2));
    return row;
  }
  listByOrg(orgId) {
    const dir = path.join(process.cwd(), 'data', 'control', 'projects');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8'))).filter((x) => x.orgId === orgId);
  }
}

module.exports = { ProjectsStore };
