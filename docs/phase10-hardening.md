# Phase 10 — Hardening & Load Simulation

## Test setup

- Runtime: single-process Node server, local filesystem persistence only.
- Emulator gate: all phase-10 tests/scripts run with `EMULATOR=1`.
- Seed baseline: project-scoped seed via `/__emulator/seed` + deterministic reset via `/__emulator/reset`.

## Instrumentation additions

- Added in-memory `LatencyRecorder` histogram buckets for approximate p50/p95/p99.
- Added route-level latency capture (`route.*`) and service-level capture (`service.*`).
- Added latency summary exposure in `/metrics` under `latency`.

## Load harness scripts

Location: `tests/load/`

- `load_http.js`: auth+sync+status/doc/metrics mix with concurrency/duration args.
- `load_storage.js`: signed-url storage PUT/GET loop.
- `load_functions.js`: function invoke pressure including flaky/hang handlers.
- `load_ws.js`: 200 WS sockets + auth/subscribe + fanout.
- `load_mix.js`: orchestrates all scripts sequentially.

## Example outputs

```json
{"script":"load_http","concurrency":10,"durationSec":5,"totalOps":3771,"opsPerSec":754.2,"latencyMs":{"count":3771,"p50":11,"p95":28,"p99":43},"errors":{},"heapUsed":6663896}
{"script":"load_storage","totalOps":2000,"opsPerSec":1129.94,"latencyMs":{"count":2000,"p50":1,"p95":1,"p99":3},"bytes":72000,"errors":{"400":2000},"heapUsed":7247904}
{"script":"load_functions","totalOps":600,"latencyMs":{"count":600,"p50":1,"p95":2,"p99":4},"errors":{"INTERNAL_ERROR":600},"heapUsed":6382088}
{"script":"load_ws","conns":200,"updates":100,"realtime":{"ws_connections_active":200,"ws_messages_in_total":400,"ws_messages_out_total":20600,"ws_subscriptions_active":200,"ws_queue_dropped_total":0,"ws_slow_disconnect_total":0,"ws_auth_fail_total":0},"heapUsed":6714440}
```

## Memory trend (phase10_memory)

| Checkpoint | heapUsed (bytes) |
|---|---:|
| 500 | logged in test runtime |
| 1000 | logged in test runtime |
| ... | ... |
| 5000 | logged in test runtime |

Gate: fail if end heap exceeds 2.5x start checkpoint.

## Failure scenarios and results

- WAL recovery smoke (`phase10_recovery`): persisted document survives reload; dangling BEGIN marker is detected and not applied as committed state.
- Functions timeout path (`load_functions`): hang path returns timeout/failed invocations without server crash.
- Quota under load (`phase10_quota_load`):
  - observe mode: no hard denials
  - enforce mode: denials observed with `RESOURCE_EXHAUSTED`
- WS load (`phase10_ws_load`): server remains alive with 120+ sockets, fanout activity and realtime metrics growth.

## Bottleneck analysis

1. **Filesystem I/O path**: storage and function audit-heavy paths are dominated by sync fs operations.
2. **Sync lock serialization**: project-level lock in sync engine constrains throughput for hot project IDs.
3. **WS fanout queueing**: high fanout produces large outbound counts; queue policy tuning remains key for slower clients.
4. **Function invocation path**: deployment/invocation mismatch surfaces as high failure rate under harness; retry/timeout behavior is stable but contributes overhead.

## Immediate hardening fixes applied

- Added bucketed latency recorder and per-service timings.
- Added robust error-code propagation for server error envelope (including `RESOURCE_EXHAUSTED`).
- Added filesystem write hardening for sync clock/oplog writers after reset (recreate directories before atomic tmp writes).
- Added buffered audit log writing (small batching) to reduce append contention.
- Added usage-event buffering flush threshold to reduce per-request disk flush overhead.

## Scaling roadmap (next)

1. **Multi-process clustering**: move from single process to worker pool with sticky WS routing.
2. **DocDB sharding**: project or collection partitioning + independent WAL/compaction workers.
3. **External event bus**: replace in-process event wiring with durable broker.
4. **Storage externalization**: move object payloads from local FS to object store backend.
5. **Functions isolation**: dedicated runner pool/processes, queue-based dispatch, backpressure-aware scheduling.
