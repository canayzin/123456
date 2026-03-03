function extractToken(req) {
  const h1 = req.headers['x-appcheck'];
  if (h1) return String(h1);
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('AppCheck ')) return auth.slice('AppCheck '.length);
  return '';
}

function enforceMode(app, serviceKey) {
  return app?.enforcement?.[serviceKey] || 'off';
}

function appIdFromHeaders(req) {
  return String(req.headers['x-app-id'] || '');
}

module.exports = { extractToken, enforceMode, appIdFromHeaders };
