const { request, startServer, stopServer, summarizeLatency } = require('./_helpers');

(async () => {
  const child = await startServer({ EMULATOR: '1' });
  const lat = []; const errors = {};
  try {
    await request('POST', '/__emulator/reset', { body: {} });
    await request('POST', '/__emulator/seed', { body: { projectId: 'fp', users: [{ email: 'f@x.com', password: 'password1' }] } });
    const login = await request('POST', '/auth/login', { headers: { 'x-project': 'fp' }, body: { email: 'f@x.com', password: 'password1' } });
    const token = login.json.accessToken;
    await request('POST', '/functions-deploy/fp/helloHttp', { body: { entryPath: 'functions/handlers/helloHttp.js', exportName: 'helloHttp', triggerType: 'http', timeoutMs: 2000 } });
    await request('POST', '/functions-deploy/fp/flaky', { body: { entryPath: 'functions/handlers/flaky.js', exportName: 'flaky', triggerType: 'http', timeoutMs: 2000, retryPolicy: { mode: 'at_least_once', maxAttempts: 3, baseDelayMs: 1 } } });
    await request('POST', '/functions-deploy/fp/hang', { body: { entryPath: 'functions/handlers/hang.js', exportName: 'hang', triggerType: 'http', timeoutMs: 20 } });
    for (let i = 0; i < 200; i += 1) {
      for (const name of ['helloHttp', 'flaky', 'hang']) {
        const out = await request('POST', `/functions/fp/${name}`, { headers: { authorization: `Bearer ${token}` }, body: { i } });
        lat.push(out.ms);
        if (out.status >= 400) {
          const code = out.json?.error?.code || out.status;
          errors[code] = (errors[code] || 0) + 1;
        }
      }
    }
    console.log(JSON.stringify({ script: 'load_functions', totalOps: 600, latencyMs: summarizeLatency(lat), errors, heapUsed: process.memoryUsage().heapUsed }));
  } finally { stopServer(child); }
})();
