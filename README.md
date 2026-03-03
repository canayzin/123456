# NovaBase (Firebase-benzeri BaaS)

NovaBase, multi-tenant ve production-grade hedefli bir BaaS platformudur.

## Özellik Eşleştirme
| Firebase | NovaBase | Durum |
|---|---|---|
| Firebase Auth | NovaBase Auth | Faz 1 ✅ |
| Firestore | NovaBase DocDB | Faz 1 ✅ |
| Realtime DB | NovaBase RTDB | Faz 2 plan |
| Storage | NovaBase Storage | Faz 2 plan |
| Functions | NovaBase Functions | Faz 3 plan |
| Security Rules | NovaBase Rules | Faz 1 ✅ |
| Console | NovaBase Console | Faz 1 ✅ |
| SDK | NovaBase JS SDK | Faz 1 ✅ |

## Mimari Seçimi
Seçenek A seçildi: Node.js + WebSocket + SQLite (MVP) ve ileri fazda Postgres/Redis/NATS geçişi.

## Faz 1 Çıktıları
- Auth + refresh rotation + verify/reset flow
- DocDB CRUD + structured query + realtime subscribe
- Security rules engine + test runner
- JS SDK (fluent API ve retry/backoff)
- Admin console (org/project/env temel modeli)
- OpenAPI 3.1 dokümanları + Swagger UI mount (`/docs`)
- Structured JSON log, request-id propagation, `/metrics`, `/health`

## Hızlı Başlangıç
```bash
npm install
npm test
npm run test:coverage
cd infra && docker compose up --build
```


## Restricted Network / Corporate Registry
If `npm install` fails with `E403`, follow `docs/registry-access.md` and configure an internal npm proxy using `.npmrc.enterprise.example`.

## Faz Disiplini
Faz 1 raporu: `docs/phase1-report.md` (dosya ağacı, komutlar, test özeti, bilinen eksikler ve net durum bilgisi içerir).


## CI Internal Registry Setup
For restricted corporate networks, configure GitHub Actions with:
- repository variable: `NPM_REGISTRY_URL`
- repository secret: `NPM_TOKEN`

The CI workflow will auto-generate `.npmrc`, then run `npm ping` / `npm view` checks before install.
