# Phase 19 — App Check

## Provider model
- `debug` provider: allowlisted debug token exchange
- `custom` provider: app-specific shared secret exchange
- integrity providers are stubbed as abstraction point

## Token format
HMAC-signed JWT-like token with claims:
- `iss`, `sub`, `projectId`, `platform`, `iat`, `exp`, `jti`, `tokenType`, `provider`

## Headers
- `X-AppId: <appId>`
- `X-AppCheck: <token>`
- alternative: `Authorization: AppCheck <token>`

## Enforcement map
App Check is enforced only when `X-AppId` is present **and** the app is registered in the project; otherwise verification is skipped for backward compatibility.

Per-app per-service mode:
- `off`
- `monitor`
- `enforce`

Service keys:
- `remoteconfig.fetch`
- `messaging.send`
- `messaging.tokens`
- `storage.sign`
- `functions.invoke`

## Replay protection
- JTI tracked in rolling in-memory window
- append-only JTI log persisted in `data/appcheck/jti`
- periodic prune prevents unbounded growth

## Emulator debug flow
1. register app with provider `debug`
2. add debug token allowlist entry
3. exchange debug token via `/appcheck/exchangeDebug`
4. send returned App Check token in `X-AppCheck`

## Parity gaps vs Firebase App Check
- no real Apple/Google attestation backends
- no device SDK attestation libraries
- custom/debug providers only in this MVP
