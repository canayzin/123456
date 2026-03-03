const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { KeyStore } = require('./auth/keys');
const { JwtService } = require('./auth/jwt');
const { RefreshStore } = require('./auth/refreshStore');

const USERS_PATH = path.join(process.cwd(), 'data', 'users.json');

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch {
    return { users: [] };
  }
}

function writeUsers(data) {
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (e, dk) => {
      if (e) return reject(e);
      resolve(`${salt}:${dk.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, stored) {
  const [salt] = String(stored).split(':');
  const computed = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(stored));
}

class AuthEngine {
  constructor({ issuer = 'novabase', audience = 'novabase-clients', accessTtlSec = 900, refreshTtlSec = 14 * 24 * 3600 } = {}) {
    this.keyStore = new KeyStore();
    this.jwt = new JwtService({ keyStore: this.keyStore, issuer, audience });
    this.refresh = new RefreshStore();
    this.accessTtlSec = accessTtlSec;
    this.refreshTtlSec = refreshTtlSec;
    this.ipRate = new Map();
    this.userRate = new Map();
  }

  _err(code, message, details = {}) {
    return { error: { code, message, details } };
  }

  _checkRate(map, key, max = 60) {
    const bucket = map.get(key) || { count: 0, resetAt: Date.now() + 60_000 };
    if (Date.now() > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = Date.now() + 60_000;
    }
    bucket.count += 1;
    map.set(key, bucket);
    if (bucket.count > max) throw this._err('RATE_LIMITED', 'Too many requests', { key });
  }

  _issueTokens(userId) {
    const sessionId = crypto.randomUUID();
    return this.refresh.issue({ userId, sessionId, ttlSec: this.refreshTtlSec }).then((refreshToken) => ({
      accessToken: this.jwt.signToken({ sub: userId, type: 'access', ttlSec: this.accessTtlSec, extra: { sid: sessionId } }),
      refreshToken,
      sessionId
    }));
  }

  async signup({ email, password, ip }) {
    this._checkRate(this.ipRate, ip || 'unknown', 100);
    if (!email || !password || password.length < 8) throw this._err('INVALID_INPUT', 'Invalid credentials');
    const db = readUsers();
    if (db.users.find((u) => u.email === email)) throw this._err('EMAIL_EXISTS', 'Email already exists');
    const user = { id: crypto.randomUUID(), email, passwordHash: await hashPassword(password), disabled: false, createdAt: new Date().toISOString() };
    db.users.push(user);
    writeUsers(db);
    const tokens = await this._issueTokens(user.id);
    return tokens;
  }

  async login({ email, password, ip }) {
    this._checkRate(this.ipRate, ip || 'unknown', 100);
    this._checkRate(this.userRate, email || 'unknown', 20);
    const db = readUsers();
    const user = db.users.find((u) => u.email === email);
    if (!user) throw this._err('INVALID_CREDENTIALS', 'Invalid credentials');
    if (user.disabled) throw this._err('USER_DISABLED', 'User disabled');
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw this._err('INVALID_CREDENTIALS', 'Invalid credentials');
    return this._issueTokens(user.id);
  }

  verifyAccessToken(token, options = {}) {
    const out = this.jwt.verifyToken(token, options);
    if (!out.ok || out.payload.typ !== 'access') return null;
    return out.payload;
  }

  async refreshTokens({ refreshToken, ip }) {
    this._checkRate(this.ipRate, ip || 'unknown', 100);
    const session = await this.refresh.rotate(refreshToken);
    const newRefresh = await this.refresh.issue({ userId: session.userId, sessionId: session.sessionId, ttlSec: this.refreshTtlSec });
    const accessToken = this.jwt.signToken({ sub: session.userId, type: 'access', ttlSec: this.accessTtlSec, extra: { sid: session.sessionId } });
    return { accessToken, refreshToken: newRefresh, sessionId: session.sessionId };
  }

  revokeSession(sessionId) {
    this.refresh.revokeSession(sessionId);
  }

  rotateKeys() {
    return this.keyStore.rotateKeys();
  }
}

module.exports = { AuthEngine };
