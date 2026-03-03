# Phase 24 — Hosted Console Frontend

## Local run

```bash
cd console-ui
npm install
VITE_API_BASE_URL=http://127.0.0.1:8080 npm run dev
```

Build:

```bash
cd console-ui
npm run build
```

## Env vars

- `VITE_API_BASE_URL` (default: `http://127.0.0.1:8080`)

## Auth flow

- Login via `POST /auth/login`.
- `accessToken` + `refreshToken` only in memory (React state).
- API wrapper uses bearer token.
- On `401`, refresh once (`POST /auth/refresh`) then retry request once.
- Refresh failure => auth cleared and user returns to `/login`.

## Routes

- `/login`
- `/orgs`
- `/orgs/:orgId`
- `/projects/:projectId`
- `/orgs/:orgId/projects`
- `/projects/:projectId/apikeys`
- `/projects/:projectId/hosting`
- `/projects/:projectId/remoteconfig`
- `/projects/:projectId/messaging/receipts`
- `/projects/:projectId/messaging/dlq`
- `/projects/:projectId/appcheck/denies`
- `/projects/:projectId/logs`
- `/projects/:projectId/exports`
- `/settings`

## Endpoint mapping

Frontend uses only NovaCloud backend:

- Org overview + org projects
- Project overview
- Charts: analytics/messaging/storage/billing
- Lists: apikeys, hosting releases, remoteconfig versions, messaging receipts/dlq, appcheck denies
- Logs with `type/from/to/limit/cursor`
- Exports: usage/analytics/invoices download

## Pagination semantics

All list/log pages enforce:

- `limit` select: 50/100/200
- `cursor` forwarding for next page
- UI expects `{ items, nextCursor }` payload

## Security notes

- No token persistence in `localStorage`.
- UI applies additional masking for emails/tokens in log rendering.
- API key secrets are never shown in tables.
- Export/log backend sanitization is relied on; UI preserves masking behavior.

## Manual QA checklist

- [ ] login works (valid user)
- [ ] org overview loads
- [ ] project overview loads
- [ ] charts render (4 panels)
- [ ] logs page paginates with cursor/limit
- [ ] exports download works (usage/analytics/invoices)
- [ ] non-member deny shows UI error banner with code/requestId

## Dependency blocked environments

If `npm install` / `npm ci` fails with registry errors (for example HTTP 403), use one of these flows:

1. **Offline install bundle**
   - Follow `console-ui/docs/OFFLINE_INSTALL.md` to prepare `console-ui-node_modules.tgz` on an online machine, then extract in the blocked workspace and run build/typecheck.

2. **Corporate/internal registry**
   - Use `console-ui/.npmrc.enterprise.example` with `NPM_REGISTRY_URL` and `NPM_TOKEN`, then run `npm ci`.

This project intentionally keeps React/Vite dependencies (no attempt to make console-ui dependency-free).
