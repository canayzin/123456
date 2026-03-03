const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(s) {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = p + '='.repeat((4 - (p.length % 4 || 4)) % 4);
  return Buffer.from(pad, 'base64').toString('utf8');
}

function signServiceToken(payload, secret) {
  const enc = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(enc).digest('base64url');
  return `${enc}.${sig}`;
}

function verifyServiceToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { ok: false, reason: 'FORMAT' };
  const [enc, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(enc).digest('base64url');
  if (sig !== expected) return { ok: false, reason: 'SIGNATURE' };
  try {
    const payload = JSON.parse(fromB64url(enc));
    if (payload.exp && Number(payload.exp) < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'EXPIRED' };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'PAYLOAD' };
  }
}

module.exports = { signServiceToken, verifyServiceToken };
