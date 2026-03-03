const crypto = require('crypto');

function compileQuery(db, collection, querySpec = {}) {
  let q = db.collection(collection);
  for (const w of querySpec.where || []) q = q.where(w.field, w.op || w.operator, w.value);
  for (const o of querySpec.orderBy || []) q = q.orderBy(o.field, o.direction || 'asc');
  if (querySpec.limit) q = q.limit(querySpec.limit);
  return q;
}

function canReadDoc(conn, doc, collection, docId, rulesEngine) {
  if (!doc) return true;
  if (rulesEngine) {
    const uid = conn.auth ? String(conn.auth.sub || '').split(':').pop() : null;
    return rulesEngine.canRead({ request: { auth: { uid, role: conn.auth?.role || null }, ip: conn.ip || '', time: Date.now() } }, `/${collection}/${docId || doc.id || doc._id || ''}`, doc);
  }
  if (!conn.auth) return false;
  if (!doc.owner) return true;
  const uid = String(conn.auth.sub || '').split(':').pop();
  return doc.owner === uid || doc.owner === conn.auth.sub;
}

class Subscriptions {
  constructor({ docdb, sendEvent, metrics, rulesEngine = null }) {
    this.docdb = docdb;
    this.sendEvent = sendEvent;
    this.metrics = metrics;
    this.rulesEngine = rulesEngine;
    this.byConn = new Map();
    this.bySub = new Map();
  }

  _add(connId, sub) {
    const map = this.byConn.get(connId) || new Map();
    map.set(sub.subId, sub);
    this.byConn.set(connId, map);
    this.bySub.set(sub.subId, sub);
    this.metrics.ws_subscriptions_active += 1;
  }

  _remove(subId) {
    const sub = this.bySub.get(subId);
    if (!sub) return;
    if (sub.cleanup) sub.cleanup();
    const map = this.byConn.get(sub.connId);
    if (map) {
      map.delete(subId);
      if (!map.size) this.byConn.delete(sub.connId);
    }
    this.bySub.delete(subId);
    this.metrics.ws_subscriptions_active = Math.max(0, this.metrics.ws_subscriptions_active - 1);
  }

  cleanupConn(connId) {
    const map = this.byConn.get(connId);
    if (!map) return;
    for (const subId of map.keys()) this._remove(subId);
  }

  subscribe(conn, msg) {
    const subId = crypto.randomUUID().slice(0, 12);
    if (msg.subType === 'docdb.doc') {
      const { collection, docId } = msg.topic;
      const first = this.docdb.collection(collection).doc(docId).get();
      if (canReadDoc(conn, first, collection, docId, this.rulesEngine)) this.sendEvent(conn, subId, 'snapshot', { doc: first, sequence: 1 });
      let seq = 1;
      const onDoc = (evt) => {
        if (!evt || evt.collection !== collection || evt.docId !== docId) return;
        const doc = evt.newDoc || null;
        if (!canReadDoc(conn, doc, collection, docId, this.rulesEngine)) return;
        seq += 1;
        this.sendEvent(conn, subId, evt.type === 'delete' ? 'delete' : 'snapshot', { doc, oldDoc: evt.oldDoc || null, sequence: seq });
      };
      this.docdb.events.on('docdb:change', onDoc);
      this._add(conn.id, { subId, connId: conn.id, cleanup: () => this.docdb.events.off('docdb:change', onDoc) });
      return subId;
    }

    if (msg.subType === 'docdb.query') {
      const { collection } = msg.topic;
      let seq = 1;
      let timer = null;
      const emit = () => {
        const out = compileQuery(this.docdb, collection, msg.querySpec).get();
        const docs = out.docs.filter((d) => canReadDoc(conn, d, collection, d.id || d._id, this.rulesEngine));
        this.sendEvent(conn, subId, 'snapshot', { docs, sequence: seq });
        seq += 1;
      };
      emit();
      const listener = (evt) => {
        if (!evt || evt.collection !== collection) return;
        clearTimeout(timer);
        timer = setTimeout(emit, 50);
      };
      this.docdb.events.on('docdb:collectionChange', listener);
      this._add(conn.id, {
        subId,
        connId: conn.id,
        cleanup: () => {
          clearTimeout(timer);
          this.docdb.events.off('docdb:collectionChange', listener);
        }
      });
      return subId;
    }

    if (msg.subType === 'rtdb.path') {
      this.sendEvent(conn, subId, 'snapshot', { path: msg.topic.path, value: null, stub: true, sequence: 1 });
      this._add(conn.id, { subId, connId: conn.id, cleanup: null });
      return subId;
    }

    throw new Error('INVALID_SUB_TYPE');
  }

  unsubscribe(connId, subId) {
    const sub = this.bySub.get(subId);
    if (!sub || sub.connId !== connId) return false;
    this._remove(subId);
    return true;
  }
}

module.exports = { Subscriptions };
