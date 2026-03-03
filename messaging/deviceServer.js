const { validateUpgrade, handshakeResponse } = require('../realtime/wsHandshake');
const { decodeFrames, encodeFrame } = require('../realtime/wsFrames');

class DeviceServer {
  constructor({ server, service }) {
    this.service = service;
    this.connections = new Map();
    server.on('upgrade', (req, socket) => this.onUpgrade(req, socket));
  }

  onUpgrade(req, socket) {
    const m = String(req.url || '').match(/^\/v1\/projects\/([^/]+)\/messaging\/device/);
    if (!m) return;
    const check = validateUpgrade(req);
    if (!check.ok) {
      socket.write(`HTTP/1.1 ${check.status} Bad Request\r\nConnection: close\r\n\r\n`);
      return socket.destroy();
    }
    socket.write(handshakeResponse(check.key));
    const conn = { id: `${Date.now()}-${Math.random()}`, projectId: m[1], token: '', socket, parser: { buffer: Buffer.alloc(0) } };
    this.connections.set(conn.id, conn);
    this.service.metrics.messaging_device_connections_active = this.connections.size;
    socket.on('data', (chunk) => this.onData(conn, chunk));
    socket.on('close', () => this.close(conn));
    socket.on('error', () => this.close(conn));
  }

  close(conn) {
    this.connections.delete(conn.id);
    this.service.metrics.messaging_device_connections_active = this.connections.size;
  }

  send(conn, payload) {
    conn.socket.write(encodeFrame(JSON.stringify(payload)));
  }

  onData(conn, chunk) {
    const frames = decodeFrames(conn.parser, chunk, { requireMasked: true });
    for (const f of frames) {
      if (f.opcode !== 0x1) continue;
      const msg = JSON.parse(f.text || '{}');
      if (msg.type === 'HELLO') {
        const ok = this.service.isRegistered(conn.projectId, msg.token);
        if (!ok) { this.send(conn, { type: 'DENY' }); conn.socket.end(); return; }
        conn.token = msg.token;
        this.service.touchToken(conn.projectId, conn.token);
        this.send(conn, { type: 'WELCOME', ok: true });
      }
      if (msg.type === 'ACK') {
        this.service.onDeviceAck(conn.projectId, conn.token, msg.id);
      }
    }
  }

  byToken(projectId, token) {
    for (const c of this.connections.values()) if (c.projectId === projectId && c.token === token) return c;
    return null;
  }
}

module.exports = { DeviceServer };
