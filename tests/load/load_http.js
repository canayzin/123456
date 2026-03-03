const { request, startServer, stopServer, summarizeLatency } = require('./_helpers');

const concurrency = Number((process.argv.find((x) => x.startsWith('--concurrency=')) || '').split('=')[1] || 50);
const durationSec = Number((process.argv.find((x) => x.startsWith('--duration=')) || '').split('=')[1] || 60);

(async () => {
  const child = await startServer({ EMULATOR: '1' });
  const lat = []; const errors = {};
  let ops = 0;
  try {
    await request('POST', '/__emulator/reset', { body: {} });
    await request('POST', '/__emulator/seed', { body: { projectId: 'loadp', users: [{ email: 'u@x.com', password: 'password1' }], docs: [{ collection: 'todos', docId: '1', data: { title: 'x' } }] } });
    const login = await request('POST', '/auth/login', { headers: { 'x-project': 'loadp' }, body: { email: 'u@x.com', password: 'password1' } });
    const token = login.json.accessToken;
    const until = Date.now() + (durationSec * 1000);

    async function worker(i) {
      while (Date.now() < until) {
        const kind = (ops + i) % 4;
        let out;
        if (kind === 0) out = await request('GET', '/metrics');
        if (kind === 1) out = await request('POST', '/v1/projects/loadp/sync', { headers: { authorization: `Bearer ${token}` }, body: { actorId: `a${i}`, sinceVersion: 0, ops: [{ collection: 'todos', docId: `${i}`, lamport: 1, wallTime: Date.now(), type: 'setField', field: 'title', value: `v${i}` }] } });
        if (kind === 2) out = await request('GET', '/__emulator/doc/todos/1?projectId=loadp');
        if (kind === 3) out = await request('GET', '/__emulator/status');
        lat.push(out.ms);
        if (out.status >= 400) errors[out.status] = (errors[out.status] || 0) + 1;
        ops += 1;
      }
    }

    await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
    const summary = summarizeLatency(lat);
    console.log(JSON.stringify({ script: 'load_http', concurrency, durationSec, totalOps: ops, opsPerSec: ops / durationSec, latencyMs: summary, errors, heapUsed: process.memoryUsage().heapUsed }));
  } finally { stopServer(child); }
})();
