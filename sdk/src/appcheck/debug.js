async function exchangeDebug(ctx) {
  if (!ctx.debugAppCheckToken || !ctx.appId) return null;
  const out = await ctx.http.post(`/v1/projects/${ctx.projectId}/appcheck/exchangeDebug`, { appId: ctx.appId, debugToken: ctx.debugAppCheckToken });
  ctx.appCheckToken = out.token;
  ctx.appCheckExp = Number(out.expireTime || 0);
  return out;
}

module.exports = { exchangeDebug };
