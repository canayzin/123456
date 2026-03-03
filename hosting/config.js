const { hostingError } = require('./errors');

function normalizeConfig(cfg = {}) {
  const out = {
    cleanUrls: Boolean(cfg.cleanUrls),
    trailingSlash: cfg.trailingSlash || 'ignore',
    headers: Array.isArray(cfg.headers) ? cfg.headers : [],
    redirects: Array.isArray(cfg.redirects) ? cfg.redirects : [],
    rewrites: Array.isArray(cfg.rewrites) ? cfg.rewrites : []
  };
  if (!['ignore', 'add', 'remove'].includes(out.trailingSlash)) throw hostingError('INVALID_ARGUMENT', 'Invalid trailingSlash');
  return out;
}

module.exports = { normalizeConfig };
