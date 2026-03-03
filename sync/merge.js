function cmpTag(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
  if (a.actorId !== b.actorId) return a.actorId > b.actorId ? 1 : -1;
  if (a.opId !== b.opId) return a.opId > b.opId ? 1 : -1;
  return 0;
}

function applyToDoc(docState, op) {
  const next = JSON.parse(JSON.stringify(docState || { fields: {}, tombstones: {}, deletedTag: null }));
  const tag = { lamport: op.lamport, wallTime: op.wallTime, actorId: op.actorId, opId: op.opId };
  if (op.type === 'deleteDoc') {
    if (cmpTag(tag, next.deletedTag) >= 0) next.deletedTag = tag;
    return next;
  }
  if (next.deletedTag) return next; // no undelete MVP

  if (op.type === 'setField' || op.type === 'incField') {
    const current = next.fields[op.field];
    if (!current || cmpTag(tag, current.tag) >= 0) {
      let value = op.value;
      if (op.type === 'incField') {
        const base = current ? Number(current.value || 0) : 0;
        value = base + Number(op.value || 0);
      }
      next.fields[op.field] = { value, tag };
    }
  }

  if (op.type === 'removeField') {
    const t = next.tombstones[op.field];
    if (!t || cmpTag(tag, t) >= 0) {
      next.tombstones[op.field] = tag;
      delete next.fields[op.field];
    }
  }

  return next;
}

function materialize(docState) {
  if (!docState || docState.deletedTag) return null;
  const out = {};
  for (const [k, v] of Object.entries(docState.fields || {})) {
    const tomb = docState.tombstones?.[k];
    if (tomb && cmpTag(tomb, v.tag) >= 0) continue; // remove-wins
    out[k] = v.value;
  }
  return out;
}

module.exports = { cmpTag, applyToDoc, materialize };
