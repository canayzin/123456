# Phase 4 Security Rules DSL

Faz 4 (Security Rules DSL Engine) tamamlandı.

## DSL Grammar (subset)
- `rules_version = '1';`
- `match /path/{param} { ... }`
- `allow read|write|create|update|delete [: if <expr>];`
- Operators: `== != < <= > >= && || ! in array-contains`

## AST Model
- Program
- Match nodes (nested)
- Allow nodes (actions + condition expression)
- Expression nodes: Literal, Identifier, Unary, Binary

## Evaluation Model
- Deterministic recursive-descent parser and deterministic evaluator.
- No `eval`, no `Function` constructor.
- Evaluator scope includes:
  - `request.auth.uid`, `request.auth.role`, `request.ip`, `request.time`
  - `resource.data`, `resource.oldData`, `resource.path`
  - extracted path params

## Query Filtering Strategy
- `filterQueryResults(ctx, path, docs, {limit, overfetchFactor})`
- Deterministic overfetch defaults to `limit * 3`.
- Returns `{ docs, ruleFilteredCount, scannedCount, overfetchFactor }`.
- `ruleFilteredCount` can be used by explain/report paths.

## Realtime Enforcement
- Realtime subscription layer now calls `rulesEngine.canRead(...)` before sending events.
- Unauthorized docs are skipped deterministically.

## Firebase Parity Gaps
- No full Firebase function surface (`get`, `exists`, helper functions).
- No custom function declarations in DSL yet.
- No compile-time type checker.

## Limits
- DSL intentionally minimal and deterministic.
- Path matching resolves most-specific matching rule.
- Engine is gate-layer only; DocDB and Realtime APIs were kept stable.
