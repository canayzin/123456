const { MemoryStore } = require('./cache');
const { makeHttp } = require('./http');
const { createTokenManager } = require('./auth/tokens');
const { createAuth } = require('./auth');
const { createDocDb } = require('./docdb');
const { createFunctions } = require('./functions');
const { createStorage } = require('./storage');
const { createMessaging } = require('./messaging');
const { createRemoteConfig } = require('./remoteconfig');
const { createAnalytics } = require('./analytics');
const { createAppCheck } = require('./appcheck');

async function createClient(opts = {}) {
  const baseUrl = opts.baseUrl || 'http://127.0.0.1:8080';
  const store = opts.storage || new MemoryStore();
  const tokens = createTokenManager(store);

  const ctx = {
    baseUrl,
    projectId: opts.projectId,
    orgId: opts.orgId || '',
    appId: opts.appId || '',
    platform: opts.platform || 'web',
    deviceId: opts.deviceId || '',
    debugAppCheckToken: opts.debugAppCheckToken || '',
    appCheckToken: '',
    appCheckExp: 0,
    maxRetries: Number(opts.maxRetries || 2),
    analyticsFlushIntervalMs: Number(opts.analyticsFlushIntervalMs || 1000),
    analyticsBatchSize: Number(opts.analyticsBatchSize || 20),
    getAccessToken: () => tokens.accessToken,
    tokens,
    defaultHeaders: () => ({ 'content-type': 'application/json', 'x-api-key': opts.apiKey || '', ...(ctx.orgId ? { 'x-organization': ctx.orgId } : {}), ...(ctx.projectId ? { 'x-project': ctx.projectId } : {}), ...(ctx.appId ? { 'x-app-id': ctx.appId } : {}), ...(ctx.deviceId ? { 'x-device-id': ctx.deviceId } : {}), ...(ctx.appCheckToken ? { 'x-appcheck': ctx.appCheckToken } : {}) }),
    refreshOnce: async () => {
      if (!tokens.refreshToken) return false;
      const out = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
      if (!out.ok) return false;
      const j = await out.json();
      tokens.accessToken = j.accessToken || '';
      tokens.refreshToken = j.refreshToken || tokens.refreshToken;
      return true;
    }
  };
  ctx.http = makeHttp(ctx);

  const auth = createAuth(ctx);
  ctx.auth = auth;
  const appCheck = createAppCheck(ctx);
  ctx.appCheck = appCheck;
  if (ctx.debugAppCheckToken) await appCheck.ensureToken();

  const client = {
    auth,
    docdb: createDocDb({ ...ctx, auth }),
    functions: createFunctions({ ...ctx, auth }),
    storage: createStorage({ ...ctx, auth }),
    messaging: createMessaging({ ...ctx, auth }),
    remoteConfig: createRemoteConfig({ ...ctx, auth }),
    analytics: createAnalytics({ ...ctx, auth, appCheck }),
    appcheck: appCheck,
    close() { client.analytics.close(); }
  };

  return client;
}

module.exports = { createClient };
