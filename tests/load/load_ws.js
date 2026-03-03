const { request, startServer, stopServer, openWs, sleep } = require('./_helpers');

(async () => {
  const child = await startServer({ EMULATOR: '1' });
  const sockets = [];
  try {
    await request('POST', '/__emulator/reset', { body: {} });
    await request('POST', '/__emulator/seed', { body: { projectId: 'wp', users: [{ email: 'w@x.com', password: 'password1' }] } });
    const login = await request('POST', '/auth/login', { headers: { 'x-project': 'wp' }, body: { email: 'w@x.com', password: 'password1' } });
    for (let i = 0; i < 200; i += 1) {
      const ws = await openWs(8080, 'wp');
      ws.send({ type: 'AUTH', requestId: `a${i}`, accessToken: login.json.accessToken });
      ws.send({ type: 'SUBSCRIBE', requestId: `s${i}`, subType: 'docdb.doc', topic: { collection: 'todos', docId: 'fan' } });
      if (i % 20 === 0) ws.socket.pause();
      sockets.push(ws);
    }
    for (let i = 0; i < 100; i += 1) {
      await request('POST', '/v1/projects/wp/sync', { headers: { authorization: `Bearer ${login.json.accessToken}` }, body: { actorId: 'ws', sinceVersion: 0, ops: [{ collection: 'todos', docId: 'fan', lamport: i + 1, wallTime: Date.now(), type: 'setField', field: 'v', value: i }] } });
    }
    await sleep(500);
    const metrics = await request('GET', '/metrics');
    console.log(JSON.stringify({ script: 'load_ws', conns: 200, updates: 100, realtime: metrics.json.realtime, heapUsed: process.memoryUsage().heapUsed }));
  } finally { for (const ws of sockets) ws.socket.end(); stopServer(child); }
})();
