function requiredScopeFor(req) {
  const url = req.url || '';
  if (url.startsWith('/v1/projects/') && req.method === 'PUT' && url.includes('/quota')) return 'quota.admin';
  if (url.startsWith('/v1/projects/') && req.method === 'GET' && url.includes('/quota')) return 'quota.admin';
  if (url.startsWith('/v1/projects/') && req.method === 'GET' && url.includes('/usage')) return 'analytics.read';
  if (url.startsWith('/v1/projects/') && req.method === 'POST' && url.includes('/sync')) return 'docdb.write';
  if (url.startsWith('/v1/projects/') && req.method === 'POST' && url.includes('/buckets')) return 'storage.admin';
  if (url.startsWith('/__regions/failover')) return 'region.failover';
  return '';
}

module.exports = { requiredScopeFor };
