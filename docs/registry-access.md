# Registry Access Playbook (Restricted Environments)

## 1) Fast diagnosis

```bash
npm config get registry
curl -I https://registry.npmjs.org/@types/node
```

If curl returns `403`, this is a network policy/egress restriction.

## 2) Recommended corporate solution: internal npm proxy

Use Artifactory/Nexus/Verdaccio and point npm to it.

### A) Activate `.npmrc` in project root

```bash
cp .npmrc.enterprise.example .npmrc
```

Then replace registry host/path with your real corporate URL.

### B) Provide token and install

```bash
export NPM_TOKEN="..."
npm ci
```

### C) Validate

```bash
npm ping
npm view @types/node version
```

If both commands work, `npm install`/`npm ci` should work too.

## 3) If proxy is not available: allowlist request

Ask network/security team to allow:

- `registry.npmjs.org:443`
- (optional) `registry.yarnpkg.com:443`
- (sometimes required) `codeload.github.com:443`, `objects.githubusercontent.com:443`

`CONNECT tunnel failed` generally indicates proxy/firewall policy denial.

## 4) If neither proxy nor allowlist is possible (temporary workaround)

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

## 5) Engineering guardrail for restricted mode

When registry is blocked, avoid adding new npm dependencies and prefer built-in Node.js modules until registry access is restored.
