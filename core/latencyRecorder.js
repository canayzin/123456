class LatencyRecorder {
  constructor() {
    this.buckets = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    this.series = new Map();
  }

  _row(name) {
    if (!this.series.has(name)) this.series.set(name, { counts: new Array(this.buckets.length + 1).fill(0), total: 0, sum: 0, max: 0 });
    return this.series.get(name);
  }

  observe(name, ms) {
    const value = Math.max(0, Number(ms) || 0);
    const row = this._row(name);
    let idx = this.buckets.findIndex((x) => value <= x);
    if (idx === -1) idx = this.buckets.length;
    row.counts[idx] += 1;
    row.total += 1;
    row.sum += value;
    if (value > row.max) row.max = value;
  }

  _percentile(row, p) {
    if (!row.total) return 0;
    const target = Math.ceil(row.total * p);
    let c = 0;
    for (let i = 0; i < row.counts.length; i += 1) {
      c += row.counts[i];
      if (c >= target) return i < this.buckets.length ? this.buckets[i] : this.buckets[this.buckets.length - 1] * 2;
    }
    return 0;
  }

  summary(prefix = '') {
    const out = {};
    for (const [name, row] of this.series.entries()) {
      if (prefix && !name.startsWith(prefix)) continue;
      out[name] = {
        count: row.total,
        avgMs: row.total ? row.sum / row.total : 0,
        p50Ms: this._percentile(row, 0.5),
        p95Ms: this._percentile(row, 0.95),
        p99Ms: this._percentile(row, 0.99),
        maxMs: row.max
      };
    }
    return out;
  }
}

module.exports = { LatencyRecorder };
