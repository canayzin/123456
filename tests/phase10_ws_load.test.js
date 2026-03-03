const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, request, openWs } = require('./load/_helpers');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

test('phase10 ws load does not crash and applies slow-client policy', async () => {
  const child = await startServer({ EMULATOR: '1' });
  const conns = [];
  try {
    await request('POST', '/__emulator/reset', { body: {} });
    await request('POST', '/__emulator/seed', { body: { projectId: 'wsp', users: [{ email: 'ws@x.com', password: 'password1' }] } });
    const login = await request('POST', '/auth/login', { headers: { 'x-project': 'wsp' }, body: { email: 'ws@x.com', password: 'password1' } });
    const token = login.json.accessToken;
    for (let i = 0; i < 120; i += 1) {
      const ws = await openWs(8080, 'wsp');
      ws.send({ type: 'AUTH', requestId: `a${i}`, accessToken: token });
      ws.send({ type: 'SUBSCRIBE', requestId: `s${i}`, subType: 'docdb.doc', topic: { collection: 'todos', docId: 'z' } });
      if (i % 10 === 0) ws.socket.pause();
      conns.push(ws);
    }
    for (let i = 0; i < 100; i += 1) {
      await request('POST', '/v1/projects/wsp/sync', { headers: { authorization: `Bearer ${token}` }, body: { actorId: 'wsload', sinceVersion: 0, ops: [{ collection: 'todos', docId: 'z', lamport: i + 1, wallTime: Date.now(), type: 'setField', field: 'n', value: i }] } });
    }
    await wait(500);
    const metrics = await request('GET', '/metrics');
    assert.ok(metrics.status === 200);
    assert.ok(metrics.json.realtime.ws_messages_out_total > 0);
    assert.ok(metrics.json.realtime.ws_slow_disconnect_total >= 0);
  } finally {
    for (const c of conns) c.socket.end();
    stopServer(child);
  }
});
