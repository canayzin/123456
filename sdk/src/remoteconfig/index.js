function createRemoteConfig(ctx) {
  const state = { lastFetchAt: 0, etag: '', values: {}, minFetch: 0 };
  return {
    async fetch({ minimumFetchIntervalSeconds = 0 } = {}) {
      const now = Date.now();
      const minMs = Math.max(minimumFetchIntervalSeconds, state.minFetch || 0) * 1000;
      if (state.lastFetchAt && (now - state.lastFetchAt) < minMs) return { status: 'THROTTLED', values: state.values };
      const out = await ctx.http.post(`/v1/projects/${ctx.projectId}/remoteconfig/fetch`, {
        appId: ctx.appId,
        platform: ctx.platform,
        uid: ctx.auth.getAccessToken() ? 'authed' : 'anon',
        client: { etag: state.etag || '', lastFetchAt: state.lastFetchAt || 0, minimumFetchIntervalSeconds }
      });
      if (out.status === 'OK') {
        state.lastFetchAt = now;
        state.etag = out.etag || state.etag;
        state.values = out.parameters || {};
        state.minFetch = Number(out.minimumFetchIntervalSeconds || minimumFetchIntervalSeconds || 0);
      }
      return { status: out.status, values: state.values, getString: (k) => String(state.values[k] || ''), getBoolean: (k) => String(state.values[k]) === 'true' };
    }
  };
}

module.exports = { createRemoteConfig };
