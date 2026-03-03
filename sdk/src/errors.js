class NovaError extends Error {
  constructor(message, { code = 'INTERNAL', status = 500, requestId = '', details = null } = {}) {
    super(message || code);
    this.name = 'NovaError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

function toNovaError(payload, status = 500, requestId = '') {
  if (payload instanceof NovaError) return payload;
  const e = payload?.error || payload || {};
  return new NovaError(e.message || 'Request failed', {
    code: e.code || 'INTERNAL',
    status,
    requestId: e.details?.requestId || requestId || '',
    details: e.details || null
  });
}

module.exports = { NovaError, toNovaError };
