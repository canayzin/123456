# Phase 5 Cloud Functions Runtime

Faz 5 (Cloud Functions Runtime) tamamlandı.

## Registry format
- Stored in `data/functions/{projectId}.json`
- Fields: `name`, `projectId`, `entryPath`, `exportName`, `timeoutMs`, `memoryMb`, `triggerType`, `retryPolicy`, `envRefs`, `version`, `deployedAt`

## Deploy / rollback flow
- `deploy()` validates module path and appends a new versioned record.
- Latest version is selected on invoke; older versions remain for rollback simulation.

## Isolation model
- Default path runs in `worker_threads` with timeout termination.
- Emulator mode and safe fallback run in-process with timeout wrapper.
- No `eval`/`Function` constructor used by runtime APIs.
- Network egress is blocked via context API (`NETWORK_DISABLED`).

## Retry semantics
- `at_most_once` or `at_least_once` policies per function.
- Exponential backoff (`baseDelayMs * 2^attempt`) with `maxAttempts`.
- Retries and failures are audit-logged.

## Audit / logging
- Append-only audit file: `data/audit/{projectId}.log`
- Events include deploys, invocations, retries, failures, and secrets reads.

## Integration points
- Auth create hook: `identity.events('auth:create')` -> functions trigger.
- DocDB write hook: `docdb:change` -> doc write trigger.
- Realtime/Rules surfaces remain unchanged; Functions are layered as hooks.

## Known parity gaps vs Firebase
- No managed autoscaling or multi-region runtime.
- No external language runtimes.
- No VPC/network egress support.
- Memory cap is simulated via metadata (not hard isolated cgroup limit).
