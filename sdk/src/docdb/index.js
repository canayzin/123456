const { QueryRef } = require('./query');
const { onSnapshotPolling } = require('./realtime');

function createDocDb(ctx) {
  const docs = new Map();
  const actorId = `sdk_${Math.random().toString(36).slice(2, 8)}`;

  async function applyOps(ops) {
    await ctx.http.post(`/v1/projects/${ctx.projectId}/sync`, { actorId, sinceVersion: 0, ops });
  }

  function collection(name) {
    return {
      name,
      _docs: docs,
      doc(id) {
        return {
          async set(data) {
            const ops = Object.keys(data || {}).map((k, i) => ({ collection: name, docId: id, lamport: Date.now() + i, wallTime: Date.now() + i, type: 'setField', field: k, value: data[k] }));
            await applyOps(ops);
            docs.set(`${name}/${id}`, { ...(data || {}), __col: name, __id: id });
            return { ok: true };
          },
          async get() {
            return docs.get(`${name}/${id}`) || null;
          },
          onSnapshot(cb) {
            return onSnapshotPolling(() => Promise.resolve(docs.get(`${name}/${id}`) || null), cb);
          }
        };
      },
      where(field, op, value) { return new QueryRef(this, [{ field, op, value }], null, null); },
      orderBy(field, direction) { return new QueryRef(this, [], { field, direction }, null); },
      limit(n) { return new QueryRef(this, [], null, n); },
      onSnapshot(cb) { return onSnapshotPolling(async () => (await new QueryRef(this).get()).docs, cb); }
    };
  }

  return { collection };
}

module.exports = { createDocDb };
