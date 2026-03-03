# Phase 9 — Emulator Layer

## Endpoints

When `EMULATOR=1`:
- `GET /__emulator/status`
- `POST /__emulator/mode` with `{ "mode": "memory"|"file" }`
- `POST /__emulator/seed`
- `POST /__emulator/reset`

Support endpoints for deterministic validation:
- `GET /__emulator/doc/:collection/:docId`
- `GET /__emulator/quota/:projectId`

## Gating

If `EMULATOR` is not set to `1`, all `/__emulator/*` routes return `404`.

## Modes

- `memory`: in-memory emulator store reset support
- `file`: persisted mode written to `data/emulator/mode.json`

## Deterministic clock and request ID

- `POST /__emulator/seed` applies `clock.set(payload.time)` if `time` is present.
- Clock utility overrides `Date.now()` during emulator deterministic runs.
- In emulator mode only, `X-Deterministic-Id` overrides `requestId` (`x-request-id` response header).

## Seed and reset order

Seed order:
1. set clock
2. signup users (Auth)
3. set docs (DocDB)
4. create bucket + put objects (Storage)
5. set quota config (Quota)

Reset behavior:
- project reset removes project artifacts from sync, storage/object_store, quota config/counters, usage, functions registry, and audit logs.
- full reset swaps/clears global data roots and auth/docdb files.

## Known Firebase parity gaps

- Emulator auth bypass for admin routes is limited; quota validation for emulator is provided via dedicated emulator read endpoint.
- DocDB emulator inspection endpoint is admin-only to emulator mode and not part of Firebase public surface.
- Request-id determinism is available only in emulator mode for local deterministic tests.

“Faz 9 (Emulator Layer) tamamlandı.”
