const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, request } = require('./load/_helpers');

async function runBurst(token, n) {
  const statuses = [];
  const codes = [];
  for (let i = 0; i < n; i += 1) {
    const out = await request('POST', '/v1/projects/qp/sync', { headers: { authorization: `Bearer ${token}` }, body: { actorId: 'q', sinceVersion: 0, ops: [{ collection: 'todos', docId: 'q1', lamport: i + 1, wallTime: Date.now(), type: 'setField', field: 'x', value: i }] } });
    statuses.push(out.status);
    codes.push(out.json?.error?.code || '');
  }
  return { statuses, codes };
}

const observeQuota = {
  mode: 'observe',
  rateLimit: { ip: { reqPerMin: 100000 }, uid: { reqPerMin: 100000 } },
  limits: {
    docdb: { readsPerMin: 100000, writesPerMin: 100000 },
    storage: { bytesWritePerDay: 1073741824, bytesReadPerDay: 1073741824, opsPerMin: 100000 },
    functions: { invocationsPerMin: 100000, maxTimeoutMs: 10000 },
    ws: { connections: 1000, messagesPerMin: 30000 },
    sync: { opsPerMin: 100000 }
  }
};

const enforceQuota = {
  mode: 'enforce',
  rateLimit: { ip: { reqPerMin: 2 }, uid: { reqPerMin: 2 } },
  limits: {
    docdb: { readsPerMin: 2, writesPerMin: 2 },
    storage: { bytesWritePerDay: 1024, bytesReadPerDay: 1024, opsPerMin: 2 },
    functions: { invocationsPerMin: 2, maxTimeoutMs: 10000 },
    ws: { connections: 1000, messagesPerMin: 30000 },
    sync: { opsPerMin: 2 }
  }
};

test('phase10 quota observe vs enforce under load', async () => {
  const child = await startServer({ EMULATOR: '1' });
  try {
    await request('POST', '/__emulator/reset', { body: {} });
    await request('POST', '/__emulator/seed', { body: { projectId: 'qp', users: [{ email: 'q@x.com', password: 'password1' }] } });
    const login = await request('POST', '/auth/login', { headers: { 'x-project': 'qp' }, body: { email: 'q@x.com', password: 'password1' } });
    const token = login.json.accessToken;

    await request('POST', '/__emulator/seed', { body: { projectId: 'qp', quota: observeQuota } });
    const observe = await runBurst(token, 10);
    assert.equal(observe.statuses.filter((x) => x >= 400).length, 0);

    await request('POST', '/__emulator/seed', { body: { projectId: 'qp', quota: enforceQuota } });
    const enforce = await runBurst(token, 10);
    assert.ok(enforce.statuses.filter((x) => x >= 400).length > 0);
    assert.ok(enforce.codes.includes('RESOURCE_EXHAUSTED'));
  } finally { stopServer(child); }
});
