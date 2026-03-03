const fs = require('fs');
const path = require('path');
const { FileLogStore } = require('../platform/adapters/store');
const { startSpan, endSpan } = require('../observability/trace');

const ROOT = path.join(process.cwd(), 'data', 'audit');
const logStore = new FileLogStore();
const buffers = new Map();
const timers = new Map();

function fileFor(projectId) {
  fs.mkdirSync(ROOT, { recursive: true });
  return path.join(ROOT, `${projectId || 'global'}.log`);
}

function flush(projectId) {
  const key = projectId || 'global';
  const rows = buffers.get(key) || [];
  if (!rows.length) return 0;
  const span = startSpan('audit.flush', { projectId: key, count: rows.length });
  for (const line of rows) logStore.append(fileFor(key), line);
  endSpan(span, 'ok');
  buffers.set(key, []);
  if (timers.has(key)) {
    clearTimeout(timers.get(key));
    timers.delete(key);
  }
  return rows.length;
}

function schedule(projectId) {
  const key = projectId || 'global';
  if (timers.has(key)) return;
  timers.set(key, setTimeout(() => flush(key), 25));
}

function append(entry) {
  const key = entry.projectId || 'global';
  const rows = buffers.get(key) || [];
  rows.push(JSON.stringify({ ...entry, ts: entry.ts || Date.now() }));
  buffers.set(key, rows);
  if (rows.length >= 64) flush(key);
  else schedule(key);
}

function read(projectId) {
  flush(projectId);
  try {
    const file = path.join(ROOT, `${projectId}.log`);
    return logStore.readLines(file).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

module.exports = { append, read, flush };
