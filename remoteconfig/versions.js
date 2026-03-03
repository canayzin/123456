const fs = require('fs');
const path = require('path');
function file(projectId) { const dir = path.join(process.cwd(), 'data', 'remoteconfig', 'versions'); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, `${projectId}.ndjson`); }
function appendVersion(projectId, row) { fs.appendFileSync(file(projectId), `${JSON.stringify(row)}\n`); }
function listVersions(projectId, limit = 20) { try { const all = fs.readFileSync(file(projectId), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x)); return all.slice(-limit).reverse(); } catch { return []; } }
function findVersion(projectId, version) { try { return fs.readFileSync(file(projectId), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x)).find((x) => x.version === Number(version)) || null; } catch { return null; } }
module.exports = { appendVersion, listVersions, findVersion };
