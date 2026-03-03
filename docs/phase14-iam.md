# Phase 14 — IAM & Service Accounts

## IAM architecture

- Added cross-cutting IAM service-level enforcement layer (`iam/*`).
- Rules engine remains data-level control; IAM performs scope checks before service operations.
- Organizations are file-backed per org at `data/iam/orgs/{orgId}.json`.

## Organization model

Hierarchy:
- organization
- project members
- custom roles
- service accounts

Built-in roles:
- owner: `all.*`
- editor: docdb/storage/functions/sync write/read family + analytics.read
- viewer: docdb.read/storage.read/analytics.read

## Scopes

Supported scopes include:
- `docdb.read`, `docdb.write`
- `storage.read`, `storage.write`, `storage.admin`
- `functions.invoke`, `functions.deploy`
- `quota.admin`, `infra.admin`, `region.failover`
- `analytics.read`, `analytics.write`
- `iam.admin`

Wildcard supported via `prefix.*` and `all.*`.

## Service accounts

Endpoints:
- `POST /v1/orgs/:orgId/projects/:projectId/service-accounts`
- `POST /v1/orgs/:orgId/projects/:projectId/service-accounts/:id/key`
- `DELETE /v1/orgs/:orgId/projects/:projectId/service-accounts/:id`

Token model:
- HMAC SHA256 signed payload
- includes `sub`, `orgId`, `projectId`, `scopes`, `iat`, `exp`
- signature + expiry + scope + org/project match are enforced

## Enforcement mapping

Implemented route-scope mapping examples:
- sync write -> `docdb.write`
- quota update -> `quota.admin`
- bucket create -> `storage.admin`
- usage read -> `analytics.read`
- region failover -> `region.failover`
- IAM admin endpoints -> `iam.admin`

## Audit

Append-only audit log path:
- `data/iam/audit.ndjson`

Entry fields:
- `ts`, `orgId`, `projectId`, `actor`, `scope`, `result`, `requestId`

## Metrics

`/metrics` includes IAM counters:
- `iam_checks_total`
- `iam_denied_total`
- `service_token_issued_total`
- `iam_audit_entries_total`
