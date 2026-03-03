const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(process.cwd(), 'data', 'refreshTokens.json');
const AUDIT_FILE = path.join(process.cwd(), 'data', 'audit.log');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { records: [] };
  }
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function appendAudit(event, details) {
  fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
  fs.appendFileSync(AUDIT_FILE, JSON.stringify({ ts: Date.now(), event, ...details }) + '\n');
}

function hashToken(token, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(token, salt, 64, (err, dk) => {
      if (err) return reject(err);
      resolve(dk.toString('hex'));
    });
  });
}

class RefreshStore {
  async issue({ userId, sessionId, ttlSec = 14 * 24 * 3600 }) {
    const token = crypto.randomBytes(32).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const hashed = await hashToken(token, salt);
    const store = readStore();
    store.records.push({ id: crypto.randomUUID(), sessionId, userId, salt, hashed, exp: Math.floor(Date.now() / 1000) + ttlSec, spent: false, revoked: false });
    writeStore(store);
    appendAudit('refresh_issued', { userId, sessionId });
    return token;
  }

  async rotate(refreshToken) {
    const store = readStore();
    const now = Math.floor(Date.now() / 1000);

    for (const rec of store.records) {
      const hashed = await hashToken(refreshToken, rec.salt);
      if (hashed !== rec.hashed) continue;

      if (rec.revoked || rec.exp < now) throw new Error('INVALID_REFRESH');
      if (rec.spent) {
        for (const s of store.records) {
          if (s.sessionId === rec.sessionId) s.revoked = true;
        }
        writeStore(store);
        appendAudit('refresh_reuse_detected', { userId: rec.userId, sessionId: rec.sessionId });
        throw new Error('REFRESH_REUSE_DETECTED');
      }

      rec.spent = true;
      writeStore(store);
      appendAudit('refresh_spent', { userId: rec.userId, sessionId: rec.sessionId });
      return { userId: rec.userId, sessionId: rec.sessionId };
    }

    throw new Error('INVALID_REFRESH');
  }

  revokeSession(sessionId) {
    const store = readStore();
    for (const rec of store.records) {
      if (rec.sessionId === sessionId) rec.revoked = true;
    }
    writeStore(store);
    appendAudit('session_revoked', { sessionId });
  }
}

module.exports = { RefreshStore };
