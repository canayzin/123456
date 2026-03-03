# Faz 1 Enterprise Raporu

## Dosya Ağacı (bu faz)
- `/core/kernel.js`
- `/core/metrics.js`
- `/core/eventBus.js`
- `/tenant/model.js`
- `/services/auth.js`
- `/services/auth/jwt.js`
- `/services/auth/keys.js`
- `/services/auth/refreshStore.js`
- `/services/auth/index.js`
- `/server/index.js`
- `/tests/phase1.test.js`

## Test Listesi
- `tests/phase1.test.js`: tenant + identity akışı
- `tests/auth.test.js`: signup/login/refresh
- `tests/jwt.test.js`: jwt claims, key rotation, refresh reuse detection

## Limitler
- Local file-store + in-memory bucket/session model.
- Distributed lock/state yok.

## Known Technical Debt
- OAuth ve MFA sadece architecture stub.
- RS256 production key provisioning (KMS) henüz yok.
- Project quota enforcement ayrı fazda tamamlanacak.

**Faz 1 tamamlandı.**
