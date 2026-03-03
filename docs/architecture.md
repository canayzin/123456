# Mimari

## Seçim
Seçenek A (Node.js servisleri, WS realtime, SQLite MVP).

## Veri Akışı
1. Auth token üretir (JWT access + refresh).
2. DocDB her istekte `project_id` izolasyonu uygular.
3. Rules engine allow/deny verir.
4. WS subscribers event alır.

## Threat Model
- Brute force -> rate limiting
- Auth bypass -> JWT doğrulama
- Tenant breakout -> project scope
- Replay -> idempotency keys

## Performans ve Maliyet Hedefi
- Tek 8GB node hedefi: 1000 WS / 500 RPS
- Read p95 < 150ms, broadcast < 200ms

## Ölçekleme Planı
- Horizontal app replicas
- Redis/NATS ile fanout
- SQLite -> Postgres JSONB
