# Phase 25 — Production Hardening

## What was added

- Optional multi-process runtime: `server/cluster.js`
- Graceful shutdown helper: `server/shutdown.js`
- Health/readiness endpoints: `/healthz`, `/readyz`
- Structured JSON logger: `observability/logger.js`
- Minimal tracing ring buffer: `observability/trace.js`
- Config loader (env + optional file merge): `config/index.js`
- Adapter interfaces/stubs: `platform/adapters/store.js`

## Runtime modes

### Single process (default)

```bash
node server/index.js
```

### Cluster mode

```bash
CLUSTER=1 CLUSTER_WORKERS=4 PORT=8080 node server/cluster.js
```

- Worker exits are restarted (rate-limited).
- `SIGHUP` performs best-effort rolling restart.
- `SIGTERM` propagates shutdown to workers.

## Health probes

- `GET /healthz` -> `200 {"status":"ok"}`
- `GET /readyz` ->
  - `200 {"status":"ok"}` when ready
  - `503 {"status":"not_ready","reasons":[...]}` otherwise

Kubernetes probes example:

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
readinessProbe:
  httpGet: { path: /readyz, port: 8080 }
```

## Security hardening

API responses include:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy: default-src 'none'`

Also added:

- standardized request body limit (`BODY_LIMIT_BYTES`)
- sensitive endpoint rate limiting (auth + appcheck exchange)
- optional CORS allowlist via `CORS_ALLOWLIST`

## Config

`config/index.js` merges:

1. defaults
2. environment variables
3. optional JSON file from `NOVACLOUD_CONFIG`

## Reverse proxy + TLS guidance

### Nginx (TLS terminated at proxy)

```nginx
server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate /etc/letsencrypt/live/api/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    client_max_body_size 2m;
  }
}
```

### Caddy

```caddy
api.example.com {
  reverse_proxy 127.0.0.1:8080 {
    header_up X-Forwarded-Proto {scheme}
    header_up X-Forwarded-For {remote}
  }
  encode zstd gzip
}
```

Notes:

- TLS terminates at proxy.
- WebSocket upgrade headers are required for realtime/messaging connections.
- Wire `/healthz` and `/readyz` in orchestrator probes.
- Ship JSON logs from stdout to your log pipeline.

## CI hardening

Recommended CI checks:

- `npm test`
- `node --test` targeted smoke
- `curl /healthz` + `curl /readyz` smoke after boot
- `console-ui` build/typecheck only when dependencies are available (offline guidance from phase24 docs)
