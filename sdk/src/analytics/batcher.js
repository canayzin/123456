function createBatcher(flushFn, { flushIntervalMs = 2000, batchSize = 25 } = {}) {
  const q = [];
  let t = null;
  const schedule = () => {
    if (t) return;
    t = setInterval(async () => {
      if (!q.length) return;
      const chunk = q.splice(0, batchSize);
      await flushFn(chunk);
    }, flushIntervalMs);
    if (t.unref) t.unref();
  };
  return {
    push(ev) { q.push(ev); schedule(); },
    async flushAll() { while (q.length) { const c = q.splice(0, batchSize); await flushFn(c); } },
    close() { if (t) clearInterval(t); t = null; }
  };
}

module.exports = { createBatcher };
