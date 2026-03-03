const fs = require('fs');
const path = require('path');

class AnalyticsCheckpoints {
  file(projectId) {
    const dir = path.join(process.cwd(), 'data', 'analytics', 'checkpoints');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${projectId}.json`);
  }
  get(projectId) {
    try { return JSON.parse(fs.readFileSync(this.file(projectId), 'utf8')); } catch { return { files: {} }; }
  }
  save(projectId, state) {
    fs.writeFileSync(this.file(projectId), JSON.stringify(state, null, 2));
  }
}

module.exports = { AnalyticsCheckpoints };
