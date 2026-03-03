const http = require('node:http');
const { spawn } = require('node:child_process');

function req(port, path = '/healthz') {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const r = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  const port = 20080 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['server/cluster.js'], {
    cwd: process.cwd(),
    env: { ...process.env, CLUSTER: '1', CLUSTER_WORKERS: '2', PORT: String(port), LOG_FORMAT: 'json' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((r) => setTimeout(r, 1800));
    const samples = [];
    for (let i = 0; i < 1000; i += 1) {
      const r = await req(port);
      if (r.status !== 200) throw new Error(`non-200: ${r.status}`);
      samples.push(r.ms);
    }
    samples.sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p95 = samples[Math.floor(samples.length * 0.95)];
    console.log(JSON.stringify({ phase: 25, mode: 'cluster', workers: 2, requests: samples.length, avgMs: Number(avg.toFixed(2)), p95Ms: Number(p95.toFixed(2)) }, null, 2));
  } catch (e) {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
  }
})();
