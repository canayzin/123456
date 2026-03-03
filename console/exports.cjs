const path = require('path');
const fs = require('fs');
const { sanitizeValue } = require('./sanitize.cjs');

function renderFormat(items, format = 'json') {
  if (format === 'ndjson') return items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : '');
  return JSON.stringify({ items }, null, 2);
}

function usageExport(quotaEngine, projectId, from, to, format) {
  const items = quotaEngine.getUsage(projectId, from, to).map((x) => sanitizeValue(x));
  return renderFormat(items, format);
}

function analyticsExport(projectId, date, format) {
  const file = path.join(process.cwd(), 'data', 'analytics', 'events', projectId, `${date}.ndjson`);
  const items = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((x) => x.trim()).map((x) => sanitizeValue(JSON.parse(x))) : [];
  return renderFormat(items, format || 'ndjson');
}

function invoicesExport(projectId, month, format = 'json') {
  const file = path.join(process.cwd(), 'data', 'billing', 'invoices', projectId, `${month}.json`);
  let items = [];
  try { items = [sanitizeValue(JSON.parse(fs.readFileSync(file, 'utf8')))]; } catch {}
  return renderFormat(items, format);
}

module.exports = { usageExport, analyticsExport, invoicesExport };
