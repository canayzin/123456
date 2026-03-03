# Phase 12 — Replication & Multi-Node Simulation

## Replication architecture

- Writes are committed on primary services as before.
- Outbox worker order is now: **outbox -> replication log -> bus publish**.
- Replication log is append-only: `data/replication/{projectId}.ndjson`.
- Secondary replica replays replication entries deterministically with optional artificial lag.

## Consistency model

- `strong`: reads route to primary state.
- `eventual`: reads route to replicated secondary state.
- Runtime toggle is available in internal admin path (`/__replication/consistency`).

## Failover behavior

- Internal failover endpoint (`/__replication/failover`) swaps primary node id using leader elector integration.
- Split-brain is avoided in simulation by single active leader id.
- Failover count is tracked in metrics.

## Change stream

- Internal API: `subscribeChangeStream(projectId, fromVersion, onEvent)`.
- Emits replication events in version order as entries are appended.
- Worker/functions can consume this stream without changing public API surface.

## Recovery behavior

- Platform container rehydrates secondary state from existing replication logs at startup.
- Primary per-project version is also recovered from the same logs.

## Metrics

Added SLO/replication metrics:
- `replication_lag_ms`
- `replication_queue_depth`
- `replication_events_total`
- `failover_count`
- `follower_replay_latency_p95`

Exposed in `/metrics` under `slo`.

## Limitations vs Firebase multi-region

- Single-process simulation only; no real network partitions.
- No quorum protocol or consensus commit.
- Secondary replay is deterministic but not physically isolated.
- Exactly-once across process crashes is best-effort in local fs model.

## Roadmap to real distributed deployment

1. Replication log -> Kafka/PubSub durable partitioned stream.
2. Secondary replay -> isolated workers per shard.
3. Consistency router -> region-aware read routing and quorum options.
4. Failover -> lease-based leader election with fencing tokens.
5. Recovery -> snapshot + log compaction/checkpointing.
