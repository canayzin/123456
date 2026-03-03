function applyTransforms(baseDoc, transformSpec = {}) {
  const doc = { ...baseDoc };
  for (const [field, op] of Object.entries(transformSpec)) {
    if (op && typeof op === 'object' && op.__op === 'increment') {
      doc[field] = Number(doc[field] || 0) + Number(op.value || 0);
    } else if (op && typeof op === 'object' && op.__op === 'arrayUnion') {
      const current = Array.isArray(doc[field]) ? doc[field] : [];
      const next = [...current];
      for (const value of op.values || []) {
        if (!next.some((x) => JSON.stringify(x) === JSON.stringify(value))) next.push(value);
      }
      doc[field] = next;
    } else if (op && typeof op === 'object' && op.__op === 'arrayRemove') {
      const current = Array.isArray(doc[field]) ? doc[field] : [];
      doc[field] = current.filter((x) => !(op.values || []).some((v) => JSON.stringify(v) === JSON.stringify(x)));
    } else if (op && typeof op === 'object' && op.__op === 'serverTimestamp') {
      doc[field] = Date.now();
    }
  }
  return doc;
}

const FieldValue = {
  increment(value) {
    return { __op: 'increment', value };
  },
  arrayUnion(...values) {
    return { __op: 'arrayUnion', values };
  },
  arrayRemove(...values) {
    return { __op: 'arrayRemove', values };
  },
  serverTimestamp() {
    return { __op: 'serverTimestamp' };
  }
};

module.exports = { applyTransforms, FieldValue };
