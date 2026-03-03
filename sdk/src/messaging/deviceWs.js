const net = require('net');
const crypto = require('crypto');

function encodeMasked(text) {
  const p = Buffer.from(text);
  const key = crypto.randomBytes(4);
  const out = Buffer.alloc(2 + 4 + p.length);
  out[0] = 0x81;
  out[1] = 0x80 | p.length;
  key.copy(out, 2);
  for (let i = 0; i < p.length; i += 1) out[6 + i] = p[i] ^ key[i % 4];
  return out;
}

function connectDevice({ baseUrl, projectId, token, onMessage }) {
  const u = new URL(baseUrl);
  const sock = net.createConnection({ host: u.hostname, port: Number(u.port || 80) });
  const wsKey = crypto.randomBytes(16).toString('base64');
  sock.write(`GET /v1/device HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${wsKey}\r\nx-project: ${projectId}\r\n\r\n`);
  sock.on('data', (buf) => {
    const txt = buf.toString('utf8');
    if (txt.startsWith('HTTP/1.1')) {
      sock.write(encodeMasked(JSON.stringify({ type: 'HELLO', token })));
      return;
    }
    if (buf.length > 2 && (buf[0] & 0x0f) === 0x1) {
      const len = buf[1] & 0x7f;
      const start = 2;
      const data = buf.slice(start, start + len).toString('utf8');
      try { onMessage && onMessage(JSON.parse(data)); } catch {}
    }
  });
  return { close: () => sock.end() };
}

module.exports = { connectDevice };
