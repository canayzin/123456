const fs = require('fs');
const path = require('path');

class RegionManager {
  constructor({ regions = ['us-east', 'eu-west', 'asia-south'], primaryRegion = 'us-east', replicationLog, secondaryFactory, metrics }) {
    this.regions = regions;
    this.primaryRegion = primaryRegion;
    this.readMode = 'strongPrimary';
    this.crossRegionDelayMs = 0;
    this.replicationLog = replicationLog;
    this.secondaryByRegion = new Map();
    this.metrics = metrics;
    this.queue = [];
    for (const r of regions) this.secondaryByRegion.set(r, secondaryFactory());
  }

  enqueue(event) {
    for (const region of this.regions) {
      if (region === this.primaryRegion) continue;
      this.queue.push({ ...event, targetRegion: region, enqueuedAt: Date.now() });
    }
    this.metrics.cross_region_queue_depth = this.queue.length;
  }

  replayCrossRegionOnce() {
    if (!this.queue.length) return 0;
    const next = this.queue[0];
    if (Date.now() - next.enqueuedAt < this.crossRegionDelayMs) {
      this.metrics.cross_region_lag_ms = this.crossRegionDelayMs;
      return 0;
    }
    this.queue.shift();
    this.secondaryByRegion.get(next.targetRegion).apply(next);
    this.metrics.cross_region_queue_depth = this.queue.length;
    this.metrics.cross_region_lag_ms = this.crossRegionDelayMs;
    return 1;
  }

  setReadMode(mode) {
    this.readMode = ['strongPrimary', 'localRegion', 'nearest'].includes(mode) ? mode : 'strongPrimary';
    return this.readMode;
  }

  setCrossRegionDelay(ms) {
    this.crossRegionDelayMs = Math.max(0, Number(ms) || 0);
    return this.crossRegionDelayMs;
  }

  resolveRegion({ callerRegion } = {}) {
    if (this.readMode === 'strongPrimary') return this.primaryRegion;
    if (this.readMode === 'localRegion') return callerRegion || this.primaryRegion;
    // nearest: simulated by lowest lag (all equal except queueed), pick primary if queue exists else first region
    return this.queue.length ? this.primaryRegion : this.regions[0];
  }

  readDoc(projectId, collection, docId, primaryRead, callerRegion) {
    const region = this.resolveRegion({ callerRegion });
    if (region === this.primaryRegion) return primaryRead(projectId, collection, docId);
    const sec = this.secondaryByRegion.get(region);
    return sec ? sec.getDoc(projectId, collection, docId) : null;
  }

  failover(nextRegion) {
    const target = this.regions.includes(nextRegion) ? nextRegion : this.regions.find((r) => r !== this.primaryRegion) || this.primaryRegion;
    this.primaryRegion = target;
    this.metrics.failover_count = (this.metrics.failover_count || 0) + 1;
    return { primaryRegion: this.primaryRegion, failoverCount: this.metrics.failover_count };
  }

  _snapRoot(region) { return path.join(process.cwd(), 'data', 'snapshots', region); }

  createSnapshot(region = this.primaryRegion) {
    const ts = Date.now();
    const root = path.join(this._snapRoot(region), String(ts));
    fs.mkdirSync(root, { recursive: true });
    const repRoot = path.join(process.cwd(), 'data', 'replication');
    const out = {
      ts,
      region,
      primaryRegion: this.primaryRegion,
      readMode: this.readMode,
      replicationFiles: []
    };
    if (fs.existsSync(repRoot)) {
      for (const f of fs.readdirSync(repRoot)) {
        if (!f.endsWith('.ndjson')) continue;
        const src = path.join(repRoot, f);
        const dst = path.join(root, f);
        fs.copyFileSync(src, dst);
        out.replicationFiles.push(f);
      }
    }
    fs.writeFileSync(path.join(root, 'snapshot.json'), JSON.stringify(out, null, 2));
    this.metrics.last_snapshot_ts = ts;
    return { region, ts, path: root };
  }

  restoreSnapshot(region = this.primaryRegion, ts) {
    const root = ts ? path.join(this._snapRoot(region), String(ts)) : this._latestSnapshot(region);
    if (!root) return { restored: false };
    const repRoot = path.join(process.cwd(), 'data', 'replication');
    fs.mkdirSync(repRoot, { recursive: true });
    for (const f of fs.readdirSync(root)) {
      if (!f.endsWith('.ndjson')) continue;
      fs.copyFileSync(path.join(root, f), path.join(repRoot, f));
    }
    return { restored: true, path: root };
  }

  _latestSnapshot(region) {
    const d = this._snapRoot(region);
    if (!fs.existsSync(d)) return null;
    const items = fs.readdirSync(d).filter((x) => /^\d+$/.test(x)).sort((a, b) => Number(b) - Number(a));
    if (!items.length) return null;
    return path.join(d, items[0]);
  }

  updateRpoRto() {
    const now = Date.now();
    this.metrics.rpo_seconds = this.metrics.last_snapshot_ts ? Math.floor((now - this.metrics.last_snapshot_ts) / 1000) : 0;
    this.metrics.region_primary = this.primaryRegion;
    this.metrics.region_health_status = this.regions.reduce((acc, r) => ({ ...acc, [r]: 'healthy' }), {});
  }
}

module.exports = { RegionManager };
