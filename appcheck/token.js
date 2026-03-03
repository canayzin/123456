const crypto = require('crypto');
function b64(x) { return Buffer.from(x).toString('base64url'); }
function ub64(x) { return Buffer.from(x, 'base64url').toString('utf8'); }
function sign(payload, secret, appId) {
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: appId }));
  const p = b64(JSON.stringify(payload));
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function verify(token, secret) {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) return { ok: false, code: 'MALFORMED' };
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  if (expected !== s) return { ok: false, code: 'BAD_SIGNATURE' };
  try { return { ok: true, header: JSON.parse(ub64(h)), payload: JSON.parse(ub64(p)) }; } catch { return { ok: false, code: 'BAD_JSON' }; }
}
module.exports = { sign, verify };
