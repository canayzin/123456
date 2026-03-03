# Offline Install Guide (console-ui)

This guide is for environments where npm registry access is blocked (e.g. HTTP 403).

## A) Prepare bundle on an online machine

```bash
cd console-ui
npm ci
npm pack
# optional: keep generated .tgz package artifact

tar -czf console-ui-node_modules.tgz node_modules package-lock.json
```

Copy `console-ui-node_modules.tgz` into this workspace root (or `console-ui/`).

## B) Restore in blocked workspace

```bash
cd console-ui
# if tarball is in repo root:
tar -xzf ../console-ui-node_modules.tgz
# or if tarball is already in console-ui/:
# tar -xzf console-ui-node_modules.tgz

npm run build
```

## C) Validate

```bash
npm run typecheck
npm run build
```
