const fs = require('fs');
const path = require('path');

class TemplateStore {
  file(projectId) {
    const dir = path.join(process.cwd(), 'data', 'remoteconfig', 'templates');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${projectId}.json`);
  }
  get(projectId) {
    try { return JSON.parse(fs.readFileSync(this.file(projectId), 'utf8')); }
    catch {
      return { templateId: 'tmpl_active', version: 0, etag: '', publishedAt: 0, publishedBy: 'system', parameters: {}, conditions: [], minimumFetchIntervalSeconds: 3600 };
    }
  }
  save(projectId, t) { fs.writeFileSync(this.file(projectId), JSON.stringify(t, null, 2)); }
}
module.exports = { TemplateStore };
