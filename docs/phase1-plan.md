# Faz 1 Ayrıntılı Plan

## Checklist
- [x] Repo iskeleti (`services`, `sdk`, `console`, `docs`, `examples`, `infra`)
- [x] Auth servis (signup/login/refresh/logout/me)
- [x] DocDB CRUD + structured query
- [x] Realtime subscribe (WebSocket)
- [x] Rules engine + rules test runner
- [x] JS SDK (auth + docdb)
- [x] Todo demo uygulaması
- [x] Docker compose local ortam
- [x] Minimal CI (lint/test/build)

## Ne değişti?
- `services/auth/src/server.js`: email verify & forgot-password token akışları, admin audit log genişletmesi.
- `services/docdb/src/server.js`: `/db/subscribe` protokolü, idempotency key cache, query parser entegrasyonu.
- `services/docdb/src/query.js`: structured query doğrulama/normalizasyon.
- `sdk/js/src/index.js`: auth ve data base URL ayrımı, typed error yapısı.
- `examples/todo-web/public/index.html`: auth+docdb entegrasyonlu çalışır demo.

## Çalıştırma Komutları
```bash
npm install
npm test
npm run lint
cd infra && docker compose up --build
```
