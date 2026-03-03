const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function summarizeLatency(values) {
  return { count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) };
}

function request(method, path, { headers = {}, body, port = 8080 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const started = Date.now();
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json; try { json = JSON.parse(raw.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, ms: Date.now() - started, headers: res.headers, raw, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startServer(env = {}) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    try { const out = await request('GET', '/metrics'); if (out.status === 200) return child; } catch {}
    await sleep(100);
  }
  throw new Error('server boot timeout');
}

function stopServer(child) {
  if (!child) return;
  child.kill('SIGTERM');
}

function maskClientFrame(text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const head = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i += 1) body[i] ^= mask[i % 4];
  return Buffer.concat([head, mask, body]);
}

async function openWs(port = 8080, projectId = 'default-project') {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.write(`GET /v1/realtime HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nx-project: ${projectId}\r\n\r\n`);
    });
    socket.once('error', reject);
    socket.once('data', (chunk) => {
      if (!chunk.toString('utf8').includes('101 Switching Protocols')) return reject(new Error('ws handshake failed'));
      resolve({ socket, send: (obj) => socket.write(maskClientFrame(JSON.stringify(obj))) });
    });
  });
}

module.exports = { sleep, request, startServer, stopServer, summarizeLatency, openWs };
