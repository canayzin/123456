const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptFor(key) {
  return crypto.createHash('sha1').update(`${key}${GUID}`).digest('base64');
}

function validateUpgrade(req) {
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  const connection = String(req.headers.connection || '').toLowerCase();
  const key = req.headers['sec-websocket-key'];
  if (req.method !== 'GET') return { ok: false, status: 405, reason: 'Method not allowed' };
  if (upgrade !== 'websocket') return { ok: false, status: 400, reason: 'Missing websocket upgrade' };
  if (!connection.includes('upgrade')) return { ok: false, status: 400, reason: 'Missing connection upgrade' };
  if (!key) return { ok: false, status: 400, reason: 'Missing websocket key' };
  return { ok: true, key };
}

function handshakeResponse(key) {
  const accept = acceptFor(key);
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    ''
  ].join('\r\n');
}

module.exports = { validateUpgrade, handshakeResponse, acceptFor };
