const MAX = 512;
const spans = [];

function startSpan(name, fields = {}) {
  return { name, fields, start: Date.now() };
}

function endSpan(span, status = 'ok', extra = {}) {
  const row = { ts: Date.now(), name: span.name, fields: span.fields || {}, status, durationMs: Date.now() - span.start, ...extra };
  spans.push(row);
  while (spans.length > MAX) spans.shift();
  return row;
}

function listSpans(limit = 100) {
  return spans.slice(Math.max(0, spans.length - Number(limit || 100)));
}

module.exports = { startSpan, endSpan, listSpans };
