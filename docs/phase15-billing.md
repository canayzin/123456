# Phase 15 — Billing Engine & Plan Tiers

## Plan model

- Plan catalog is file-backed at `data/billing/plans.json`.
- Built-in plans: `free`, `pro`, `enterprise`.
- Project billing state at `data/billing/projects/{projectId}.json`.

## Usage ingestion and schema

- Source stream: `data/usage/{projectId}.ndjson` (quota usage events).
- Billing aggregator incrementally reads from checkpoint offset.

## Aggregation + checkpointing

- Checkpoints: `data/billing/checkpoints/{projectId}.json`.
- Fields: `lastByteOffset`, `lastEventTs`.
- Re-runs are deterministic and avoid double count by resuming from offset.

## Pricing math (cents)

- All money calculations are integer cents.
- Invoice output also includes decimal display (`total`) derived from cents.
- `free` => 0 invoice, caps enforced.
- `pro` => base + overage.
- `enterprise` => base only (metering preserved).

## Budgets and alerts

- Monthly budget limit + threshold alerts (0.5/0.8/1.0).
- Alert triggers are persisted in project state (`lastAlerted`).
- Alert + plan/invoice/aggregation events appended to billing audit log.

## Quota enforcement integration

- Quota engine accepts policy-provider injection.
- Billing policy provider applies plan-aware decisions:
  - free: monthly hard cap deny (`RESOURCE_EXHAUSTED`)
  - pro: allow overage
  - enterprise: allow

## API endpoints

- `GET /v1/orgs/:orgId/projects/:projectId/billing`
- `PUT /v1/orgs/:orgId/projects/:projectId/billing`
- `GET /v1/orgs/:orgId/projects/:projectId/invoice?month=YYYY-MM`
- `GET /v1/orgs/:orgId/projects/:projectId/usage/summary?from=&to=`
- `GET /v1/orgs/:orgId/projects/:projectId/billing/alerts?month=`

## Parity gaps vs Firebase billing

- No payment processor integration.
- No tax/VAT engine.
- No PDF invoice rendering.
- No external ledger/export integration yet.
