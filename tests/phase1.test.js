const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TenantModel } = require('../tenant/model');
const { IdentityPlatform } = require('../services/auth/index');

const files = [
  path.join(process.cwd(), 'data', 'users.json'),
  path.join(process.cwd(), 'data', 'refreshTokens.json'),
  path.join(process.cwd(), 'data', 'authLockouts.json'),
  path.join(process.cwd(), 'data', 'audit.log'),
  path.join(process.cwd(), 'data', 'tenants.json'),
  path.join(process.cwd(), 'secrets', 'keys.json')
];

function reset() {
  for (const f of files) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (f.endsWith('.log')) fs.writeFileSync(f, '');
    else fs.writeFileSync(f, JSON.stringify({ users: [], records: [], organizations: [], activeKid: null, keys: [] }));
  }
}

test('phase1 tenant + identity flow', async () => {
  reset();
  const tenants = new TenantModel();
  const identity = new IdentityPlatform();
  const tenant = tenants.ensureProject({ organization: 'o1', project: 'p1', environment: 'dev' });
  const signup = await identity.signup({ tenant, email: 'a@x.com', password: 'password123', ip: '1.1.1.1' });
  assert.ok(signup.accessToken);
  const login = await identity.login({ tenant, email: 'a@x.com', password: 'password123', ip: '1.1.1.1' });
  const payload = identity.verifyAccessToken(login.accessToken);
  assert.ok(payload && payload.sub);
});

