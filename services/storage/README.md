# NovaBase Storage Service (Phase 2)

Planned APIs:
- `POST /v1/projects/:pid/storage/upload-url`
- `GET /v1/projects/:pid/storage/download-url`
- `DELETE /v1/projects/:pid/storage/objects/:key`

Target implementation: MinIO/S3-compatible object storage + metadata DB.
