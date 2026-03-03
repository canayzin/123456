const fs = require('fs');
const path = require('path');
const { AuthEngine } = require('../auth');
const { EventEmitter } = require('events');
const { getPlatform } = require('../../platform/container');

const LOCK_FILE = path.join(process.cwd(), 'data', 'authLockouts.json');
const AUDIT_FILE = path.join(process.cwd(), 'data', 'audit.log');

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  } catch {
    return { users: {} };
  }
}

function writeLock(v) {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  fs.writeFileSync(LOCK_FILE, JSON.stringify(v, null, 2));
}

function audit(event, details) {
  fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
  fs.appendFileSync(AUDIT_FILE, JSON.stringify({ ts: Date.now(), event, ...details }) + '\n');
}

class IdentityPlatform {
  constructor() {
    this.auth = new AuthEngine();
    this.events = new EventEmitter();
    this.maxFailed = 5;
    this.lockoutMs = 10 * 60 * 1000;
  }

  _key(tenant, email) {
    return `${tenant.projectId}:${email}`;
  }

  _checkLock(tenant, email) {
    const lock = readLock();
    const row = lock.users[this._key(tenant, email)];
    if (row && row.lockedUntil > Date.now()) throw { error: { code: 'ACCOUNT_LOCKED', message: 'Account locked', details: { until: row.lockedUntil } } };
  }

  _recordFailure(tenant, email) {
    const lock = readLock();
    const key = this._key(tenant, email);
    const row = lock.users[key] || { failed: 0, lockedUntil: 0 };
    row.failed += 1;
    if (row.failed >= this.maxFailed) row.lockedUntil = Date.now() + this.lockoutMs;
    lock.users[key] = row;
    writeLock(lock);
  }

  _clearFailures(tenant, email) {
    const lock = readLock();
    lock.users[this._key(tenant, email)] = { failed: 0, lockedUntil: 0 };
    writeLock(lock);
  }

  async signup({ tenant, email, password, ip }) {
    const out = await this.auth.signup({ email: `${tenant.projectId}:${email}`, password, ip });
    audit('signup', { tenant: tenant.projectId, email });
    const evt = { projectId: tenant.projectId, uid: `${tenant.projectId}:${email}`, email };
    this.events.emit('auth:create', evt);
    getPlatform().appendOutbox(tenant.projectId, 'auth.create', evt);
    return out;
  }

  async login({ tenant, email, password, ip }) {
    this._checkLock(tenant, email);
    try {
      const out = await this.auth.login({ email: `${tenant.projectId}:${email}`, password, ip });
      this._clearFailures(tenant, email);
      audit('login_success', { tenant: tenant.projectId, email });
      return out;
    } catch (e) {
      this._recordFailure(tenant, email);
      audit('login_failed', { tenant: tenant.projectId, email });
      throw e;
    }
  }

  async refresh({ refreshToken, ip }) {
    const out = await this.auth.refreshTokens({ refreshToken, ip });
    audit('refresh', { sessionId: out.sessionId });
    return out;
  }

  verifyAccessToken(token) {
    return this.auth.verifyAccessToken(token);
  }

  issueCustomToken({ tenant, uid, claims = {} }) {
    const token = this.auth.jwt.signToken({ sub: `${tenant.projectId}:${uid}`, type: 'custom', ttlSec: 600, extra: { claims } });
    audit('custom_token_issued', { tenant: tenant.projectId, uid });
    return { token };
  }

  oauthBegin({ provider }) {
    return { provider, status: 'stub', authorizeUrl: `/oauth/${provider}/authorize` };
  }

  mfaChallenge() {
    return { status: 'stub', next: 'mfa_verify' };
  }

  rotateKeys() {
    return this.auth.rotateKeys();
  }
}

module.exports = { IdentityPlatform };
