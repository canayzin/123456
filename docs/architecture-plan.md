# NovaBase Dependency-Free Architecture Plan

## Scope Discipline
- Phase 1: Auth Engine + Document DB Engine + HTTP layer + SDK methods for these modules.
- Phase 1 includes unit/integration tests.
- RTDB/Storage/Functions/EventBus advanced wiring deferred to next phase.

## Components
- `services/auth.js`: signup/login, scrypt hashing, HMAC token issue/verify, refresh sessions, rate-limit.
- `services/docdb.js`: file-backed doc store, collection/doc CRUD, where/orderBy/limit, onSnapshot via EventEmitter.
- `core/server.js`: Node `http` API surface for auth + docdb.
- `core/eventBus.js`: in-memory pub/sub base for next phases.
- `sdk/client.js`: dependency-free client using global `fetch` fallback to `http/https`.
- `tests/*.test.js`: node:test suites.

## Storage
- `data/users.json`
- `data/docdb.json`

## Security
- Password hashing: `crypto.scrypt`.
- Token signing: HMAC SHA-256.
- Access/refresh expirations enforced.
- IP rate limiting with in-memory buckets.
- Standard error envelope:
  `{ "error": { "code": "STRING", "message": "...", "details": {} } }`
