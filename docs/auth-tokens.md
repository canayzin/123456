# Auth Tokens (JWT/JWS Core)

## ENTERPRISE PROTOCOL (prepend)
- Ortam: Workspace, external deps yok, built-in Node only.
- Enterprise kriterleri: threat model, test planı, metrics/log, deterministik davranış, hata standardı.
- Disiplin: design -> implementation -> tests -> demo.

## RFC-aligned behavior (HS256)
- Header: `{ alg: "HS256", typ: "JWT", kid }`
- Claims: `iss`, `sub`, `aud`, `iat`, `nbf`, `exp`, `jti`, `typ`
- Base64url encoding/decoding implemented in `services/auth/jwt.js`.
- Clock skew tolerance: ±60s.

## Key rotation
- Key storage: `secrets/keys.json`
- Active key used for signing.
- Previous keys remain verifiable during grace period.
- `kid` is mandatory for verification lookup.

## Refresh token security
- Refresh tokens are stored hashed (scrypt) in `data/refreshTokens.json`.
- Rotation: each refresh spends old token and issues a new token.
- Reuse detection: spent token re-use revokes whole session family.

## Audit log
- Append-only auth event log: `data/audit.log`

## Threat model notes
- Tampered token -> signature mismatch -> reject.
- Expired/nbf-violating token -> reject with deterministic code.
- Refresh token theft + replay -> reuse detection and session revoke.

## Phase status
**Faz 2 (JWT + Refresh security) tamamlandı.**
