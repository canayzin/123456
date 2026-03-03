const fs = require('fs');
const path = require('path');

const FILE = path.join(process.cwd(), 'data', 'analytics', 'audit.ndjson');

function appendAudit(entry) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
}

module.exports = { appendAudit };
