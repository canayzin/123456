# Registry Access Playbook (Restricted Environments)

## 1) Fast diagnosis

```bash
npm config get registry
curl -I https://registry.npmjs.org/@types/node
```

If curl returns `403`, this is a network policy/egress restriction.

## 2) Recommended corporate solution: internal npm proxy

Use Artifactory/Nexus/Verdaccio and point npm to it.

1. Copy `.npmrc.enterprise.example` to `.npmrc`
2. Set token and run install:

```bash
export NPM_TOKEN="..."
npm ci
```

## 3) If external/internal registry is unavailable

Temporary fallback for runtime-only validation:

- Install dependencies in an internet-enabled environment
- Archive and move `node_modules` + lockfile
- Extract and run tests in restricted container

```bash
# online machine
npm ci
tar -czf node_modules.tgz node_modules package-lock.json

# restricted machine
tar -xzf node_modules.tgz
npm test
```

## 4) Engineering guardrail for this repo in restricted mode

When registry is blocked, avoid adding new npm dependencies and prefer built-in Node.js modules until registry access is restored.
