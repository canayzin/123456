const fs = require('fs');
const path = require('path');

class OrgStore {
  constructor(root = path.join(process.cwd(), 'data', 'iam', 'orgs')) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }
  _file(orgId) { return path.join(this.root, `${orgId}.json`); }
  get(orgId) {
    try { return JSON.parse(fs.readFileSync(this._file(orgId), 'utf8')); }
    catch { return { orgId, name: orgId, projects: {} }; }
  }
  save(orgId, org) {
    fs.mkdirSync(this.root, { recursive: true });
    const file = this._file(orgId);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(org, null, 2));
    fs.renameSync(tmp, file);
    return org;
  }
  ensureProject(orgId, projectId) {
    const org = this.get(orgId);
    if (!org.projects[projectId]) org.projects[projectId] = { members: [], customRoles: {}, serviceAccounts: [] };
    return this.save(orgId, org);
  }
}

module.exports = { OrgStore };
