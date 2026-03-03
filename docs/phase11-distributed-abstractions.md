# Phase 11 — Distributed Abstraction Layer

## Interfaces

New platform abstractions:
- `Store`: read/write/list/atomicWrite
- `Bus`: publish/subscribe
- `Queue`: enqueue/dequeue/ack/retry
- `ShardRouter`: deterministic logical shard route
- `LeaderElector`: simulated primary/follower election

Implemented under `/platform/*` with file+memory store, in-proc bus, outbox bus, in-memory queue, router, elector, and worker runtime.

## Outbox guarantees and limitations

- Domain side-effects append to outbox first (`data/outbox/{projectId}.ndjson`) with `{id, ts, projectId, type, payload, publishedAt?}`.
- Worker poller publishes unpublished outbox entries to in-proc bus, then marks them `publishedAt` atomically.
- This reduces “commit succeeded but event lost” within single-process/file durability model.
- Limitation: no cross-process exactly-once guarantee yet (planned in later phases with broker/DB-backed coordination).

## Worker lifecycle

- Runtime loop runs:
  1. outbox poller,
  2. queue runner (retry/ack),
  3. leader-only jobs.
- Exposes SLO-style internal metrics: queue lag, outbox size trend, publish latency samples, leader state.
- Server starts platform worker at bootstrap.

## Sharding strategy

- Logical route: `hash(projectId) % N`.
- Supports per-project override map.
- Current integration is abstraction-only (no physical shard process split yet), preserving current API surface.

## Leader election model

- Simulated election with configurable `nodeId` and `leaderId`.
- `isLeader()` gates leader-only jobs.
- Change listeners available for future runtime role transition hooks.

## Migration plan to real infra

1. `Store` → Postgres/Spanner/Cockroach drivers (atomic writes + transactions).
2. `Bus`/Outbox publish → Kafka/NATS/PubSub with outbox dispatcher.
3. `Queue` → Redis Streams / SQS / durable queue with delayed retries.
4. `LeaderElector` → etcd/consul/redis-lock/ZK lease model.
5. `ShardRouter` → config service + dynamic shard map + rebalancing.
6. Worker runtime → separate worker deployment with health checks and lag SLO alarms.
