const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { append } = require('./logs');

function readSecrets(projectId) {
  const p = path.join(process.cwd(), 'data', 'secrets', `${projectId}.json`);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { secrets: {} }; }
}

function makeContext(invocation, extra = {}) {
  const secretsCache = readSecrets(invocation.projectId);
  return {
    auth: invocation.auth || null,
    params: invocation.params || {},
    projectId: invocation.projectId,
    callId: invocation.requestId,
    requestId: invocation.requestId,
    now: Date.now(),
    functionVersion: invocation.functionVersion,
    secretValues: Object.fromEntries(Object.entries(secretsCache.secrets || {}).map(([k, v]) => [k, v.value])),
    network: { request: () => { const e = new Error('NETWORK_DISABLED'); e.code = 'NETWORK_DISABLED'; throw e; } },
    secrets: {
      get: (key) => {
        append({ projectId: invocation.projectId, type: 'functions.secrets.read', functionName: invocation.name, requestId: invocation.requestId, key });
        return secretsCache.secrets?.[key]?.value ?? null;
      }
    },
    ...extra
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('FUNCTION_TIMEOUT'), { code: 'FUNCTION_TIMEOUT' })), ms);
    promise.then((x) => { clearTimeout(t); resolve(x); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function runInProcess(handler, invocation, opts = {}) {
  const logs = [];
  const context = makeContext(invocation, { log: (level, message) => logs.push({ level, message, ts: Date.now() }) });
  const out = await withTimeout(Promise.resolve(handler(invocation.data, context)), opts.timeoutMs || 5000);
  return { result: out, logs };
}

async function runWorker(entryPath, exportName, invocation, opts = {}) {
  if (!Worker) return runInProcess(require(entryPath)[exportName], invocation, opts);
  const context = makeContext(invocation);
  const safeContext = {
    auth: context.auth,
    params: context.params,
    projectId: context.projectId,
    callId: context.callId,
    requestId: context.requestId,
    now: context.now,
    functionVersion: context.functionVersion,
    secretValues: context.secretValues
  };
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(process.cwd(), 'functions', 'workerRunner.js'), {
      workerData: { entryPath, exportName, data: invocation.data, context: safeContext, invocationMeta: { projectId: invocation.projectId, name: invocation.name, requestId: invocation.requestId } }
    });
    const t = setTimeout(() => { worker.terminate(); reject(Object.assign(new Error('FUNCTION_TIMEOUT'), { code: 'FUNCTION_TIMEOUT' })); }, opts.timeoutMs || 5000);
    worker.on('message', (m) => {
      clearTimeout(t);
      if (m.auditSecretKeys) {
        for (const key of m.auditSecretKeys) append({ projectId: invocation.projectId, type: 'functions.secrets.read', functionName: invocation.name, requestId: invocation.requestId, key });
      }
      if (m.ok) resolve({ result: m.out, logs: m.logs || [] });
      else reject(Object.assign(new Error(m.err.message), { code: m.err.code }));
    });
    worker.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

module.exports = { runInProcess, runWorker, makeContext };
