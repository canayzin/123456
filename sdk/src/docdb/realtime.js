function onSnapshotPolling(getter, cb, intervalMs = 300) {
  let closed = false;
  let prev = null;
  const t = setInterval(async () => {
    if (closed) return;
    const cur = await getter();
    const k = JSON.stringify(cur || null);
    if (k !== prev) {
      prev = k;
      cb(cur);
    }
  }, intervalMs);
  if (t.unref) t.unref();
  return () => { closed = true; clearInterval(t); };
}

module.exports = { onSnapshotPolling };
