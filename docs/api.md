# API Tasarımı (v1)

## Auth API

### `POST /v1/auth/signup`
- Auth: yok
- Rate limit: 100 req/min (global auth limiti)

Request:
```json
{ "email": "demo@example.com", "password": "password123" }
```
Response:
```json
{
  "user": { "id": "u1", "email": "demo@example.com", "emailVerified": false },
  "accessToken": "...",
  "refreshToken": "...",
  "verificationToken": "..."
}
```

### `POST /v1/auth/login`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `POST /v1/auth/forgot-password`, `POST /v1/auth/verify-email`, `GET /v1/auth/me`
- JWT gerekli: yalnızca `/me`
- Refresh rotasyonu: aktif

## Document DB API (Firestore-like)

### `GET/POST /v1/projects/:pid/db/collections/:col/docs`
### `GET/PUT/PATCH/DELETE /v1/projects/:pid/db/collections/:col/docs/:id`
### `POST /v1/projects/:pid/db/query`
### `WS /v1/projects/:pid/db/subscribe`

Query request örneği:
```json
{
  "collection": "todos",
  "where": [{ "field": "ownerId", "op": "==", "value": "u1" }],
  "orderBy": "updated_at",
  "direction": "desc",
  "limit": 20,
  "offset": 0
}
```

Subscribe protokolü:
1) Client WS bağlanır.
2) `{"collection":"todos"}` mesajı yollar.
3) Server `subscribed` event döner ve değişimleri push eder.

## RTDB API (Phase 2 planı)
- `GET/PUT/PATCH/DELETE /v1/projects/:pid/rtdb/*path`
- `WS /v1/projects/:pid/rtdb/subscribe`

## Storage API (Phase 2 planı)
- `POST /v1/projects/:pid/storage/upload-url`
- `GET /v1/projects/:pid/storage/download-url`
- `DELETE /v1/projects/:pid/storage/objects/:key`

## Functions API (Phase 3 planı)
- `POST /v1/projects/:pid/functions/call/:name`
- `POST /v1/projects/:pid/functions/deploy`

## Error Codes
- `400 invalid_payload`
- `401 unauthorized`
- `403 forbidden`
- `404 not_found`
- `409 email_exists`
