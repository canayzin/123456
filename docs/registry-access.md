# Registry Access Playbook (Restricted Environments)

## Critical note

This repository changes **do not unlock npmjs.org access by themselves**. They only make builds work when an internal corporate registry is reachable, or when firewall allowlist is provided.

If you see `CONNECT tunnel failed` + `403`, root cause is network policy/proxy layer (infrastructure side).

## 1) Strong `.npmrc` template

Use this exact template at project root (`.npmrc`):

```ini
registry=${NPM_REGISTRY_URL}
always-auth=true
fund=false
audit=false

//${NPM_REGISTRY_HOST}/:_authToken=${NPM_TOKEN}
```

Required values:
- `NPM_REGISTRY_URL`: e.g. `https://artifactory.company.com/artifactory/api/npm/npm-virtual/`
- `NPM_REGISTRY_HOST`: same URL **without protocol**, e.g. `artifactory.company.com/artifactory/api/npm/npm-virtual/`
- `NPM_TOKEN`: token with package read permissions

> `/_authToken` host/path must match registry URL path. If path is wrong, you get `401/403`.

## 2) CI automation pattern (recommended)

```bash
if [ -n "${NPM_REGISTRY_URL}" ] && [ -n "${NPM_TOKEN}" ]; then
  REG_HOST="${NPM_REGISTRY_URL#https://}"
  REG_HOST="${REG_HOST#http://}"
  echo "registry=${NPM_REGISTRY_URL}" > .npmrc
  echo "always-auth=true" >> .npmrc
  echo "//${REG_HOST}:_authToken=${NPM_TOKEN}" >> .npmrc
fi

npm ping
npm view @types/node version
npm ci
```

Why:
- `npm ping`/`npm view` gives fail-fast diagnostics before dependency install.
- Token line is normalized from URL to npm-compatible host/path format.

## 3) Most common failure causes

1. Wrong registry path (Artifactory frequently uses `.../api/npm/npm-virtual/`)
2. `_authToken` host/path mismatch with configured registry
3. Token permission missing (read denied)
4. Proxy CONNECT blocked (`CONNECT tunnel failed` signature)
5. TLS inspection / certificate problems (usually `CERT_*` errors)

## 4) Deterministic diagnosis commands

```bash
node -p "process.env.NPM_REGISTRY_URL"
npm config get registry
npm ping --registry "$NPM_REGISTRY_URL"
npm view @types/node version --registry "$NPM_REGISTRY_URL"
```

Interpretation:
- `401/403`: token, permission, or URL/path mismatch
- `CONNECT tunnel failed`: network/proxy policy issue
- `getaddrinfo ENOTFOUND`: DNS/URL typo

## 5) If proxy/allowlist unavailable (temporary fallback)

```bash
# online machine
npm ci
tar -czf node_modules.tgz node_modules package-lock.json

# restricted machine
tar -xzf node_modules.tgz
npm test
```

## 6) Guardrail in restricted mode

Avoid adding new npm dependencies while registry access is blocked; prefer built-in Node.js modules until connectivity is restored.
