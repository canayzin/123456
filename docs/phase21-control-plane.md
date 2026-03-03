# Phase 21 — Control Plane API

Phase 21 adds SaaS control-plane primitives on top of NovaCloud data-plane services.

## Domain model
- Organization: `orgId`, `name`, `ownerUid`, `plan`, `status`, `createdAt`
- Project: `projectId`, `orgId`, `name`, `environment`, `regionPrimary`, `status`, `createdAt`, `apiKeys`, `publicConfig`
- API Key: `keyId`, `projectId`, `type`, `scopes`, `createdAt`, `lastUsedAt`, `revoked`

Storage:
- `data/control/orgs/{orgId}.json`
- `data/control/projects/{projectId}.json`
- `data/control/audit.ndjson`

## API keys
- public key prefix: `pk_live_`
- server key prefix: `sk_live_`
- key material shown only at creation time
- keys stored hash-only (SHA-256) at rest
- revoke support + lastUsedAt updates

## Control APIs
- `POST /v1/orgs`
- `GET /v1/orgs/:orgId`
- `PUT /v1/orgs/:orgId/plan`
- `DELETE /v1/orgs/:orgId` (soft delete)
- `POST /v1/orgs/:orgId/projects`
- `GET /v1/orgs/:orgId/projects`
- `GET /v1/projects/:projectId`
- `DELETE /v1/projects/:projectId` (soft delete)
- `POST /v1/projects/:projectId/restore`
- `POST /v1/projects/:projectId/apikeys`
- `GET /v1/projects/:projectId/apikeys`
- `DELETE /v1/projects/:projectId/apikeys/:keyId`
- `GET /v1/projects/:projectId/public-config`
- `GET /v1/orgs/:orgId/projects/:projectId/usage?from=&to=`
- `GET /v1/orgs/:orgId/overview?from=&to=`

## Soft delete behavior
Project soft-delete sets `status=deleted` and enforces read-only behavior for data-plane writes. Restore reactivates project without data loss.

## IAM scopes
Added:
- `org.admin`
- `project.admin`
- `project.read`
- `apikey.admin`
- `control.read`

## Metrics
`/metrics` includes:
- `control_orgs_total`
- `control_projects_total`
- `control_apikeys_total`
- `control_soft_deletes_total`
- `control_plan_changes_total`

## Governance hooks
All lifecycle mutations append audit entries to `data/control/audit.ndjson`.
