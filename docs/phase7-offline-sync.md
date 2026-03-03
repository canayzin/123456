# Phase 7 Offline Sync (CRDT)

Faz 7 (CRDT Offline Sync) tamamlandı.

## CRDT choice
- Document model: OR-Map.
- Field register: LWW (lamport, wallTime, actorId, opId tie-break).
- Remove strategy: **remove-wins** tombstones for fields.
- Doc delete: doc-level tombstone; no undelete in MVP.

## Operation format
- `{ opId, actorId, projectId, collection, docId, lamport, wallTime, type, field, value }`
- Types: `setField`, `removeField`, `incField`, `deleteDoc`.

## Merge rules
- Tag ordering: lamport > wallTime > actorId(lexicographic) > opId.
- `removeField` writes tombstone; later lower/equal set does not resurrect.
- `deleteDoc` blocks all future field writes (unless future explicit undelete op, not implemented).

## Persistence
- Ops log: `data/sync/ops/{projectId}.ndjson` (append-only).
- State snapshots: `data/sync/state/{projectId}/{collection}/{docId}.json`.
- Clocks/version: `data/sync/clocks/{projectId}.json`.
- Global per-project monotonic `version` used for sync protocol.

## Sync protocol
- `POST /v1/projects/:projectId/sync`
- Request: `{ actorId, sinceVersion, ops }`
- Response: `{ missingOps, newVersion, snapshot? }`
- If client is far behind / compaction path triggers, snapshot is served.

## Compaction strategy
- Threshold-based pruning (ops log length > 200) compacts target doc snapshot and prunes doc ops.
- Compaction updates `compactedVersion` and increments sync compaction metric.

## Integration
- After operation apply + merge, canonical materialized state is bridged to DocDB as system write.
- Existing docdb change hooks continue to power realtime side effects without API changes.

## Known parity gaps vs Firebase
- No client persistence layer implemented in this phase.
- No resume tokens/multi-device sync checkpoints.
- Actor-to-uid binding is lightweight (stored map, no strong attestation).
