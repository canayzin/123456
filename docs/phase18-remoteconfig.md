# Phase 18 — Remote Config

## Template schema
- `parameters[key].defaultValue.value` string
- `parameters[key].conditionalValues[conditionName].value` string
- `conditions[]` with `{ name, expression }`
- `minimumFetchIntervalSeconds`

## DSL grammar
- operators: `== != < <= > >= && || !`
- identifiers: `platform`, `appId`, `country`, `uid`, `attr.<key>`
- function: `percent(uid, 'salt')`
- no `eval`, no regex, no arbitrary calls

## Evaluation order
- start from default value
- evaluate conditions in template order
- last matching conditional override wins

## Fetch semantics
- `OK`: returns evaluated params
- `NOT_MODIFIED`: etag match
- `THROTTLED`: min interval not elapsed

## Versioning + rollback
- active template stored in templates file
- append-only versions NDJSON log
- rollback publishes historical content as a new version

## IAM scopes
- `remoteconfig.read`
- `remoteconfig.publish`
- `remoteconfig.admin`

## Plan limits
- free: max 50 params, max 10 conditions
- pro/enterprise: higher limits

## Parity gaps vs Firebase Remote Config
- no client SDK-side cache management in this repo
- no A/B experiment UI integration
- primary-region source only (MVP)
