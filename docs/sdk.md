# NovaCloud SDK (Phase 22)

## Install/usage
This repository ships a zero-dependency SDK under `sdk/`.

```js
const { createClient } = require('../sdk/src');
```

## Quickstart
```js
const client = await createClient({
  projectId: 'p1',
  apiKey: 'pk_live_xxx',
  baseUrl: 'http://127.0.0.1:8080',
  appId: 'app_1',
  platform: 'web',
  deviceId: 'd1',
  debugAppCheckToken: 'dbg_xxx'
});
```

## Modules
- `client.auth` (`signUp`, `signIn`, `signOut`, `getAccessToken`, auto-refresh)
- `client.docdb` (`collection().doc().set/get`, basic query builder, snapshot polling)
- `client.functions` (`httpsCallable(name)`)
- `client.storage` (`upload`, `download` via signed URLs)
- `client.messaging` (`registerToken`, `subscribe`, `send`, emulator device ws helper)
- `client.remoteConfig` (`fetch`, minimumFetchInterval cache, `getString/getBoolean`)
- `client.analytics` (`logEvent`, batching, `flush`)
- `client.appcheck` (debug exchange + token refresh)

## Error handling
HTTP layer throws `NovaError` with:
- `code`
- `status`
- `requestId`
- `details`

Retry/backoff is applied for network/429/503 and idempotent operations.

## Example
See `sdk/examples/node-smoke.js`.
