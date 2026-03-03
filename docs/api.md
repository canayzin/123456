# API Standardı

- Versiyon: `v1`
- OpenAPI: `docs/openapi/*.yaml`
- Swagger UI: `GET /docs`
- Health: `GET /health`
- Metrics: `GET /metrics`

## Standard Error Format
```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable",
    "details": {}
  }
}
```

## Auth
- `POST /v1/auth/signup`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `POST /v1/auth/forgot-password`
- `POST /v1/auth/verify-email`
- `GET /v1/auth/me`

## DocDB
- `GET/POST /v1/projects/:pid/db/collections/:col/docs`
- `GET/PUT/PATCH/DELETE /v1/projects/:pid/db/collections/:col/docs/:id`
- `POST /v1/projects/:pid/db/query`
- `WS /v1/projects/:pid/db/subscribe`
