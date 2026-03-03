const fs = require('fs');
const path = require('path');
const { FileLogStore } = require('../platform/adapters/store');
const logStore = new FileLogStore();
function file(projectId) { const dir = path.join(process.cwd(), 'data', 'messaging', 'queue'); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, `${projectId}.ndjson`); }
function appendQueue(projectId, row) { logStore.append(file(projectId), JSON.stringify(row)); }
function readQueue(projectId) { try { return logStore.readLines(file(projectId)).map((x) => JSON.parse(x)); } catch { return []; } }
module.exports = { appendQueue, readQueue };
