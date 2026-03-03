# NovaCloud Enterprise Architecture (Local Single-Process Simulation)

## Component Diagram (text)

```text
[server/http] -> [core/kernel] -> [tenant/model]
                             -> [services/auth]
                             -> [core/eventBus]
                             -> [core/metrics]

Future phases:
  -> [services/docdb] -> [services/rules]
  -> [realtime/ws]
  -> [services/storage]
  -> [services/functions]
  -> [crdt]
  -> [services/quota]
  -> [services/analytics]
```

## Data Flow
1. Request enters `server` and gets request-id + latency tracking from `kernel`.
2. Tenant context resolves (`organization/project/environment`).
3. Auth service executes signup/login/refresh/custom token paths and emits audit events.
4. Kernel publishes events to EventBus and updates Metrics.
5. Response returns with standard error envelope or success payload.

## Threat Model Summary
- Password theft risk -> scrypt hashing + timing-safe compare.
- Token tampering -> JWS signature verification (HS256, RS256-ready path).
- Refresh replay -> rotation + reuse detection + session revoke.
- Brute force/login abuse -> IP+account rate limits + account lockout.
- Tenant breakout -> tenant-scoped session and user namespace fields.

## Failure Model
- File corruption risk -> defensive JSON load fallback, append-only audit log.
- Process crash -> in-memory rate/session resets; persisted user/key/refresh store survives.
- Key rotation mismatch -> `kid`-based verification over active+grace keys.

## Scaling Roadmap (distributed future)
- Replace file stores with pluggable DB adapters.
- Move session/rate-limits to distributed cache.
- Use centralized event bus and log pipeline.
- Introduce stateless auth edge + shared keystore service.
