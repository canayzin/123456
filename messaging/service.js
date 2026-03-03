const crypto = require('crypto');
const { TokensStore } = require('./tokensStore');
const { TopicsStore } = require('./topicsStore');
const { appendQueue, readQueue } = require('./queue');
const { appendReceipt, listReceipts } = require('./receipts');
const { appendDLQ, listDLQ } = require('./dlq');
const { createMetrics } = require('./metrics');
const { appendAudit } = require('./audit');
const { messagingError } = require('./errors');
const { backoffMs } = require('./delivery');
const { startSpan, endSpan } = require('../observability/trace');

class MessagingService {
  constructor({ billing, quotaEngine }) {
    this.tokens = new TokensStore();
    this.topics = new TopicsStore();
    this.billing = billing;
    this.quota = quotaEngine;
    this.metrics = createMetrics();
    this.pendingAcks = new Map();
    this.deviceServer = null;
    this.maxAttempts = 10;
    this.timer = setInterval(() => this.processDue().catch(() => {}), 250);
    if (this.timer.unref) this.timer.unref();
  }

  bindDeviceServer(s) { this.deviceServer = s; }
  close() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  _plan(projectId, orgId = 'default-org') { return this.billing.ensureProject(projectId, orgId).plan || 'free'; }
  _limits(plan) { return plan === 'free' ? { maxTokens: 1000, maxTopics: 100, sendsPerMonth: 100000 } : plan === 'pro' ? { maxTokens: 20000, maxTopics: 2000, sendsPerMonth: 2000000 } : { maxTokens: 100000, maxTopics: 10000, sendsPerMonth: 50000000 }; }
  _queue(projectId) { return readQueue(projectId); }

  isRegistered(projectId, token) { return this.tokens.getAll(projectId).some((x) => x.token === token); }
  touchToken(projectId, token) {
    const rows = this.tokens.getAll(projectId);
    for (const r of rows) if (r.token === token) r.lastSeenAt = Date.now();
    this.tokens.saveAll(projectId, rows);
  }

  registerToken(projectId, uid, token, meta = {}, orgId = 'default-org') {
    const rows = this.tokens.getAll(projectId);
    const lim = this._limits(this._plan(projectId, orgId));
    if (!rows.find((x) => x.token === token) && rows.length >= lim.maxTokens) throw messagingError('RESOURCE_EXHAUSTED', 'Token limit reached');
    const now = Date.now();
    const row = rows.find((x) => x.token === token);
    if (row) Object.assign(row, { uid, platform: meta.platform || row.platform, appId: meta.appId || row.appId, tags: meta.tags || row.tags || {}, lastSeenAt: now });
    else rows.push({ token, uid, platform: meta.platform || 'web', appId: meta.appId || 'default', createdAt: now, lastSeenAt: now, tags: meta.tags || {} });
    this.tokens.saveAll(projectId, rows);
    this.metrics.messaging_tokens_total = rows.length;
    this.quota.meter({ projectId, service: 'messaging', op: 'token.register', count: 1 });
    appendAudit({ type: 'token.register', projectId, uid, token });
    return { ok: true };
  }

  unregisterToken(projectId, uid, token) {
    const rows = this.tokens.getAll(projectId).filter((x) => !(x.token === token && x.uid === uid));
    this.tokens.saveAll(projectId, rows);
    const t = this.topics.get(projectId);
    for (const k of Object.keys(t.topics || {})) t.topics[k] = (t.topics[k] || []).filter((x) => x !== token);
    this.topics.save(projectId, t);
    this.metrics.messaging_tokens_total = rows.length;
    appendAudit({ type: 'token.unregister', projectId, uid, token });
    return { ok: true };
  }

  subscribeTopic(projectId, uid, token, topic, orgId = 'default-org') {
    if (!this.isRegistered(projectId, token)) throw messagingError('NOT_FOUND', 'Token not registered');
    const t = this.topics.get(projectId);
    t.topics[topic] = Array.from(new Set([...(t.topics[topic] || []), token]));
    const lim = this._limits(this._plan(projectId, orgId));
    if (Object.keys(t.topics).length > lim.maxTopics) throw messagingError('RESOURCE_EXHAUSTED', 'Topic limit reached');
    this.topics.save(projectId, t);
    this.metrics.messaging_topics_total = Object.keys(t.topics).length;
    this.quota.meter({ projectId, service: 'messaging', op: 'topic.subscribe', count: 1 });
    appendAudit({ type: 'topic.subscribe', projectId, uid, topic, token });
    return { ok: true };
  }

  unsubscribeTopic(projectId, uid, token, topic) {
    const t = this.topics.get(projectId);
    t.topics[topic] = (t.topics[topic] || []).filter((x) => x !== token);
    this.topics.save(projectId, t);
    appendAudit({ type: 'topic.unsubscribe', projectId, uid, topic, token });
    return { ok: true };
  }

  _buildEntries(projectId, message) {
    if (message.token) return [{ type: 'token', value: message.token }];
    if (message.topic) return (this.topics.get(projectId).topics[message.topic] || []).map((t) => ({ type: 'token', value: t }));
    throw messagingError('INVALID_ARGUMENT', 'token or topic required');
  }

  send(projectId, actor, message, orgId = 'default-org') {
    const targets = this._buildEntries(projectId, message);
    const now = Date.now();
    const lim = this._limits(this._plan(projectId, orgId));
    const monthSends = this.metrics.messaging_fanout_total;
    if (monthSends + targets.length > lim.sendsPerMonth) throw messagingError('RESOURCE_EXHAUSTED', 'Send cap reached');
    const ttlAt = now + (Number(message.ttlSeconds || 3600) * 1000);
    for (const t of targets) {
      const id = `msg_${now}_${crypto.randomBytes(3).toString('hex')}`;
      appendQueue(projectId, { id, ts: now, projectId, target: t, payload: message, ttlAt, attempt: 0, nextAttemptAt: now, status: 'queued', lastError: null });
      appendAudit({ type: 'send.enqueued', projectId, actor, id, target: t.value });
    }
    this.quota.meter({ projectId, service: 'messaging', op: 'send', count: targets.length });
    this.metrics.messaging_sends_total += 1;
    this.metrics.messaging_fanout_total += targets.length;
    this.metrics.messaging_queue_depth = this._queue(projectId).filter((x) => x.status === 'queued').length;
    return { messageId: `batch_${now}`, fanoutCount: targets.length };
  }

  _saveQueue(projectId, items) {
    const { appendFileSync, mkdirSync, writeFileSync } = require('fs');
    const { join } = require('path');
    const dir = join(process.cwd(), 'data', 'messaging', 'queue');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${projectId}.ndjson`);
    writeFileSync(file, `${items.map((x) => JSON.stringify(x)).join('\n')}${items.length ? '\n' : ''}`);
  }

  onDeviceAck(projectId, token, id) {
    this.pendingAcks.set(`${projectId}:${token}:${id}`, true);
    this.metrics.messaging_device_acks_total += 1;
  }

  async processDue(now = Date.now()) {
    const tick = startSpan('messaging.processDue', { now });
    const files = this.tokens; // noop for singleton access
    const projects = new Set();
    const fs = require('fs'); const path = require('path');
    const dir = path.join(process.cwd(), 'data', 'messaging', 'queue');
    if (!fs.existsSync(dir)) { endSpan(tick, 'ok', { projects: 0 }); return; }
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.ndjson')) projects.add(f.replace('.ndjson', ''));

    for (const projectId of projects) {
      const q = this._queue(projectId);
      let changed = false;
      for (const m of q) {
        if (!['queued', 'delivering'].includes(m.status)) continue;
        if (m.nextAttemptAt > now) continue;
        this.metrics.messaging_due_total += 1;
        if (now > m.ttlAt) {
          m.status = 'expired';
          appendReceipt(projectId, { ts: now, id: m.id, status: 'expired', token: m.target.value });
          this.metrics.messaging_expired_total += 1;
          changed = true;
          continue;
        }
        const conn = this.deviceServer ? this.deviceServer.byToken(projectId, m.target.value) : null;
        if (conn) {
          this.deviceServer.send(conn, { type: 'MSG', id: m.id, payload: m.payload });
          this.metrics.messaging_device_msgs_out_total += 1;
          const acked = this.pendingAcks.get(`${projectId}:${m.target.value}:${m.id}`);
          if (acked) {
            m.status = 'delivered';
            appendReceipt(projectId, { ts: now, id: m.id, status: 'delivered', token: m.target.value });
            this.metrics.messaging_delivered_total += 1;
          } else {
            m.attempt += 1;
            if (m.attempt >= this.maxAttempts) {
              m.status = 'failed';
              appendDLQ(projectId, { ...m, failedAt: now, reason: 'NO_ACK' });
              appendReceipt(projectId, { ts: now, id: m.id, status: 'failed', token: m.target.value, error: 'NO_ACK' });
              this.metrics.messaging_dlq_total += 1;
              this.metrics.messaging_failed_total += 1;
            } else {
              m.nextAttemptAt = now + backoffMs(m.attempt);
              this.metrics.messaging_retried_total += 1;
            }
          }
          changed = true;
        } else {
          m.attempt += 1;
          if (m.attempt >= this.maxAttempts) {
            m.status = 'failed';
            appendDLQ(projectId, { ...m, failedAt: now, reason: 'OFFLINE' });
            appendReceipt(projectId, { ts: now, id: m.id, status: 'failed', token: m.target.value, error: 'OFFLINE' });
            this.metrics.messaging_dlq_total += 1;
            this.metrics.messaging_failed_total += 1;
          } else {
            m.nextAttemptAt = now + backoffMs(m.attempt);
            this.metrics.messaging_retried_total += 1;
          }
          changed = true;
        }
      }
      if (changed) this._saveQueue(projectId, q);
      this.metrics.messaging_queue_depth = q.filter((x) => x.status === 'queued').length;
    }
    endSpan(tick, 'ok', { projects: projects.size });
  }

  listReceipts(projectId) { return listReceipts(projectId); }
  listDLQ(projectId) { return listDLQ(projectId); }
  status(projectId) {
    const q = this._queue(projectId);
    return { queueDepth: q.filter((x) => x.status === 'queued').length, connections: this.metrics.messaging_device_connections_active };
  }
}

module.exports = { MessagingService };
