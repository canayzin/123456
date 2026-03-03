function redactString(s) {
  let out = String(s || '');
  out = out.replace(/(pk_live_|sk_live_|dbg_[a-zA-Z0-9_\-]+)/g, '[REDACTED_TOKEN]');
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[REDACTED_EMAIL]');
  return out;
}

function sanitizeValue(v) {
  if (v == null) return v;
  if (typeof v === 'string') return redactString(v);
  if (Array.isArray(v)) return v.map(sanitizeValue);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (/token|secret|password|authorization/i.test(k)) out[k] = '[REDACTED]';
      else out[k] = sanitizeValue(val);
    }
    return out;
  }
  return v;
}

module.exports = { sanitizeValue };
