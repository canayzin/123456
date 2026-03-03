const crypto = require('crypto');

function b64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

class JwtService {
  constructor({ keyStore, issuer = 'novabase', audience = 'novabase-clients', skewSec = 60 }) {
    this.keyStore = keyStore;
    this.issuer = issuer;
    this.audience = audience;
    this.skewSec = skewSec;
  }

  signToken({ sub, type = 'access', ttlSec = 900, extra = {} }) {
    const active = this.keyStore.getActiveKey();
    if (!active) throw new Error('no_active_key');
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT', kid: active.kid };
    const payload = {
      iss: this.issuer,
      aud: this.audience,
      sub,
      iat: now,
      nbf: now,
      exp: now + ttlSec,
      jti: crypto.randomUUID(),
      typ: type,
      ...extra
    };

    const h = b64urlEncode(JSON.stringify(header));
    const p = b64urlEncode(JSON.stringify(payload));
    const sig = crypto.createHmac('sha256', active.secret).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${sig}`;
  }

  verifyToken(token, { audience, issuer, nowSec } = {}) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return { ok: false, code: 'MALFORMED_TOKEN' };
    const [h, p, sig] = parts;
    const header = safeJsonParse(b64urlDecode(h));
    const payload = safeJsonParse(b64urlDecode(p));
    if (!header || !payload) return { ok: false, code: 'INVALID_JSON' };
    if (header.alg !== 'HS256' || !header.kid) return { ok: false, code: 'UNSUPPORTED_ALG' };

    const key = this.keyStore.getVerifiableKeys().find((k) => k.kid === header.kid);
    if (!key) return { ok: false, code: 'UNKNOWN_KID' };

    const expected = crypto.createHmac('sha256', key.secret).update(`${h}.${p}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return { ok: false, code: 'INVALID_SIGNATURE' };

    const now = typeof nowSec === 'number' ? nowSec : Math.floor(Date.now() / 1000);
    const checkAud = audience || this.audience;
    const checkIss = issuer || this.issuer;

    if (payload.iss !== checkIss) return { ok: false, code: 'INVALID_ISS' };
    if (payload.aud !== checkAud) return { ok: false, code: 'INVALID_AUD' };
    if (typeof payload.nbf === 'number' && now + this.skewSec < payload.nbf) return { ok: false, code: 'TOKEN_NOT_YET_VALID' };
    if (typeof payload.exp === 'number' && now - this.skewSec > payload.exp) return { ok: false, code: 'TOKEN_EXPIRED' };

    return { ok: true, header, payload };
  }
}

module.exports = { JwtService, b64urlEncode, b64urlDecode };
