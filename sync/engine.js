const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OpsLog } = require('./opsLog');
const { ClocksStore } = require('./clocks');
const { applyToDoc, materialize } = require('./merge');
const { shouldCompact } = require('./compaction');
const { bridgeToDocdb } = require('./bridgeToDocdb');
const { syncError } = require('./errors');
const { LockMap } = require('../storage/locks');
const { append } = require('../functions/logs');

class SyncService {
  constructor({ docdb }) {
    this.docdb = docdb;
    this.opsLog = new OpsLog();
    this.clocks = new ClocksStore();
    this.locks = new LockMap();
    this.stateRoot = path.join(process.cwd(), 'data', 'sync', 'state');
    fs.mkdirSync(this.stateRoot, { recursive: true });
    this.metrics = { sync_requests_total: 0, sync_ops_applied_total: 0, sync_ops_rejected_total: 0, sync_snapshot_served_total: 0, sync_compactions_total: 0 };
    this.maxOpsPerRequest = 500;
  }

  _stateFile(projectId, collection, docId) {
    const d = path.join(this.stateRoot, projectId, collection);
    fs.mkdirSync(d, { recursive: true });
    return path.join(d, `${docId}.json`);
  }
  _readState(projectId, collection, docId) {
    try { return JSON.parse(fs.readFileSync(this._stateFile(projectId, collection, docId), 'utf8')); }
    catch { return { fields: {}, tombstones: {}, deletedTag: null }; }
  }
  _writeState(projectId, collection, docId, state) {
    const file = this._stateFile(projectId, collection, docId);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  _validateOp(op, clocks, actorId, projectId) {
    const req = ['opId', 'actorId', 'projectId', 'collection', 'docId', 'lamport', 'wallTime', 'type'];
    for (const k of req) if (op[k] === undefined || op[k] === null) throw syncError('INVALID_OP', `Missing ${k}`);
    if (op.projectId !== projectId) throw syncError('INVALID_OP', 'Project mismatch');
    if (op.actorId !== actorId) throw syncError('INVALID_OP', 'Actor mismatch');
    if (!['setField', 'removeField', 'incField', 'deleteDoc'].includes(op.type)) throw syncError('INVALID_OP', 'Invalid op type');
    if (clocks.actors[actorId] && Number(op.lamport) < Number(clocks.actors[actorId])) throw syncError('LAMPORT_REGRESSION', 'Lamport regression');
  }

  _firstSnapshot(projectId) {
    const root = path.join(this.stateRoot, projectId);
    if (!fs.existsSync(root)) return null;
    const cols = fs.readdirSync(root);
    for (const c of cols) {
      const dir = path.join(root, c);
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const docId = f.slice(0, -5);
        const st = this._readState(projectId, c, docId);
        return { collection: c, docId, state: materialize(st), meta: st };
      }
    }
    return null;
  }

  async applyOps(ops) {
    if (!ops.length) return { applied: [], rejected: [], newVersion: 0 };
    const projectId = ops[0].projectId;
    return this.locks.withLock(projectId, async () => {
      const clocks = this.clocks.read(projectId);
      const applied = []; const rejected = []; const appended = [];
      for (const op of ops) {
        try {
          this._validateOp(op, clocks, op.actorId, projectId);
          if (clocks.seen[op.opId]) continue;
          const state = this._readState(projectId, op.collection, op.docId);
          const next = applyToDoc(state, op);
          this._writeState(projectId, op.collection, op.docId, next);
          const doc = materialize(next);
          bridgeToDocdb(this.docdb, projectId, op.collection, op.docId, doc);
          clocks.version += 1;
          clocks.actors[op.actorId] = Math.max(Number(clocks.actors[op.actorId] || 0), Number(op.lamport));
          clocks.seen[op.opId] = clocks.version;
          const row = { ...op, version: clocks.version };
          appended.push(row);
          applied.push(row);
        } catch (e) {
          rejected.push({ opId: op.opId, code: e.code || 'INVALID_OP', message: e.message });
        }
      }
      this.opsLog.append(projectId, appended);
      this.clocks.write(projectId, clocks);
      this.metrics.sync_ops_applied_total += applied.length;
      this.metrics.sync_ops_rejected_total += rejected.length;
      append({ projectId, type: 'sync.apply', applied: applied.length, rejected: rejected.length });
      return { applied, rejected, newVersion: clocks.version };
    });
  }

  getState(projectId, collection, docId) {
    const s = this._readState(projectId, collection, docId);
    return { state: materialize(s), meta: s };
  }

  getOpsSince(projectId, actorId, sinceVersion = 0) {
    return this.opsLog.readAll(projectId).filter((x) => Number(x.version) > Number(sinceVersion));
  }

  compact(projectId, collection, docId) {
    return this.locks.withLock(projectId, async () => {
      const state = this._readState(projectId, collection, docId);
      const rows = this.opsLog.readAll(projectId);
      const keep = rows.filter((x) => !(x.collection === collection && x.docId === docId));
      this.opsLog.replace(projectId, keep);
      const clocks = this.clocks.read(projectId);
      clocks.compactedVersion = clocks.version;
      this.clocks.write(projectId, clocks);
      this.metrics.sync_compactions_total += 1;
      return { snapshot: { collection, docId, state: materialize(state), meta: state }, pruned: rows.length - keep.length, newVersion: clocks.version };
    });
  }

  async sync(projectId, actorId, payload, auth = {}) {
    this.metrics.sync_requests_total += 1;
    if (!auth.uid) throw syncError('UNAUTHORIZED', 'Auth required');
    if (!actorId) throw syncError('INVALID_ACTOR', 'Missing actorId');
    const ops = payload.ops || [];
    if (ops.length > this.maxOpsPerRequest) throw syncError('TOO_MANY_OPS', 'Too many ops');

    const clocks = this.clocks.read(projectId);
    clocks.actorUid[actorId] = auth.uid;
    this.clocks.write(projectId, clocks);

    const stamped = ops.map((op) => ({
      opId: op.opId || (crypto.randomUUID ? crypto.randomUUID() : crypto.createHash('sha1').update(JSON.stringify(op)).digest('hex')),
      actorId,
      projectId,
      collection: op.collection,
      docId: op.docId,
      lamport: Number(op.lamport || 0),
      wallTime: Number(op.wallTime || Date.now()),
      type: op.type,
      field: op.field,
      value: op.value
    }));

    const appliedOut = await this.applyOps(stamped);
    const nowClocks = this.clocks.read(projectId);
    let snapshot;
    if (Number(payload.sinceVersion || 0) < Number(nowClocks.compactedVersion || 0) || shouldCompact(this.opsLog.readAll(projectId).length)) {
      const first = stamped[0];
      if (first) {
        const c = await this.compact(projectId, first.collection, first.docId);
        snapshot = c.snapshot;
      } else {
        snapshot = this._firstSnapshot(projectId);
      }
      this.metrics.sync_snapshot_served_total += 1;
    }

    const missingOps = this.getOpsSince(projectId, actorId, payload.sinceVersion || 0);
    append({ projectId, type: 'sync.request', actorId, ops: ops.length, applied: appliedOut.applied.length, rejected: appliedOut.rejected.length });
    return { missingOps, newVersion: this.clocks.read(projectId).version, snapshot };
  }
}

module.exports = { SyncService };
