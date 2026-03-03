const fs = require('fs');
const path = require('path');

function monthKey(ts) { return new Date(ts).toISOString().slice(0, 7); }

class BillingAggregator {
  constructor({ checkpoints, projectStore }) {
    this.checkpoints = checkpoints;
    this.projectStore = projectStore;
    this.metrics = { billing_aggregation_runs_total: 0, billing_usage_events_processed_total: 0 };
  }

  _usageFile(projectId) { return path.join(process.cwd(), 'data', 'usage', `${projectId}.ndjson`); }
  _aggFile(projectId, month) { const d = path.join(process.cwd(), 'data', 'billing', 'aggregates', projectId); fs.mkdirSync(d, { recursive: true }); return path.join(d, `${month}.json`); }
  _loadAgg(projectId, month) { try { return JSON.parse(fs.readFileSync(this._aggFile(projectId, month), 'utf8')); } catch { return { projectId, month, totals: {} }; } }
  _saveAgg(projectId, month, agg) { const f = this._aggFile(projectId, month); const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(agg, null, 2)); fs.renameSync(t, f); }

  _map(evt) {
    const k = `${evt.service}.${evt.op}`;
    const out = {};
    if (k === 'docdb.read') out['docdb.readsPerMonth'] = evt.count || 1;
    if (k === 'docdb.write') out['docdb.writesPerMonth'] = evt.count || 1;
    if (k === 'storage.writeBytes') out['storage.bytesWritePerMonth'] = evt.bytes || 0;
    if (k === 'storage.readBytes') out['storage.bytesReadPerMonth'] = evt.bytes || 0;
    if (k === 'functions.invoke') out['functions.invocationsPerMonth'] = evt.count || 1;
    if (k === 'ws.message') out['ws.messagesPerMonth'] = evt.count || 1;
    if (k === 'sync.ops') out['sync.opsPerMonth'] = evt.count || 1;
    return out;
  }

  run(projectId) {
    this.metrics.billing_aggregation_runs_total += 1;
    const cp = this.checkpoints.get(projectId);
    const file = this._usageFile(projectId);
    if (!fs.existsSync(file)) return { processed: 0, checkpoint: cp };
    const text = fs.readFileSync(file, 'utf8');
    const slice = text.slice(cp.lastByteOffset || 0);
    const lines = slice.split('\n').filter(Boolean);
    let processed = 0;
    for (const line of lines) {
      const evt = JSON.parse(line);
      const month = monthKey(evt.ts || Date.now());
      const agg = this._loadAgg(projectId, month);
      const mapped = this._map(evt);
      for (const [k, v] of Object.entries(mapped)) agg.totals[k] = (agg.totals[k] || 0) + Number(v || 0);
      this._saveAgg(projectId, month, agg);
      processed += 1;
      cp.lastEventTs = evt.ts || Date.now();
    }
    cp.lastByteOffset = text.length;
    this.checkpoints.save(projectId, cp);
    this.metrics.billing_usage_events_processed_total += processed;

    const state = this.projectStore.get(projectId);
    const month = monthKey(Date.now());
    state.monthState.currentMonth = month;
    state.monthState.usage = this._loadAgg(projectId, month).totals;
    this.projectStore.save(projectId, state);
    return { processed, checkpoint: cp };
  }

  summary(projectId, from, to) {
    const dir = path.join(process.cwd(), 'data', 'billing', 'aggregates', projectId);
    if (!fs.existsSync(dir)) return { totals: {} };
    const totals = {};
    for (const f of fs.readdirSync(dir)) {
      const month = f.replace('.json', '');
      if (from && month < from.slice(0, 7)) continue;
      if (to && month > to.slice(0, 7)) continue;
      const row = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const [k, v] of Object.entries(row.totals || {})) totals[k] = (totals[k] || 0) + v;
    }
    return { totals };
  }
}

module.exports = { BillingAggregator };
