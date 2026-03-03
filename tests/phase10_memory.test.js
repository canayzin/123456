const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, request } = require('./load/_helpers');

test('phase10 memory trend stays bounded', async () => {
  const child = await startServer({ EMULATOR: '1' });
  const trend = [];
  try {
    await request('POST', '/__emulator/reset', { body: {} });
    await request('POST', '/__emulator/seed', { body: { projectId: 'mp', users: [{ email: 'm@x.com', password: 'password1' }] } });
    await request('POST', '/functions-deploy/mp/helloHttp', { body: { entryPath: 'functions/handlers/helloHttp.js', exportName: 'helloHttp', triggerType: 'http', timeoutMs: 1000 } });
    const login = await request('POST', '/auth/login', { headers: { 'x-project': 'mp' }, body: { email: 'm@x.com', password: 'password1' } });
    const token = login.json.accessToken;
    await request('POST', '/v1/projects/mp/buckets', { headers: { authorization: `Bearer ${token}` }, body: { bucketName: 'membkt' } });

    for (let i = 1; i <= 5000; i += 1) {
      await request('POST', '/v1/projects/mp/sync', { headers: { authorization: `Bearer ${token}` }, body: { actorId: 'mem', sinceVersion: 0, ops: [{ collection: 'todos', docId: 'm1', lamport: i, wallTime: Date.now(), type: 'setField', field: 'v', value: i }] } });
      const signPut = await request('POST', '/v1/projects/mp/storage/sign', { headers: { authorization: `Bearer ${token}` }, body: { bucket: 'membkt', key: 'm.txt', method: 'PUT', contentType: 'text/plain', contentLength: 1 } });
      const putUrl = new URL(signPut.json.url, 'http://127.0.0.1:8080');
      await request('PUT', `${putUrl.pathname}${putUrl.search}`, { headers: { 'content-type': 'text/plain', 'x-owner-uid': 'mp:m@x.com' }, body: Buffer.from('x') });
      const signGet = await request('POST', '/v1/projects/mp/storage/sign', { headers: { authorization: `Bearer ${token}` }, body: { bucket: 'membkt', key: 'm.txt', method: 'GET' } });
      const getUrl = new URL(signGet.json.url, 'http://127.0.0.1:8080');
      await request('GET', `${getUrl.pathname}${getUrl.search}`);
      await request('POST', '/functions/mp/helloHttp', { body: { i } });
      if (i % 500 === 0) trend.push(process.memoryUsage().heapUsed);
    }

    const start = trend[0];
    const end = trend[trend.length - 1];
    assert.ok(end <= start * 2.5, `heap regression start=${start} end=${end}`);
  } finally { stopServer(child); }
});
