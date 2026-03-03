# NovaBase (Firebase-benzeri BaaS)

NovaBase, Firebase'den ilham alan ancak marka/UI olarak özgün bir multi-tenant Backend-as-a-Service platformudur.

## Firebase-benzeri Özellik Eşleştirme Tablosu

| Firebase | NovaBase Modülü | Faz Durumu | Tamamlanma |
|---|---|---|---|
| Firebase Auth | NovaBase Auth | Faz 1 MVP | %82 |
| Firestore | NovaBase DocDB | Faz 1 MVP | %78 |
| Realtime DB | NovaBase RTDB | Faz 2 | %15 |
| Cloud Storage | NovaBase Storage | Faz 2 | %10 |
| Cloud Functions | NovaBase Functions | Faz 3 | %10 |
| Security Rules | NovaBase Rules Engine | Faz 1 MVP | %72 |
| Firebase Console | NovaBase Console | Faz 1 MVP | %45 |
| Firebase SDK | NovaBase JS SDK | Faz 1 MVP | %65 |

## Mimari Seçimi

**Seçenek A** seçildi: Node.js servisleri + WebSocket realtime + SQLite (MVP) + Docker Compose.

Gerekçeler:
- Faz 1 teslimi için hızlı geliştirme döngüsü.
- Multi-tenant için `project_id` partitioning ile sade veri izolasyonu.
- DocDB realtime için düşük sürtünmeli WS modeli.
- Faz 2/Faz 3’te PostgreSQL, Redis/NATS ve object storage eklemeye uygun evrim yolu.

Detaylar: `docs/architecture.md`

## Faz 1 Tamamlananlar
- Admin Console: proje oluşturma + API key üretimi.
- Auth: signup/login/me/refresh/logout + email verify/forgot-password akışı (MVP token modeli).
- DocDB: CRUD + structured query + WS subscribe + idempotency key desteği.
- Rules Engine: auth context + owner check + field validation + test runner.
- JS SDK: auth ve docdb istemcisi.
- Demo: Todo web uygulaması.

## Repo Yapısı
- `services/auth`
- `services/docdb`
- `services/rules`
- `services/rtdb` (Faz 2 planı)
- `services/storage` (Faz 2 planı)
- `services/functions` (Faz 3 planı)
- `console`
- `sdk/js`
- `infra`
- `docs`
- `examples`

## Quickstart

```bash
npm install
cd infra && docker compose up --build
```

- Console: http://localhost:4000
- Auth: http://localhost:4001
- DocDB: http://localhost:4002
- Demo: http://localhost:5173

Detaylı adımlar: `docs/quickstart.md`
