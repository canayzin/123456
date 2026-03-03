function quotaMiddleware(quota, resolver) {
  return (req, _res, context = {}) => {
    const meta = resolver(req, context);
    const url = String(req.url || '');
    if (url.startsWith('/v1/projects/') && (url.includes('/quota') || url.includes('/usage'))) return meta;
    quota.preCheck({ projectId: meta.projectId, ip: meta.ip, uid: meta.uid, service: 'http', op: 'request', amount: 1 });
    return meta;
  };
}
module.exports = { quotaMiddleware };
