# Phase 16 — Hosting Engine

## Data model
- Sites: `data/hosting/sites/{projectId}.json`
- Releases log: `data/hosting/releases/{projectId}/{siteId}.ndjson`
- Artifact manifests: `data/hosting/files/{projectId}/{siteId}/{releaseId}.json`
- Artifacts: `hosting_artifacts/{projectId}/{siteId}/{releaseId}/...`
- Audit: `data/hosting/audit.ndjson`

## Config syntax
Supports:
- `cleanUrls`
- `trailingSlash` (`ignore|add|remove`)
- `headers`
- `redirects`
- `rewrites` (`static` and `function`)

Patterns support exact paths, `*`, and `**`.

## Routing order
1. Existing API routes (`/v1`, `/auth`, `/functions`, emulator/regions)
2. Hosting fallback for GET/HEAD only
3. Host header resolves mapped site domain
4. Redirects → rewrites → static resolution

## Deploy pipeline
1. Create deploy session
2. Stream upload files to staging dir
3. Finalize (staging rename to release dir atomically)
4. Activate selected release
5. Rollback to older release

## Atomicity guarantees
- Release activation only after finalize success.
- Staging dir is renamed to final release directory atomically.
- Active release swap updates site pointer as a single file write.

## Cache model
- ETag from SHA256 hash
- `If-None-Match` returns `304`
- Default cache-control:
  - HTML: `no-cache`
  - Assets: `public, max-age=3600`
- Edge cache simulation: in-memory TTL cache keyed by `(host,path,etag)`

## Function rewrite integration
- Rewrite target `function` invokes existing Functions runtime internally.
- No network hop is used.

## Plan gates + retention
- Free: single site, max 3 retained releases, custom domain disabled (except `*.localhost`).
- Pro/Enterprise: custom domain allowed.

## Firebase Hosting parity gaps
- No TLS automation
- No global CDN PoP network
- No explicit cache invalidation API
- No preview channels yet
