const fs = require('fs');
const path = require('path');
const { FileLogStore } = require('../platform/adapters/store');
const logStore = new FileLogStore();
function file(projectId) { const dir = path.join(process.cwd(), 'data', 'messaging', 'receipts'); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, `${projectId}.ndjson`); }
function appendReceipt(projectId, row) { logStore.append(file(projectId), JSON.stringify(row)); }
function listReceipts(projectId) { try { return logStore.readLines(file(projectId)).map((x) => JSON.parse(x)); } catch { return []; } }
module.exports = { appendReceipt, listReceipts };
