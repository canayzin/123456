function quotaError(message, details = {}) {
  const e = new Error(message);
  e.code = 'RESOURCE_EXHAUSTED';
  e.details = details;
  return e;
}
module.exports = { quotaError };
