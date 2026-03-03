const path = require('path');
const { readNdjson } = require('./sources/ndjsonReader.cjs');
const { sanitizeValue } = require('./sanitize.cjs');
const { paginate } = require('./pagination.cjs');

function fileFor(projectId, type) {
  if (type === 'billing') return path.join(process.cwd(), 'data', 'billing', 'audit.ndjson');
  if (type === 'hosting') return path.join(process.cwd(), 'data', 'hosting', 'audit.ndjson');
  if (type === 'messaging') return path.join(process.cwd(), 'data', 'messaging', 'audit.ndjson');
  if (type === 'remoteconfig') return path.join(process.cwd(), 'data', 'remoteconfig', 'audit.ndjson');
  if (type === 'appcheck') return path.join(process.cwd(), 'data', 'appcheck', 'audit.ndjson');
  if (type === 'quota') return path.join(process.cwd(), 'data', 'audit.log');
  return path.join(process.cwd(), 'data', 'audit.log');
}

function projectLogs(projectId, { type = 'audit', from = 0, to = Date.now(), limit, cursor }) {
  const file = fileFor(projectId, type);
  let rows = readNdjson(file).filter((x) => (!x.projectId || x.projectId === projectId));
  rows = rows.filter((x) => Number(x.ts || 0) >= Number(from) && Number(x.ts || 0) <= Number(to));
  rows = rows.map((x) => sanitizeValue({ ts: x.ts || 0, type: x.type || type, actor: x.actor || '', action: x.type || '', result: x.result || 'ok', details: x.details || x, requestId: x.requestId || '' }));
  rows.sort((a, b) => (Number(b.ts) - Number(a.ts)) || String(a.requestId || '').localeCompare(String(b.requestId || '')));
  return paginate(rows, { limit, cursor });
}

module.exports = { projectLogs };
