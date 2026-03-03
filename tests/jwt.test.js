const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JwtService, b64urlEncode, b64urlDecode } = require('../services/auth/jwt');
const { KeyStore } = require('../services/auth/keys');
const { RefreshStore } = require('../services/auth/refreshStore');
const { AuthEngine } = require('../services/auth');

const keysPath = path.join(process.cwd(), 'secrets', 'keys.json');
const refreshPath = path.join(process.cwd(), 'data', 'refreshTokens.json');
const usersPath = path.join(process.cwd(), 'data', 'users.json');

function resetFiles() {
  fs.mkdirSync(path.dirname(keysPath), { recursive: true });
  fs.mkdirSync(path.dirname(refreshPath), { recursive: true });
  fs.writeFileSync(keysPath, JSON.stringify({ activeKid: null, keys: [] }));
  fs.writeFileSync(refreshPath, JSON.stringify({ records: [] }));
  fs.writeFileSync(usersPath, JSON.stringify({ users: [] }));
}

test('base64url encode/decode works', () => {
  const raw = '{"a":1}';
  const enc = b64urlEncode(raw);
  assert.equal(b64urlDecode(enc), raw);
});

test('jwt exp/nbf handling', () => {
  resetFiles();
  const ks = new KeyStore();
  const jwt = new JwtService({ keyStore: ks });
  const t = jwt.signToken({ sub: 'u1', ttlSec: 1 });
  const valid = jwt.verifyToken(t);
  assert.equal(valid.ok, true);
  const expired = jwt.verifyToken(t, { nowSec: Math.floor(Date.now() / 1000) + 5000 });
  assert.equal(expired.ok, false);
});

test('kid rotation verify with grace', () => {
  resetFiles();
  const ks = new KeyStore({ graceSec: 3600 });
  const jwt = new JwtService({ keyStore: ks });
  const t1 = jwt.signToken({ sub: 'u1', ttlSec: 600 });
  ks.rotateKeys();
  const out = jwt.verifyToken(t1);
  assert.equal(out.ok, true);
});

test('invalid signature is rejected', () => {
  resetFiles();
  const ks = new KeyStore();
  const jwt = new JwtService({ keyStore: ks });
  const t = jwt.signToken({ sub: 'u1', ttlSec: 600 });
  const tampered = `${t.slice(0, -1)}x`;
  const out = jwt.verifyToken(tampered);
  assert.equal(out.ok, false);
});

test('refresh rotation and reuse detection', async () => {
  resetFiles();
  const store = new RefreshStore();
  const first = await store.issue({ userId: 'u1', sessionId: 's1', ttlSec: 600 });
  const rotated = await store.rotate(first);
  assert.equal(rotated.sessionId, 's1');
  await assert.rejects(() => store.rotate(first));
});

test('auth engine full token flow and rate limit', async () => {
  resetFiles();
  const auth = new AuthEngine({ accessTtlSec: 600, refreshTtlSec: 600 });
  const signup = await auth.signup({ email: 'z@x.com', password: 'password123', ip: '9.9.9.9' });
  const payload = auth.verifyAccessToken(signup.accessToken);
  assert.ok(payload.sub);
  const refreshed = await auth.refreshTokens({ refreshToken: signup.refreshToken, ip: '9.9.9.9' });
  assert.ok(refreshed.accessToken);

  const limited = new AuthEngine({});
  limited._checkRate(limited.ipRate, 'ip-1', 1);
  assert.throws(() => limited._checkRate(limited.ipRate, 'ip-1', 1));
});
