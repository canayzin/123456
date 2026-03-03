const crypto = require('crypto');
const { EventBus } = require('./eventBus');
const { Metrics } = require('./metrics');
const { LatencyRecorder } = require('./latencyRecorder');

class Kernel {
  constructor() {
    this.eventBus = new EventBus();
    this.metrics = new Metrics();
    this.latency = new LatencyRecorder();
    this.services = new Map();
  }

  register(name, service) {
    this.services.set(name, service);
  }

  get(name) {
    return this.services.get(name);
  }

  startRequest(route, opts = {}) {
    const requestId = opts.requestId || crypto.randomUUID();
    const startedAt = Date.now();
    this.metrics.inc('requests.total');
    this.metrics.inc(`route.${route}.count`);
    return { requestId, startedAt, route };
  }

  observeService(name, ms) {
    this.latency.observe(`service.${name}`, ms);
  }

  endRequest(ctx, statusCode) {
    const latencyMs = Date.now() - ctx.startedAt;
    this.metrics.observe(`route.${ctx.route}.latency_ms`, latencyMs);
    this.latency.observe(`route.${ctx.route}`, latencyMs);
    this.metrics.inc(`status.${statusCode}`);
  }
}

module.exports = { Kernel };
