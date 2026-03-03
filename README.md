# ENTERPRISE ZERO-DEPENDENCY PROTOCOL

- Ortam: ChatGPT Workspace
- Kısıtlar: npm install yok, external network yok, Docker yok, external DB yok
- Sadece Node.js built-in modüller
- Standart: threat model, test planı, log/metrics, deterministik hata kodları

# NovaCloud

Single-process local simulation, distributed-ready abstraction hedefiyle geliştirilir.

## Faz Sırası
1. Faz 1 – Kernel + Tenant + Auth + JWT
2. Faz 2 – DocDB + Index + WAL
3. Faz 3 – Realtime + WS
4. Faz 4 – Rules Engine
5. Faz 5 – Storage + Functions
6. Faz 6 – CRDT
7. Faz 7 – Quota + Analytics
8. Faz 8 – Hardening + Load Simulation

## Bu Teslimatta
- `core/kernel.js`, `core/metrics.js`, `core/eventBus.js`
- `tenant/model.js`
- `services/auth.js` + `services/auth/{jwt,keys,refreshStore}.js`
- `services/auth/index.js`
- `server/index.js`
- `tests/phase1.test.js`

## Nasıl Çalıştırılır
```bash
npm test
node server/index.js
```

## Bilinen Limitler
- Tek process; in-memory rate buckets.
- Multi-node dağıtık state henüz yok.
- Realtime WS, DocDB index/WAL, CRDT ileriki fazlarda.

## Faz 1 tamamlandı
Kernel + Tenant + Auth + JWT enterprise-protocol kriterleriyle tamamlandı.


## Faz 2 tamamlandı
Firestore-Class engine (composite index, planner, transaction, WAL, transforms, cursors, rules integration) tamamlandı.
