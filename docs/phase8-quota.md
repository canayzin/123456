# Phase 8 Quota & Abuse Engine

Faz 8 (Quota & Abuse Engine) tamamlandı.

## Config model
- File: `data/quota/{projectId}.json`
- Contains `limits`, `rateLimit`, `mode`.
- `mode` supports `observe` and `enforce`.

## Rate limit algorithm
- Deterministic sliding window counter over 60s buckets.
- Tracks both IP and UID keys.
- In enforce mode, overflow returns `RESOURCE_EXHAUSTED`.

## Enforcement points
- Global HTTP middleware pre-check (ip/uid).
- Service-specific pre-checks for:
  - functions invocation
  - storage ops/sign/get/put/delete
  - sync ops apply count
- Post-meter writes usage and counters for docdb/storage/functions/sync paths.

## Billing readiness events
- Usage events stored as NDJSON in `data/usage/{projectId}.ndjson`:
  - `{ts, projectId, service, op, count, bytes, uid, ip, requestId}`

## Admin APIs
- `GET /v1/projects/:projectId/quota`
- `PUT /v1/projects/:projectId/quota`
- `GET /v1/projects/:projectId/usage?from=&to=`
- Admin authorization: JWT payload `role == admin`.

## Metrics
- `quota_denied_total`
- `quota_checked_total`
- `rate_limit_denied_total`
- `usage_events_written_total`
- per-service totals map

## Known parity gaps vs Firebase billing
- No external billing export integration.
- No long-term warehouse pipeline.
- No adaptive dynamic quotas/plan tiers yet.
