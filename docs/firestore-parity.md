# Firestore-Class Engine (Phase 2)

## Scope
- Composite indexes (single + multi-field, ASC/DESC)
- Query planner + explain output
- Transaction layer with optimistic concurrency
- Batched writes with rollback
- Field transforms
- Cursor system
- Snapshot isolation simulation
- Rules integration (deny-before-return)

## Modules
- `services/docdb/indexEngine.js`
- `services/docdb/queryPlanner.js`
- `services/docdb/transactionManager.js`
- `services/docdb/wal.js`
- `services/docdb/transforms.js`

## Explain sample
```json
{
  "strategy": "index",
  "estimatedCost": 42,
  "usedIndex": "todos:owner:ASC|rank:DESC",
  "suggestion": null
}
```

## Deterministic behavior notes
- Queries run on a cloned snapshot for consistent reads.
- Rules filter is applied before return, so final result count may be lower than limit.
- WAL captures begin/commit/rollback and write operations for audit/recovery primitives.

## Phase report
**Faz 2 Firestore-Class tamamlandı.**
