# Mimari Kararı ve Gerekçeler

## Seçim: Seçenek A (Hızlı MVP + Ölçeklenebilir)
Node.js tabanlı servisler + WebSocket realtime + SQLite (MVP), faz ilerledikçe Postgres/Redis/NATS.

## Bileşen Diyagramı

```text
[Admin Console] ---> [Console API]
[JS SDK] ---> [Auth Service]
[JS SDK] ---> [DocDB Service] ---> [Rules Engine]
[DocDB Service] ---> [SQLite Doc Store]
[Auth Service] ---> [SQLite Auth Store + Audit Logs]
```

## Veri Akışı
1. Kullanıcı signup/login ile access + refresh token alır.
2. SDK DocDB yazma isteği gönderir (`project_id` ile izole).
3. Rules Engine auth/request/data context ile allow/deny verir.
4. Yazma başarılıysa DocDB WebSocket abonelerine event fan-out yapar.

## Consistency Model
- Auth: tek-writer DB üzerinde güçlü tutarlılık.
- DocDB: tek düğümde güçlü tutarlılık; gelecekte çoklu node senaryosunda eventual+resume token yaklaşımı.

## Threat Model (MVP)
- Brute-force login -> rate limit + audit log.
- Auth bypass -> JWT doğrulama ve rule auth kontrolleri.
- Tenant isolation bug -> her endpointte `project_id` zorunluluğu.
- Replay/duplicate write -> idempotency-key desteği.
- Kötü niyetli query -> structured query parser doğrulaması.

## Maliyet / Karmaşıklık
- Düşük maliyet: tek Compose stack ile local çalışır.
- Orta karmaşıklık: servis ayrımı korunur.
- Ölçekleme yolu: SQLite -> Postgres JSONB, WS fan-out -> Redis/NATS, object storage -> MinIO/S3.

## Gözlemlenebilirlik Yol Haritası
- Faz 1: servis health endpoint + app log.
- Faz 2: OTel traces + Prometheus metrics.
- Faz 3: Grafana/Loki dashboard + alerting.
