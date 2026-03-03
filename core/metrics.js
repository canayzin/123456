class Metrics {
  constructor() {
    this.counters = new Map();
    this.timings = new Map();
  }

  inc(name, by = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + by);
  }

  observe(name, ms) {
    const row = this.timings.get(name) || { count: 0, totalMs: 0, maxMs: 0 };
    row.count += 1;
    row.totalMs += ms;
    if (ms > row.maxMs) row.maxMs = ms;
    this.timings.set(name, row);
  }

  snapshot() {
    const out = { counters: {}, timings: {} };
    for (const [k, v] of this.counters.entries()) out.counters[k] = v;
    for (const [k, v] of this.timings.entries()) {
      out.timings[k] = { ...v, avgMs: v.count ? v.totalMs / v.count : 0 };
    }
    return out;
  }
}

module.exports = { Metrics };
