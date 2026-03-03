const { createBatcher } = require('./batcher');

function createAnalytics(ctx) {
  const batcher = createBatcher(async (events) => {
    if (ctx.appCheck) await ctx.appCheck.ensureToken();
    await ctx.http.post(`/v1/projects/${ctx.projectId}/analytics/events`, {
      appId: ctx.appId,
      platform: ctx.platform,
      uid: ctx.auth.getAccessToken() ? 'authed' : 'anon',
      deviceId: ctx.deviceId || '',
      country: 'TR',
      events
    });
  }, { flushIntervalMs: ctx.analyticsFlushIntervalMs || 1000, batchSize: ctx.analyticsBatchSize || 20 });

  return {
    logEvent(name, params = {}, ts = Date.now()) { batcher.push({ name, params, ts }); },
    flush() { return batcher.flushAll(); },
    close() { batcher.close(); }
  };
}

module.exports = { createAnalytics };
