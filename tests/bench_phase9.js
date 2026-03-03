const { spawn } = require('node:child_process');
const http = require('node:http');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port: 8080, method, path, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, EMULATOR: '1' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i += 1) {
      try {
        const ok = await request('GET', '/metrics');
        if (ok.status === 200) break;
      } catch {}
      await wait(100);
    }

    const start = Date.now();
    for (let i = 0; i < 50; i += 1) {
      const projectId = `bench-p${i}`;
      await request('POST', '/__emulator/seed', { body: { projectId, time: 1700000000000 + i, docs: [{ collection: 'bench', docId: String(i), data: { n: i } }] } });
      await request('GET', '/__emulator/status');
      await request('POST', '/__emulator/reset', { body: { projectId } });
    }
    const totalMs = Date.now() - start;
    console.log(`phase9 bench totalMs=${totalMs}`);
    console.log(`phase9 bench heapUsed=${process.memoryUsage().heapUsed}`);
  } finally {
    child.kill('SIGTERM');
  }
})();
