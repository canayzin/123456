# API Tasarımı (v1)

## Auth API
- `POST /v1/auth/signup`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `POST /v1/auth/forgot-password` (stub)
- `POST /v1/auth/verify-email` (stub)
- `GET /v1/auth/me`

### Örnek Signup Request
```json
{ "email": "demo@example.com", "password": "password123" }
```

### Örnek Signup Response
```json
{
  "user": { "id": "u1", "email": "demo@example.com" },
  "accessToken": "...",
  "refreshToken": "..."
}
```

## Document DB API
- `GET/POST /v1/projects/:pid/db/collections/:col/docs`
- `GET/PATCH/DELETE /v1/projects/:pid/db/collections/:col/docs/:id`
- `POST /v1/projects/:pid/db/query`
- `GET ws://.../v1/projects/:pid/db/subscribe/:col`

## Realtime DB API
Faz 2'de eklenecek.

## Storage API
Faz 2'de eklenecek.

## Functions API
Faz 3'te eklenecek.

## Hata Kodları
- `400 invalid_payload`
- `401 unauthorized/invalid_credentials`
- `403 forbidden`
- `404 not_found`
- `409 email_exists`

## Rate Limit
- Auth servis: dakikada 100 istek (global MVP limiti).
