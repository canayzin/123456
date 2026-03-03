# Phase 20 — Analytics Engine

## Overview
NovaCloud Phase 20 adds a deterministic, file-backed analytics data plane:
- client event ingestion (batch)
- schema validation + abuse/PII guards
- append-only event logs
- checkpointed streaming aggregation
- dashboard-ready APIs (project + org)

## Ingestion API
`POST /v1/projects/:projectId/analytics/events`

Body fields:
- `appId`, `platform`, `uid`, `deviceId`, `country`
- `events[]` with `{ name, ts, params }`

Accepted line is enriched with:
- `receivedAt`, `requestId`, `region`
- `appCheck.mode` + `appCheck.result`

Storage partition:
- `data/analytics/events/{projectId}/{YYYY-MM-DD}.ndjson`

## Validation and abuse guards
- max batch: 100 events
- max params/event: 25 keys
- max string length: 200
- max payload size: 256KB
- event/param regex: `^[a-zA-Z][a-zA-Z0-9_]{0,39}$`

Invalid events are dropped and counted. If invalid events exceed valid events in the same batch, batch is rejected (`400`).

## PII guard
Event is rejected when:
- param key contains: `email`, `phone`, `ssn`, `password`, `token`, `secret`
- param value matches email-like pattern (`*@*.*`)

PII rejections are tracked in metrics + audit.

## App Check enforcement
Analytics uses `serviceKey = analytics.ingest`.

Behavior:
- `X-AppId` header preferred; body `appId` accepted (must match when both provided)
- if app is registered and mode is `enforce` => valid AppCheck token required
- `monitor` and `off` allow ingestion with audit/metrics recording
- if app is not registered, AppCheck check is skipped (backward compatibility)

## Aggregation model and checkpoints
Aggregator runs on `1s` unref interval and can be manually triggered.

Checkpoint file:
- `data/analytics/checkpoints/{projectId}.json` (byte offsets per partition file)

Outputs:
- `data/analytics/agg/{projectId}/daily/{YYYY-MM-DD}.json`
- `data/analytics/agg/{projectId}/hourly/{YYYY-MM-DD}.json`
- `data/analytics/agg/{projectId}/cohorts/{YYYY-MM}.json`

## Uniques approach + limits
MVP uses deterministic exact sets over hashed uid/device keys per day/hour.
Current implementation is intended for emulator/small-medium scale and should evolve to capped-set + bitmap/HLL fallback for very large workloads.

## Cohorts MVP
- `firstSeen` = first event day of uid
- cohort bucket = `YYYY-MM-DD`
- retention counters: `D1`, `D7`, `D30`

User state:
- `data/analytics/state/{projectId}/uids.json`

## Dashboard APIs
Project:
- `GET /v1/orgs/:orgId/projects/:projectId/analytics/summary?from=&to=`
- `GET /v1/orgs/:orgId/projects/:projectId/analytics/hourly?date=`
- `GET /v1/orgs/:orgId/projects/:projectId/analytics/cohorts?month=`

Org:
- `GET /v1/orgs/:orgId/analytics/overview?from=&to=` (requires `analytics.admin`)

## Multi-region note
Phase 20 stores events/aggregates in primary region local files only. Cross-region analytics replication is not yet implemented.

## Firebase parity gaps
- no attribution modeling
- no BigQuery export
- no GA4 compatibility layer
- no session stitching / advanced funnel attribution
- no sampled query engine
