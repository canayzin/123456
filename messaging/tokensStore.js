const fs = require('fs');
const path = require('path');

class TokensStore {
  file(projectId) {
    const dir = path.join(process.cwd(), 'data', 'messaging', 'tokens');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${projectId}.json`);
  }
  getAll(projectId) { try { return JSON.parse(fs.readFileSync(this.file(projectId), 'utf8')).tokens || []; } catch { return []; } }
  saveAll(projectId, tokens) { fs.writeFileSync(this.file(projectId), JSON.stringify({ tokens }, null, 2)); }
}
module.exports = { TokensStore };
