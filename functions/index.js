const { FunctionsRegistry } = require('./registry');
const { FunctionsMetrics } = require('./metrics');
const { FunctionsInvoker } = require('./invoker');
const { deploy } = require('./deployer');

class FunctionsService {
  constructor({ emulator = false, rulesEngine = null } = {}) {
    this.registry = new FunctionsRegistry();
    this.metrics = new FunctionsMetrics();
    this.invoker = new FunctionsInvoker({ registry: this.registry, metrics: this.metrics, emulator });
    this.rulesEngine = rulesEngine;
  }

  deploy(projectId, meta) {
    return deploy(this.registry, projectId, meta);
  }

  list(projectId) {
    return this.registry.list(projectId);
  }

  async call(projectId, name, ctx, data) {
    if (!ctx?.auth) return { error: { code: 'UNAUTHORIZED', message: 'Auth required', details: {} } };
    return this.invoker.invoke(projectId, name, data, ctx, { forceInProcess: true });
  }

  async invokeHttp(projectId, name, req, res) {
    const chunks = [];
    await new Promise((resolve) => {
      req.on('data', (c) => chunks.push(c));
      req.on('end', resolve);
      req.on('error', resolve);
    });
    let data = {};
    try { data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch {}
    const out = await this.invoker.invoke(projectId, name, data, { requestId: req.headers['x-request-id'] || '' });
    res.writeHead(out.error ? 400 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.error ? { error: out.error } : out));
  }

  async triggerDocWrite(event) {
    const defs = this.list(event.projectId).filter((f) => f.triggerType === 'doc.write');
    for (const def of defs) {
      let payload = event;
      if (!def.admin && this.rulesEngine) {
        const visibleBefore = event.before && this.rulesEngine.canRead({ request: { auth: null } }, `/${event.collection}/${event.docId}`, event.before);
        const visibleAfter = event.after && this.rulesEngine.canRead({ request: { auth: null } }, `/${event.collection}/${event.docId}`, event.after);
        payload = { ...event, before: visibleBefore ? event.before : null, after: visibleAfter ? event.after : null };
      }
      await this.invoker.invoke(event.projectId, def.name, payload, { auth: { role: def.admin ? 'admin' : 'system' } });
    }
  }

  async triggerAuthCreate(projectId, user) {
    const defs = this.list(projectId).filter((f) => f.triggerType === 'auth.create');
    for (const def of defs) await this.invoker.invoke(projectId, def.name, user, { auth: { role: 'system' } });
  }


  async triggerStorageFinalize(event) {
    const defs = this.list(event.projectId).filter((f) => f.triggerType === 'storage.finalize');
    for (const def of defs) await this.invoker.invoke(event.projectId, def.name, event, { auth: { role: 'system' } });
  }

  logs(projectId, name) {
    return this.invoker.logs(projectId, name);
  }

  admin() {
    return { replayInvocation: (id) => this.invoker.replayInvocation(id) };
  }
}

module.exports = { FunctionsService };
