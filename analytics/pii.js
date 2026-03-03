const SENSITIVE_KEYS = ['email', 'phone', 'ssn', 'password', 'token', 'secret'];

function hasSensitiveKey(key = '') {
  const low = String(key).toLowerCase();
  return SENSITIVE_KEYS.some((x) => low.includes(x));
}

function looksLikeEmail(value) {
  return typeof value === 'string' && /.+@.+\..+/.test(value);
}

module.exports = { hasSensitiveKey, looksLikeEmail };
