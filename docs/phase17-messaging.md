# Phase 17 — Cloud Messaging (FCM-like)

## API surface
- Token register/unregister
- Topic subscribe/unsubscribe
- Send to token/topic
- Admin endpoints for receipts/DLQ/status

## Device WS protocol
Endpoint: `/v1/projects/:projectId/messaging/device`
- Client -> `HELLO { token }`
- Server -> `WELCOME` or `DENY`
- Server -> `MSG { id, payload }`
- Client -> `ACK { id }`

## Queue + retry policy
- Persisted queue in NDJSON
- Due polling with deterministic backoff
- Exponential backoff: 1s to 60s max
- Max attempts configurable (`maxAttempts`)
- Failed entries moved to DLQ

## TTL semantics
- `ttlSeconds` converted to `ttlAt`
- Expired entries marked `expired`, no delivery

## Fanout billing semantics
- Topic send expands to per-token queue entries
- Metering uses `messaging.send` op count = fanout size

## IAM scopes
- `messaging.read`
- `messaging.send`
- `messaging.admin`

## Parity gaps vs real FCM
- No APNs/FCM upstream bridge
- No OS-level background push guarantees
- Emulator/WebSocket delivery only
