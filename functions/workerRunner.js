const { parentPort, workerData } = require('worker_threads');

(async () => {
  const logs = [];
  const secretReads = [];
  try {
    const mod = require(workerData.entryPath);
    const fn = mod[workerData.exportName];
    const base = workerData.context || {};
    const ctx = {
      ...base,
      log: (level, message) => logs.push({ level, message, ts: Date.now() }),
      secrets: { get: (key) => { secretReads.push(key); return base.secretValues?.[key] ?? null; } },
      network: { request: () => { const e = new Error('NETWORK_DISABLED'); e.code = 'NETWORK_DISABLED'; throw e; } }
    };
    const out = await fn(workerData.data, ctx);
    parentPort.postMessage({ ok: true, out, logs, auditSecretKeys: secretReads });
  } catch (e) {
    parentPort.postMessage({ ok: false, err: { message: e.message, code: e.code || '' }, logs, auditSecretKeys: secretReads });
  }
})();
