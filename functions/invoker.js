const path = require('path');
const { runInProcess, runWorker } = require('./runtime');
const { append, read } = require('./logs');

class FunctionsInvoker {
  constructor({ registry, metrics, emulator = false }) {
    this.registry = registry;
    this.metrics = metrics;
    this.emulator = emulator;
    this.cold = new Set();
    this.invocations = new Map();
  }

  async invoke(projectId, name, payload = {}, ctx = {}, options = {}) {
    const fn = this.registry.latest(projectId, name);
    if (!fn) throw new Error('FUNCTION_NOT_FOUND');
    const entryPath = path.join(process.cwd(), fn.entryPath);
    const mod = require(entryPath);
    const handler = mod[fn.exportName || fn.name] || mod.default || mod.handler;
    if (typeof handler !== 'function') throw new Error('HANDLER_NOT_FOUND');

    const requestId = ctx.requestId || `${Date.now()}-${Math.random()}`;
    const invocation = {
      id: requestId,
      requestId,
      projectId,
      name,
      functionVersion: fn.version,
      auth: ctx.auth || null,
      params: ctx.params || {},
      data: payload
    };

    const start = Date.now();
    const coldKey = `${projectId}:${name}:v${fn.version}`;
    if (!this.cold.has(coldKey)) {
      this.cold.add(coldKey);
      this.metrics.coldStarts += 1;
    }

    const mode = (fn.retryPolicy && fn.retryPolicy.mode) || 'at_most_once';
    const maxAttempts = (fn.retryPolicy && fn.retryPolicy.maxAttempts) || 1;
    const baseDelayMs = (fn.retryPolicy && fn.retryPolicy.baseDelayMs) || 20;
    let attempt = 0;
    let lastErr = null;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const run = this.emulator || options.forceInProcess
          ? runInProcess(handler, invocation, { timeoutMs: fn.timeoutMs })
          : runWorker(entryPath, fn.exportName || fn.name, invocation, { timeoutMs: fn.timeoutMs });
        const out = await run;
        this.metrics.invocations += 1;
        this.metrics.totalLatency += Date.now() - start;
        append({ projectId, type: 'functions.invoke', functionName: name, requestId, attempt, ok: true, latencyMs: Date.now() - start });
        for (const row of out.logs || []) append({ projectId, type: 'functions.log', functionName: name, requestId, ...row });
        this.invocations.set(requestId, { projectId, name, payload, ctx, options });
        return { result: out.result };
      } catch (e) {
        lastErr = e;
        append({ projectId, type: 'functions.invoke', functionName: name, requestId, attempt, ok: false, error: e.message });
        if (mode !== 'at_least_once' || attempt >= maxAttempts) break;
        this.metrics.retries += 1;
        await new Promise((r) => setTimeout(r, baseDelayMs * (2 ** (attempt - 1))));
      }
    }

    this.metrics.invocations += 1;
    this.metrics.failures += 1;
    this.metrics.totalLatency += Date.now() - start;
    return { error: { code: lastErr.code || 'FUNCTION_ERROR', message: lastErr.message, details: {} } };
  }

  replayInvocation(invocationId) {
    const inv = this.invocations.get(invocationId);
    if (!inv) throw new Error('INVOCATION_NOT_FOUND');
    return this.invoke(inv.projectId, inv.name, inv.payload, { ...inv.ctx, requestId: `${invocationId}:replay` }, inv.options);
  }

  logs(projectId, name) {
    return read(projectId).filter((x) => !name || x.functionName === name);
  }
}

module.exports = { FunctionsInvoker };
