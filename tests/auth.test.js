const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { AuthEngine } = require('../services/auth');

const usersPath = path.join(process.cwd(), 'data', 'users.json');
const refreshPath = path.join(process.cwd(), 'data', 'refreshTokens.json');
const keysPath = path.join(process.cwd(), 'secrets', 'keys.json');

function reset() {
  fs.mkdirSync(path.dirname(usersPath), { recursive: true });
  fs.mkdirSync(path.dirname(keysPath), { recursive: true });
  fs.writeFileSync(usersPath, JSON.stringify({ users: [] }));
  fs.writeFileSync(refreshPath, JSON.stringify({ records: [] }));
  fs.writeFileSync(keysPath, JSON.stringify({ activeKid: null, keys: [] }));
}

test('auth signup/login/refresh flow works', async () => {
  reset();
  const auth = new AuthEngine();
  const session = await auth.signup({ email: 'a@b.com', password: 'password123', ip: '1.1.1.1' });
  assert.ok(session.accessToken);
  assert.ok(session.refreshToken);

  const logged = await auth.login({ email: 'a@b.com', password: 'password123', ip: '1.1.1.1' });
  const verified = auth.verifyAccessToken(logged.accessToken);
  assert.ok(verified && verified.sub);

  const refreshed = await auth.refreshTokens({ refreshToken: logged.refreshToken, ip: '1.1.1.1' });
  assert.ok(refreshed.accessToken);
});

