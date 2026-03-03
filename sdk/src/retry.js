function hashSeed(s = '') {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function shouldRetry({ method, status, attempt, maxRetries, retryable = false, errorCode = '' }) {
  if (attempt >= maxRetries) return false;
  if (retryable) return true;
  const m = String(method || 'GET').toUpperCase();
  const idempotent = ['GET', 'HEAD', 'PUT'].includes(m);
  if (!idempotent) return false;
  if (status === 429 || status === 503) return true;
  return errorCode === 'NETWORK_ERROR';
}

async function withRetry(fn, { method = 'GET', requestId = '', maxRetries = 2, baseDelayMs = 100, retryable = false } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (e) {
      const status = Number(e.status || 0);
      const errorCode = String(e.code || '');
      if (!shouldRetry({ method, status, attempt, maxRetries, retryable, errorCode })) throw e;
      const jitter = hashSeed(`${requestId}:${attempt}`);
      const wait = Math.round(baseDelayMs * (2 ** attempt) * (1 + (0.25 * jitter)));
      await sleep(wait);
      attempt += 1;
    }
  }
}

module.exports = { withRetry };
