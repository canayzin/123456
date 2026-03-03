# Phase 6 Storage Engine

Faz 6 (Storage Engine) tamamlandı.

## Data model
- Logical namespace: `projects/{projectId}/buckets/{bucket}/objects/{key}`
- Physical object files: `storage/{projectId}/{bucket}/{key}` (safe join + traversal checks)
- Metadata store: `data/storage/{projectId}/{bucket}.json`
- Metadata fields: `key,size,contentType,md5,createdAt,updatedAt,ownerUid,customMetadata,etag`

## Signed URL security
- Endpoint signs URLs for `/v1/storage/object`
- Canonical string binds: `projectId,bucket,key,exp,method,contentType,contentLength`
- Signature: `base64url(HMAC_SHA256(project-secret, canonical))`
- Verification enforces expiry, method, signature, and optional type/length bindings.

## Rules integration
- Storage-specific rules adapter evaluates read/write gate conditions.
- Rules are checked at sign time and access time.
- Denials increment `storage_rules_denied_total` and are audit-logged.

## Triggers
- Successful upload emits storage finalize event via `functionsService.triggerStorageFinalize`.
- Function trigger type: `storage.finalize`.

## Metrics and audit
- Metrics:
  - `storage_put_total`
  - `storage_get_total`
  - `storage_delete_total`
  - `storage_bytes_written_total`
  - `storage_bytes_read_total`
  - `storage_signed_url_issued_total`
  - `storage_rules_denied_total`
- Audit log records signed URL issuance and object operations.

## Known parity gaps vs Firebase
- No resumable uploads/chunk session protocol.
- No CDN integration.
- No multi-region replication.
- No managed IAM; local rules simulation only.
