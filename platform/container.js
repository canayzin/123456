const { FileStore } = require('./store/fileStore');
const { MemoryStore } = require('./store/memoryStore');
const { InprocBus } = require('./bus/inprocBus');
const { OutboxBus } = require('./bus/outboxBus');
const { InmemQueue } = require('./queue/inmemQueue');
const { ShardRouter } = require('./sharding/router');
const { LeaderElector } = require('./leader/elector');
const { OutboxPoller } = require('./worker/outboxPoller');
const { QueueRunner } = require('./worker/queueRunner');
const { WorkerRuntime } = require('./worker/runtime');
const { ReplicationLog } = require('../replication/log');
const { PrimaryReplica } = require('../replication/primary');
const { SecondaryReplica } = require('../replication/secondary');
const { ChangeStream } = require('../replication/changeStream');
const { ConsistencyRouter } = require('../replication/consistencyRouter');
const fs = require('fs');
const path = require('path');
const { FailoverController } = require('../replication/failover');
const { RegionManager } = require('../replication/regions');

let singleton = null;

function createPlatform({ nodeId = 'node-1', leaderId = 'node-1' } = {}) {
  const metrics = {
    queueLag: 0,
    outboxSize: 0,
    publishLatencyMs: [],
    leaderState: 'unknown',
    replication_lag_ms: 0,
    replication_queue_depth: 0,
    replication_events_total: 0,
    failover_count: 0,
    followerReplayLatencyMs: [],
    cross_region_lag_ms: 0,
    cross_region_queue_depth: 0,
    rpo_seconds: 0,
    rto_seconds_last_failover: 0,
    region_primary: 'us-east',
    region_health_status: {},
    last_snapshot_ts: 0
  };
  const fileStore = new FileStore();
  const memoryStore = new MemoryStore();
  const bus = new InprocBus();
  const outbox = new OutboxBus({ bus, metrics });
  const queue = new InmemQueue();
  const router = new ShardRouter();
  const elector = new LeaderElector({ nodeId, leaderId });
  const replicationLog = new ReplicationLog();
  const primary = new PrimaryReplica();
  const secondary = new SecondaryReplica();
  const changeStream = new ChangeStream();
  const consistency = new ConsistencyRouter();
  const failover = new FailoverController({ elector, metrics });
  const regions = new RegionManager({ replicationLog, secondaryFactory: () => new SecondaryReplica(), metrics });

  const replication = {
    lagMs: 0,
    queue: [],
    append(event) {
      const projectId = event.projectId || 'global';
      const version = primary.nextVersion(projectId);
      const shardId = router.route({ projectId });
      const row = replicationLog.append(projectId, { shardId, type: event.type, payload: event.payload || {}, version });
      metrics.replication_events_total += 1;
      changeStream.publish(projectId, row);
      replication.queue.push({ ...row, enqueuedAt: Date.now() });
      regions.enqueue(row);
      metrics.replication_queue_depth = replication.queue.length;
      return row;
    },
    replayOnce() {
      if (!replication.queue.length) return 0;
      const next = replication.queue[0];
      if (Date.now() - next.enqueuedAt < replication.lagMs) {
        metrics.replication_lag_ms = replication.lagMs;
        return 0;
      }
      replication.queue.shift();
      const started = Date.now();
      secondary.apply(next);
      metrics.followerReplayLatencyMs.push(Date.now() - started);
      metrics.replication_queue_depth = replication.queue.length;
      metrics.replication_lag_ms = replication.lagMs;
      return 1;
    },
    recover(projectId) {
      const rows = replicationLog.readAll(projectId);
      for (const row of rows) {
        primary.loadVersion(projectId, row.version || 0);
        secondary.apply(row);
      }
      return rows.length;
    },
    setLag(ms) { replication.lagMs = Math.max(0, Number(ms) || 0); return replication.lagMs; },
    getLag() { return replication.lagMs; },
    subscribeChangeStream(projectId, fromVersion, onEvent) { return changeStream.subscribeChangeStream(projectId, fromVersion, onEvent); },
    readDoc(projectId, collection, docId, primaryRead) {
      return consistency.read({ projectId, collection, docId, primaryRead, secondaryRead: (p, c, d) => secondary.getDoc(p, c, d) });
    },
    setConsistency(mode) { return consistency.setMode(mode); },
    getConsistency() { return consistency.getMode(); },
    failover(nextLeaderId) { return failover.failover(nextLeaderId); },
    primaryNodeId() { return failover.primaryNodeId; },
    p95Replay() {
      const arr = metrics.followerReplayLatencyMs.slice().sort((a, b) => a - b);
      return arr.length ? arr[Math.floor(arr.length * 0.95)] : 0;
    },

    setReadMode(mode) { return regions.setReadMode(mode); },
    getReadMode() { return regions.readMode; },
    setCrossRegionDelay(ms) { return regions.setCrossRegionDelay(ms); },
    getCrossRegionDelay() { return regions.crossRegionDelayMs; },
    regionReadDoc(projectId, collection, docId, primaryRead, callerRegion) {
      return regions.readDoc(projectId, collection, docId, primaryRead, callerRegion);
    },
    createSnapshot(region) { return regions.createSnapshot(region); },
    restoreSnapshot(region, ts) { return regions.restoreSnapshot(region, ts); },
    regionFailover(region) {
      const started = Date.now();
      const out = regions.failover(region);
      failover.failover('node-2');
      metrics.rto_seconds_last_failover = (Date.now() - started) / 1000;
      return out;
    },
  };


  const repRoot = path.join(process.cwd(), 'data', 'replication');
  if (fs.existsSync(repRoot)) {
    for (const f of fs.readdirSync(repRoot)) {
      if (!f.endsWith('.ndjson')) continue;
      replication.recover(f.replace(/\.ndjson$/, ''));
    }
  }

  const poller = new OutboxPoller({ outbox, bus, metrics, replication });
  const queueRunner = new QueueRunner({ queue });
  let leaderTicks = 0;
  const worker = new WorkerRuntime({
    poller,
    queueRunner,
    elector,
    metrics,
    leaderJob: async () => { leaderTicks += 1; metrics.leaderTicks = leaderTicks; },
    afterTick: async () => { replication.replayOnce(); regions.replayCrossRegionOnce(); regions.updateRpoRto(); }
  });

  return {
    store: { fileStore, memoryStore },
    bus,
    outbox,
    queue,
    router,
    elector,
    worker,
    metrics,
    replication,
    start() { worker.start(); },
    stop() { worker.stop(); },
    appendOutbox(projectId, type, payload) { return outbox.append(projectId, type, payload); }
  };
}

function getPlatform() {
  if (!singleton) singleton = createPlatform();
  return singleton;
}

module.exports = { createPlatform, getPlatform };
