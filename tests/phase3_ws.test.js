const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { app, identity, tenants, docdb, realtime } = require('../server/index');
const { decodeFrames, encodeFrame } = require('../realtime/wsFrames');

const cleanupFiles = [
  path.join(process.cwd(), 'data', 'docdb.json'),
  path.join(process.cwd(), 'data', 'users.json'),
  path.join(process.cwd(), 'data', 'refreshTokens.json'),
  path.join(process.cwd(), 'data', 'authLockouts.json'),
  path.join(process.cwd(), 'data', 'audit.log'),
  path.join(process.cwd(), 'data', 'tenants.json'),
  path.join(process.cwd(), 'secrets', 'keys.json')
];

function reset() {
  for (const f of cleanupFiles) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (f.endsWith('.log')) fs.writeFileSync(f, '');
    else if (f.endsWith('docdb.json')) fs.writeFileSync(f, JSON.stringify({ collections: {}, indexes: {} }));
    else if (f.endsWith('users.json')) fs.writeFileSync(f, JSON.stringify({ users: [] }));
    else if (f.endsWith('refreshTokens.json')) fs.writeFileSync(f, JSON.stringify({ records: [] }));
    else if (f.endsWith('authLockouts.json')) fs.writeFileSync(f, JSON.stringify({ users: {} }));
    else if (f.endsWith('tenants.json')) fs.writeFileSync(f, JSON.stringify({ organizations: [] }));
    else if (f.endsWith('keys.json')) fs.writeFileSync(f, JSON.stringify({ activeKid: null, keys: [] }));
    else fs.writeFileSync(f, '{}');
  }
}

function maskClientFrame(text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  let head;
  if (payload.length < 126) {
    head = Buffer.from([0x81, 0x80 | payload.length]);
  } else {
    head = Buffer.from([0x81, 0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  }
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i += 1) body[i] ^= mask[i % 4];
  return Buffer.concat([head, mask, body]);
}

async function openWs(port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.write(
        `GET /v1/realtime HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`
      );
    });
    socket.once('error', reject);
    socket.once('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (!text.includes('101 Switching Protocols')) return reject(new Error('handshake failed'));
      const parser = { buffer: Buffer.alloc(0) };
      const messages = [];
      socket.on('data', (data) => {
        const frames = decodeFrames(parser, data, { requireMasked: false });
        for (const f of frames) messages.push(JSON.parse(f.text));
      });
      resolve({ socket, messages, send: (obj) => socket.write(maskClientFrame(JSON.stringify(obj))) });
    });
  });
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
}

function getMetrics(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/metrics`, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve(JSON.parse(out)));
    }).on('error', reject);
  });
}

test('phase3 realtime handshake/auth/subscriptions/backpressure/metrics', async () => {
  reset();
  realtime.quotaHook = () => true;
  realtime.connections.clear();
  realtime.metrics.ws_connections_active = 0;
  realtime.metrics.ws_messages_in_total = 0;
  realtime.metrics.ws_messages_out_total = 0;
  realtime.metrics.ws_subscriptions_active = 0;
  realtime.metrics.ws_queue_dropped_total = 0;
  realtime.metrics.ws_slow_disconnect_total = 0;
  realtime.metrics.ws_auth_fail_total = 0;

  identity.rotateKeys();
  const tenant = tenants.ensureProject({ organization: 'o1', project: 'p1', environment: 'dev' });
  await identity.signup({ tenant, email: 'x@example.com', password: 'password123', ip: '1.1.1.1' });
  const login = await identity.login({ tenant, email: 'x@example.com', password: 'password123', ip: '1.1.1.1' });
  const access = identity.verifyAccessToken(login.accessToken);

  const server = app.listen(0);
  const port = server.address().port;

  const ws1 = await openWs(port);
  ws1.send({ type: 'AUTH', requestId: 'a1', accessToken: login.accessToken });
  await waitFor(() => ws1.messages.find((m) => m.type === 'READY' && m.requestId === 'a1'));

  ws1.send({ type: 'SUBSCRIBE', requestId: 's1', subType: 'docdb.doc', topic: { collection: 'todos', docId: '1' } });
  const subDoc = await waitFor(() => ws1.messages.find((m) => m.type === 'SUBSCRIBED' && m.requestId === 's1'));
  await waitFor(() => ws1.messages.find((m) => m.type === 'EVENT' && m.subId === subDoc.subId));

  docdb.collection('todos').doc('1').set({ owner: access.sub, title: 'hello' });
  await waitFor(() => ws1.messages.filter((m) => m.type === 'EVENT' && m.subId === subDoc.subId).length >= 2);

  ws1.send({
    type: 'SUBSCRIBE',
    requestId: 'q1',
    subType: 'docdb.query',
    topic: { collection: 'todos' },
    querySpec: { where: [{ field: 'owner', op: '==', value: access.sub }], orderBy: [{ field: 'title', direction: 'asc' }] }
  });
  const subQuery = await waitFor(() => ws1.messages.find((m) => m.type === 'SUBSCRIBED' && m.requestId === 'q1'));
  const qEvent1 = await waitFor(() => ws1.messages.find((m) => m.type === 'EVENT' && m.subId === subQuery.subId));
  assert.equal(Array.isArray(qEvent1.data.docs), true);
  docdb.collection('todos').doc('2').set({ owner: access.sub, title: 'world' });
  await waitFor(() => ws1.messages.filter((m) => m.type === 'EVENT' && m.subId === subQuery.subId).length >= 2);

  ws1.send({ type: 'UNSUBSCRIBE', requestId: 'u1', subId: subQuery.subId });
  await waitFor(() => ws1.messages.find((m) => m.type === 'UNSUBSCRIBED' && m.requestId === 'u1' && m.ok === true));

  const ws2 = await openWs(port);
  ws2.send({ type: 'AUTH', requestId: 'bad', accessToken: 'nope' });
  await waitFor(() => ws2.messages.find((m) => m.type === 'ERROR' && m.error.code === 'UNAUTHORIZED'));

  assert.deepEqual(decodeFrames({ buffer: Buffer.alloc(0) }, maskClientFrame('{"x":1}'))[0].text, '{"x":1}');
  assert.equal(JSON.parse(encodeFrame('{"y":2}').subarray(2).toString()).y, 2);

  const ws3 = await openWs(port);
  ws3.socket.pause();
  ws3.send({ type: 'AUTH', requestId: 'bp1', accessToken: login.accessToken });
  await waitFor(() => realtime.connections.size >= 2);
  const conn = [...realtime.connections.values()].find((c) => c.socket.remotePort === ws3.socket.localPort);
  conn.queue.maxQueueLen = 2;
  conn.queue.maxQueueBytes = 128;
  for (let i = 0; i < 20; i += 1) realtime.sendEvent(conn, 'x', 'snapshot', { sequence: i, data: 'z'.repeat(200) });
  await waitFor(() => realtime.metrics.ws_slow_disconnect_total >= 1);

  const m = await getMetrics(port);
  assert.ok(m.realtime.ws_messages_in_total >= 4);
  assert.ok(m.realtime.ws_messages_out_total >= 4);
  assert.ok(m.realtime.ws_auth_fail_total >= 1);
  assert.ok(m.realtime.ws_slow_disconnect_total >= 1);

  ws1.socket.end();
  ws2.socket.end();
  ws3.socket.end();
  server.close();
});
