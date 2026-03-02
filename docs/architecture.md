# Mimari Kararı ve Gerekçeler

## Seçim: Seçenek A
Node.js tabanlı API servisleri + WebSocket realtime + SQLite (MVP) + Docker Compose.

## Bileşen Diyagramı

```text
[Admin Console] ---HTTP---> [Console API]
[Web/Mobile SDK] ---HTTP/JWT---> [Auth Service]
[Web/Mobile SDK] ---HTTP/WS---> [DocDB Service]
[DocDB Service] ---> [Rules Engine]
[Auth Service] ---> [Audit Log Table]
```

## Veri Akışı
1. Signup/Login -> Auth Service -> JWT access ve refresh token döner.
2. SDK doc create/update -> DocDB Service -> Rules Engine allow/deny.
3. Allow ise doküman yazılır, ilgili WebSocket abonelerine event yayınlanır.
4. Admin Console proje + API key üretir.

## Threat Model (MVP)
- Kimlik doğrulama bypass riski -> JWT doğrulama katılaştırma (Faz 1.1).
- Brute force -> rate limit endpoint bazında.
- Yetki yükseltme -> ownerField ve auth-required rule denetimleri.
- Token çalınması -> kısa access TTL + refresh rotation.
- Veri sızıntısı -> project_id partitioning, endpointlerde proje zorunluluğu.

## Maliyet / Karmaşıklık
- Düşük maliyet: tek container stack ile local ve küçük prod PoC çalışır.
- Orta karmaşıklık: servis ayrımı var, fakat tek dil/ekosistem.
- Gelecek ölçekleme: SQLite -> Postgres JSONB, pub/sub için Redis/NATS eklenebilir.
