# Phase 3 Realtime Infrastructure Report

Faz 3 (Realtime Infrastructure) tamamlandı.

## Protocol Spec
- Endpoint: `GET /v1/realtime`
- Client messages: `HELLO`, `AUTH`, `SUBSCRIBE`, `UNSUBSCRIBE`, `PING`
- Server messages: `READY`, `SUBSCRIBED`, `UNSUBSCRIBED`, `EVENT`, `PONG`, `ERROR`
- All messages support `requestId` for end-to-end tracing.
- `SUBSCRIBE.subType` supports:
  - `docdb.doc`
  - `docdb.query`
  - `rtdb.path` (stub in this phase)
- Event payload includes `seq`/`sequence` for deterministic ordering and future resume-token foundation.

## Auth Lifecycle
1. WebSocket handshake is validated with RFC6455 `Sec-WebSocket-Accept`.
2. Client sends `AUTH` with access token.
3. Server verifies token via Phase 1/2 auth engine.
4. On success server returns `READY`; on failure returns `ERROR` and closes socket.
5. Expired token is rejected with `TOKEN_EXPIRED` and connection close.

## Backpressure Policy
- Per-connection outbound queue with configurable:
  - `maxQueueLen` (default 256)
  - `maxQueueBytes` (default 2MB)
- Policy chosen: `DISCONNECT_SLOW_CLIENT` (default).
  - Rationale: preserves deterministic delivery semantics over silent data loss.
- Metrics incremented:
  - `ws_queue_dropped_total` (for drop-oldest mode support)
  - `ws_slow_disconnect_total` when slow client is disconnected.

## Metrics Added
`GET /metrics` now includes `realtime` section with:
- `ws_connections_active`
- `ws_messages_in_total`
- `ws_messages_out_total`
- `ws_subscriptions_active`
- `ws_queue_dropped_total`
- `ws_slow_disconnect_total`
- `ws_auth_fail_total`

## Known Gaps vs Firebase
- No resume token replay yet (only sequence foundation exists).
- No offline persistence/sync orchestration.
- No multi-region fanout/replication.
- Query listener currently emits full snapshot refresh (MVP); minimal patch diff is deferred.
- RTDB path listener is interface-compatible stub in this phase.

## Load Target
- Initial target: single-process 1000 concurrent WebSocket connections.
- Measurement plan:
  - connect synthetic clients over raw TCP+WS frames,
  - subscribe to doc/query topics,
  - stream writes into DocDB,
  - record p50/p95 event latency and slow-disconnect counters.
