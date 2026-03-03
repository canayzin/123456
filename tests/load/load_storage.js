const { request, startServer, stopServer, summarizeLatency } = require('./_helpers');

(async () => {
  const child = await startServer({ EMULATOR: '1' });
  const lat = []; const errors = {}; let bytes = 0;
  try {
    await request('POST', '/__emulator/reset', { body: {} });
    await request('POST', '/__emulator/seed', { body: { projectId: 'sp', users: [{ email: 's@x.com', password: 'password1' }] } });
    const login = await request('POST', '/auth/login', { headers: { 'x-project': 'sp' }, body: { email: 's@x.com', password: 'password1' } });
    const token = login.json.accessToken;
    await request('POST', '/v1/projects/sp/buckets', { headers: { authorization: `Bearer ${token}` }, body: { bucketName: 'bucket1' } });
    for (let i = 0; i < 1000; i += 1) {
      const body = Buffer.from(`obj-${i}`);
      const signPut = await request('POST', '/v1/projects/sp/storage/sign', { headers: { authorization: `Bearer ${token}` }, body: { bucket: 'bucket1', key: `k${i}.txt`, method: 'PUT', contentType: 'text/plain', contentLength: body.length } });
      const putUrl = new URL(signPut.json.url, 'http://127.0.0.1:8080');
      const put = await request('PUT', `${putUrl.pathname}${putUrl.search}`, { headers: { 'content-type': 'text/plain' }, body });
      const signGet = await request('POST', '/v1/projects/sp/storage/sign', { headers: { authorization: `Bearer ${token}` }, body: { bucket: 'bucket1', key: `k${i}.txt`, method: 'GET' } });
      const getUrl = new URL(signGet.json.url, 'http://127.0.0.1:8080');
      const get = await request('GET', `${getUrl.pathname}${getUrl.search}`);
      lat.push(put.ms, get.ms); bytes += get.raw.length;
      if (put.status >= 400) errors[put.status] = (errors[put.status] || 0) + 1;
      if (get.status >= 400) errors[get.status] = (errors[get.status] || 0) + 1;
    }
    console.log(JSON.stringify({ script: 'load_storage', totalOps: 2000, opsPerSec: 2000 / Math.max(1, (lat.reduce((a,b)=>a+b,0)/1000)), latencyMs: summarizeLatency(lat), bytes, errors, heapUsed: process.memoryUsage().heapUsed }));
  } finally { stopServer(child); }
})();
