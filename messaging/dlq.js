const fs = require('fs');
const path = require('path');
const { FileLogStore } = require('../platform/adapters/store');
const logStore = new FileLogStore();
function file(projectId) { const dir = path.join(process.cwd(), 'data', 'messaging', 'dlq'); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, `${projectId}.ndjson`); }
function appendDLQ(projectId, row) { logStore.append(file(projectId), JSON.stringify(row)); }
function listDLQ(projectId) { try { return logStore.readLines(file(projectId)).map((x) => JSON.parse(x)); } catch { return []; } }
module.exports = { appendDLQ, listDLQ };
