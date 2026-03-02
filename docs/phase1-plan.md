# Faz 1 Ayrıntılı Plan

## Checklist
- [x] Repo iskeleti (`services`, `sdk`, `console`, `docs`, `examples`, `infra`)
- [x] Auth servis (signup/login/refresh/logout/me)
- [x] DocDB CRUD + query
- [x] Realtime subscribe (WebSocket)
- [x] Rules engine + rules test runner
- [x] JS SDK (auth + docdb)
- [x] Todo demo uygulaması
- [x] Docker compose local ortam
- [x] Minimal CI (lint/test/build)

## Dosya Listesi
- `services/auth/src/server.js`
- `services/docdb/src/server.js`
- `services/rules/src/index.js`
- `sdk/js/src/index.js`
- `examples/todo-web/public/index.html`
- `infra/docker-compose.yml`

## Çalıştırma Komutları
```bash
npm install
npm test
npm run lint
cd infra && docker compose up --build
```
