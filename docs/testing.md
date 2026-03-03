# Test Stratejisi

## Zorunlu Suite'ler
- Unit: rules engine
- Unit: docdb query parser
- Integration: websocket subscribe akışı (todo)
- Integration: auth refresh flow (todo)

## Coverage
- Hedef: minimum %80
- CI komutu: `npm run test:coverage`

## Performans
- k6 script: `infra/loadtest/docdb.js`
- Hedef: p95 read latency < 150ms
