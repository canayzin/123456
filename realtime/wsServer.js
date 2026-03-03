const { validateUpgrade, handshakeResponse } = require('./wsHandshake');
const { decodeFrames, encodeFrame } = require('./wsFrames');
const { parseMessage, validateSubscribe } = require('./protocol');
const { protocolError } = require('./errors');
const { BackpressureQueue } = require('./backpressure');
const { Subscriptions } = require('./subscriptions');

class RealtimeServer {
  constructor({ server, identity, docdb, quotaHook, rulesEngine = null } = {}) {
    this.server = server;
    this.identity = identity;
    this.docdb = docdb;
    this.quotaHook = quotaHook || (() => true);
    this.rulesEngine = rulesEngine;
    this.connections = new Map();
    this.metrics = {
      ws_connections_active: 0,
      ws_messages_in_total: 0,
      ws_messages_out_total: 0,
      ws_subscriptions_active: 0,
      ws_queue_dropped_total: 0,
      ws_slow_disconnect_total: 0,
      ws_auth_fail_total: 0
    };
    this.subscriptions = new Subscriptions({ docdb, sendEvent: (c, id, t, d) => this.sendEvent(c, id, t, d), metrics: this.metrics, rulesEngine: this.rulesEngine });
    server.on('upgrade', (req, socket) => this._onUpgrade(req, socket));
  }

  _onUpgrade(req, socket) {
    if (req.url !== '/v1/realtime') return socket.destroy();
    const check = validateUpgrade(req);
    if (!check.ok) {
      socket.write(`HTTP/1.1 ${check.status} Bad Request\r\nConnection: close\r\n\r\n`);
      return socket.destroy();
    }
    socket.write(handshakeResponse(check.key));
    const conn = {
      id: `${Date.now()}-${Math.random()}`,
      socket,
      parser: { buffer: Buffer.alloc(0) },
      queue: new BackpressureQueue(),
      auth: null,
      projectId: req.headers['x-project'] || null,
      msgWindow: { sec: Math.floor(Date.now() / 1000), count: 0 }
    };
    this.connections.set(conn.id, conn);
    this.metrics.ws_connections_active = this.connections.size;

    socket.on('data', (chunk) => this._onData(conn, chunk));
    socket.on('drain', () => conn.queue.drain((f) => socket.write(f)));
    socket.on('close', () => this._onClose(conn));
    socket.on('error', () => this._onClose(conn));
  }

  _onClose(conn) {
    this.subscriptions.cleanupConn(conn.id);
    this.connections.delete(conn.id);
    this.metrics.ws_connections_active = this.connections.size;
  }

  _send(conn, payload) {
    const frame = encodeFrame(JSON.stringify(payload));
    const out = conn.queue.enqueue(frame);
    if (!out.ok) {
      this.metrics.ws_slow_disconnect_total += 1;
      try {
        const frameErr = encodeFrame(JSON.stringify(protocolError('SLOW_CLIENT', 'Slow client disconnected', {}, payload.requestId || '')));
        conn.socket.write(frameErr);
        this.metrics.ws_messages_out_total += 1;
      } catch {}
      return conn.socket.end();
    }
    if (out.dropped) this.metrics.ws_queue_dropped_total += out.dropped;
    conn.queue.drain((f) => {
      this.metrics.ws_messages_out_total += 1;
      return conn.socket.write(f);
    });
  }

  sendError(conn, code, message, requestId, details = {}) {
    this._send(conn, protocolError(code, message, details, requestId));
  }

  sendEvent(conn, subId, eventType, data) {
    this._send(conn, { type: 'EVENT', subId, eventType, ts: Date.now(), data, seq: data.sequence || 1 });
  }

  _checkRateLimit(conn) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (conn.msgWindow.sec !== nowSec) conn.msgWindow = { sec: nowSec, count: 0 };
    conn.msgWindow.count += 1;
    if (conn.msgWindow.count > 50) throw new Error('RATE_LIMITED');
  }

  _checkExpiry(conn, requestId = '') {
    if (!conn.auth) return;
    if (conn.auth.exp && conn.auth.exp * 1000 < Date.now()) {
      this.sendError(conn, 'TOKEN_EXPIRED', 'Token expired', requestId);
      conn.socket.end();
      throw new Error('TOKEN_EXPIRED');
    }
  }

  _onData(conn, chunk) {
    try {
      const frames = decodeFrames(conn.parser, chunk, { requireMasked: true });
      for (const frame of frames) {
        if (frame.opcode === 0x8) return conn.socket.end();
        if (frame.opcode !== 0x1) throw new Error('UNSUPPORTED_OPCODE');
        this.metrics.ws_messages_in_total += 1;
        this._checkRateLimit(conn);
        const msg = parseMessage(frame.text);
        this._checkExpiry(conn, msg.requestId || '');
        this._route(conn, msg);
      }
    } catch (e) {
      this.sendError(conn, e.message || 'BAD_FRAME', 'Protocol error', '');
      if (e.message === 'RATE_LIMITED' || e.message === 'TOKEN_EXPIRED') return conn.socket.end();
    }
  }

  _route(conn, msg) {
    if (msg.type === 'HELLO') {
      if (msg.projectId) conn.projectId = msg.projectId;
      return;
    }
    if (msg.type === 'PING') return this._send(conn, { type: 'PONG', requestId: msg.requestId || '' });
    if (msg.type === 'AUTH') {
      try {
        const payload = this.identity.verifyAccessToken(msg.accessToken);
        if (!payload) throw new Error('UNAUTHORIZED');
        conn.auth = payload;
        this._checkExpiry(conn, msg.requestId || '');
        return this._send(conn, { type: 'READY', requestId: msg.requestId || '', serverTime: Date.now() });
      } catch {
        this.metrics.ws_auth_fail_total += 1;
        this.sendError(conn, 'UNAUTHORIZED', 'Invalid token', msg.requestId || '');
        return conn.socket.end();
      }
    }

    if (!conn.auth) {
      this.sendError(conn, 'UNAUTHORIZED', 'AUTH required', msg.requestId || '');
      return;
    }

    if (msg.type === 'SUBSCRIBE') {
      validateSubscribe(msg);
      const hookCtx = { type: 'subscribe', auth: conn.auth, projectId: conn.projectId, subType: msg.subType };
      if (this.quotaHook && this.quotaHook(hookCtx) === false) throw new Error('QUOTA_EXCEEDED');
      const subId = this.subscriptions.subscribe(conn, msg);
      return this._send(conn, { type: 'SUBSCRIBED', requestId: msg.requestId || '', subId });
    }

    if (msg.type === 'UNSUBSCRIBE') {
      const ok = this.subscriptions.unsubscribe(conn.id, msg.subId);
      return this._send(conn, { type: 'UNSUBSCRIBED', requestId: msg.requestId || '', subId: msg.subId, ok });
    }

    this.sendError(conn, 'UNKNOWN_TYPE', 'Unknown message type', msg.requestId || '');
  }

  metricsSnapshot() {
    return { ...this.metrics };
  }
}

module.exports = { RealtimeServer };
