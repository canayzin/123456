const fs = require('fs');
const path = require('path');
class KeysStore {
  file(projectId) { const dir = path.join(process.cwd(), 'data', 'appcheck', 'keys'); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, `${projectId}.json`); }
  get(projectId) { try { return JSON.parse(fs.readFileSync(this.file(projectId), 'utf8')); } catch { return { debugTokens: [], customSecrets: {} }; } }
  save(projectId, row) { fs.writeFileSync(this.file(projectId), JSON.stringify(row, null, 2)); }
}
module.exports = { KeysStore };
