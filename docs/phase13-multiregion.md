# Phase 13 — Multi-Region & Disaster Recovery Simulation

## Region architecture

- Regions configured in simulation: `us-east`, `eu-west`, `asia-south`.
- Active primary region handles authoritative reads/writes.
- Secondary region states replay cross-region replication events asynchronously.

## Routing

Read routing modes:
- `strongPrimary`: always primary region state.
- `localRegion`: caller region state.
- `nearest`: simulated nearest/lowest-lag heuristic.

## Cross-region replication

- Outbox -> replication log -> bus ordering is preserved.
- Replication events are fanned out into per-region async queues.
- Artificial cross-region lag can be configured.

Metrics:
- `cross_region_lag_ms`
- `cross_region_queue_depth`

## Failover model

- Emulator-gated internal endpoint promotes a new primary region.
- Leader model remains single-active in simulation to avoid split-brain.
- `failover_count` and `rto_seconds_last_failover` are tracked.

## DR strategy (snapshot/restore)

- Snapshot path: `data/snapshots/{region}/{timestamp}/`.
- Includes replication log copies and snapshot metadata.
- Restore copies snapshot replication files back into active replication storage.
- RPO is approximated via time since last snapshot (`rpo_seconds`).

## Limitations vs real cloud

- Single-process simulation only.
- No real network partitions or quorum consensus.
- Snapshot is file-copy based, not crash-consistent across all stores.
- Region health is synthetic (`healthy`) for all configured regions.

## Roadmap

1. Region-specific durable streams (Kafka/PubSub partitions).
2. Dedicated per-region replica workers.
3. Consensus-backed failover with fencing.
4. Incremental snapshots + WAL compaction.
5. Region-aware traffic steering with latency probes.
