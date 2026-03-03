const { hasSensitiveKey, looksLikeEmail } = require('./pii');

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

function tooLong(v) {
  return typeof v === 'string' && v.length > 200;
}

function validateEvent(ev = {}) {
  if (!KEY_RE.test(String(ev.name || ''))) return { ok: false, reason: 'INVALID_EVENT_NAME' };
  const params = ev.params || {};
  const keys = Object.keys(params);
  if (keys.length > 25) return { ok: false, reason: 'TOO_MANY_PARAMS' };
  for (const key of keys) {
    if (!KEY_RE.test(String(key))) return { ok: false, reason: 'INVALID_PARAM_KEY' };
    if (hasSensitiveKey(key)) return { ok: false, reason: 'PII_KEY' };
    const val = params[key];
    if (tooLong(val)) return { ok: false, reason: 'PARAM_TOO_LONG' };
    if (looksLikeEmail(val)) return { ok: false, reason: 'PII_VALUE' };
  }
  if (!Number.isFinite(Number(ev.ts))) return { ok: false, reason: 'INVALID_TS' };
  return { ok: true };
}

function validatePayload(payload = {}) {
  const out = [];
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) return { ok: false, reason: 'EVENTS_REQUIRED', valid: [], invalid: 1 };
  if (events.length > 100) return { ok: false, reason: 'BATCH_TOO_LARGE', valid: [], invalid: events.length };
  let invalid = 0;
  let piiRejected = 0;
  const invalidReasons = {};
  for (const ev of events) {
    const v = validateEvent(ev);
    if (v.ok) out.push(ev); else {
      invalid += 1;
      invalidReasons[v.reason] = (invalidReasons[v.reason] || 0) + 1;
      if (v.reason === 'PII_KEY' || v.reason === 'PII_VALUE') piiRejected += 1;
    }
  }
  return { ok: true, valid: out, invalid, piiRejected, invalidReasons };
}

module.exports = { validatePayload };
