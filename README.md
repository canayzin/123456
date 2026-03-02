# NovaBase (Firebase-benzeri BaaS)

NovaBase, Firebase'den **ilham alan ama marka/UI olarak özgün** bir multi-tenant BaaS platformudur.

## Firebase-benzeri Özellik Eşleştirme Tablosu

| Firebase | NovaBase Modülü | Faz Durumu | Tamamlanma |
|---|---|---|---|
| Firebase Auth | NovaBase Auth | Faz 1 MVP | %75 |
| Firestore | NovaBase DocDB | Faz 1 MVP | %70 |
| Realtime DB | NovaBase RTDB | Faz 2 | %10 |
| Cloud Storage | NovaBase Storage | Faz 2 | %5 |
| Cloud Functions | NovaBase Functions | Faz 3 | %5 |
| Security Rules | NovaBase Rules Engine | Faz 1 MVP | %65 |
| Firebase Console | NovaBase Console | Faz 1 MVP | %40 |
| Firebase SDK | NovaBase JS SDK | Faz 1 MVP | %55 |

## Mimari Seçim

**Seçenek A (Hızlı MVP + Ölçeklenebilir)** seçildi.

Gerekçe:
- Faz 1 hızına uygun (Node.js servisleri + hızlı iterasyon).
- Postgres yerine MVP'de SQLite ile düşük operasyon maliyeti; sonra Postgres JSONB geçiş planlı.
- WebSocket ile realtime subscribe kolay.
- Docker Compose ile tek komut local demo.

Detaylar: `docs/architecture.md`

## Faz 1 İçeriği
- Basic Admin Console: project create + API key.
- Auth: email/password, JWT access + refresh.
- DocDB: CRUD + query + realtime subscribe.
- Security Rules: allow/deny + field validation + test runner.
- JS SDK: auth + docdb + snapshot listener.
- Demo: Todo web app.

## Hızlı Başlangıç

```bash
npm install
cd infra && docker compose up --build
```

- Console: http://localhost:4000
- Auth API: http://localhost:4001
- DocDB API: http://localhost:4002
- Todo Demo: http://localhost:5173

Ayrıntı için `docs/quickstart.md` dosyasına bakın.

## Roadmap
- Faz 2: RTDB + Storage + console explorer
- Faz 3: Functions + emulator
- Faz 4: Push + analytics/crash + quota metering
