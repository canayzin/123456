const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_FILE = path.join(process.cwd(), 'secrets', 'keys.json');

function readKeys() {
  try {
    return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  } catch {
    return { activeKid: null, keys: [] };
  }
}

function writeKeys(data) {
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify(data, null, 2));
}

class KeyStore {
  constructor({ graceSec = 3600 } = {}) {
    this.graceSec = graceSec;
    const state = readKeys();
    if (!state.activeKid || state.keys.length === 0) {
      this.rotateKeys();
    }
  }

  getState() {
    return readKeys();
  }

  getActiveKey() {
    const state = this.getState();
    return state.keys.find((k) => k.kid === state.activeKid) || null;
  }

  getKeyByKid(kid) {
    const state = this.getState();
    return state.keys.find((k) => k.kid === kid) || null;
  }

  getVerifiableKeys() {
    const state = this.getState();
    const now = Math.floor(Date.now() / 1000);
    return state.keys.filter((k) => k.status === 'active' || (k.status === 'grace' && (k.graceUntil || 0) > now));
  }

  rotateKeys() {
    const state = this.getState();
    const now = Math.floor(Date.now() / 1000);
    for (const key of state.keys) {
      if (key.status === 'active') {
        key.status = 'grace';
        key.graceUntil = now + this.graceSec;
      }
    }
    const kid = crypto.randomBytes(8).toString('hex');
    state.keys.push({
      kid,
      secret: crypto.randomBytes(32).toString('hex'),
      createdAt: now,
      status: 'active'
    });
    state.activeKid = kid;
    writeKeys(state);
    return kid;
  }
}

module.exports = { KeyStore };
