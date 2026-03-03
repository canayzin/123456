# Phase 23 — Console Backend

Bu fazda Console Backend sorgu katmanı `/v1/console/*` altında tamamlandı.

## Kapsam

- Overview
  - `GET /v1/console/orgs/:orgId/overview`
  - `GET /v1/console/projects/:projectId/overview`
- Charts
  - `GET /v1/console/projects/:projectId/charts/analytics/events`
  - `GET /v1/console/projects/:projectId/charts/messaging`
  - `GET /v1/console/projects/:projectId/charts/storage`
  - `GET /v1/console/projects/:projectId/charts/billing`
- Lists
  - `GET /v1/console/orgs/:orgId/projects`
  - `GET /v1/console/projects/:projectId/apikeys`
  - `GET /v1/console/projects/:projectId/hosting/releases`
  - `GET /v1/console/projects/:projectId/remoteconfig/versions`
  - `GET /v1/console/projects/:projectId/messaging/receipts`
  - `GET /v1/console/projects/:projectId/messaging/dlq`
  - `GET /v1/console/projects/:projectId/appcheck/denies`
- Unified logs
  - `GET /v1/console/projects/:projectId/logs?type=...&from=&to=&limit=&cursor=`
- Exports
  - `GET /v1/console/projects/:projectId/exports/usage?from=&to=&format=`
  - `GET /v1/console/projects/:projectId/exports/analytics?date=&format=`
  - `GET /v1/console/projects/:projectId/exports/invoices?month=&format=`

## Güvenlik ve IAM

- `console.read`: overview/charts/lists erişimi
- `logs.read`: logs + messaging receipts/dlq + appcheck denies
- `exports.read`: exports erişimi
- Proje üyesi olmayan kullanıcılar IAM tarafından reddedilir.

## Pagination standardı

Tüm liste/log cevaplarında aşağıdaki sözleşme uygulanır:

```json
{
  "items": [],
  "nextCursor": "opaque"
}
```

- Deterministik sıralama uygulanır.
- `limit` üst sınırı: `200`.

## Sanitization

- Log ve export çıktılarında token/secret/email alanları redakte edilir.
- API key listelerinde full key/secret döndürülmez.

## Doğrulama

- `tests/phase23_console_backend.test.js` endpoint kapsamı + IAM + redaction + pagination doğrular.
- `tests/bench_phase23_console.js` temel latency ölçümü üretir.
