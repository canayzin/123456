const { withRetry } = require('./retry');
const { NovaError, toNovaError } = require('./errors');

function makeHttp(ctx) {
  async function request(method, url, { body, headers = {}, idempotent = false, requestId = '' } = {}) {
    const doFetch = async () => {
      const h = { ...ctx.defaultHeaders(), ...headers };
      const token = ctx.getAccessToken();
      if (token) h.authorization = `Bearer ${token}`;
      const res = await fetch(`${ctx.baseUrl}${url}`, { method, headers: h, body: body != null ? JSON.stringify(body) : undefined });
      let json = null;
      const text = await res.text();
      try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
      if (!res.ok) throw toNovaError(json, res.status, res.headers.get('x-request-id') || requestId);
      return json;
    };

    try {
      return await withRetry(() => doFetch(), { method, requestId, maxRetries: ctx.maxRetries, retryable: idempotent });
    } catch (e) {
      if (e instanceof NovaError && (e.code === 'UNAUTHENTICATED' || e.status === 401) && ctx.refreshOnce) {
        const refreshed = await ctx.refreshOnce();
        if (refreshed) return doFetch();
      }
      if (e instanceof NovaError) throw e;
      throw new NovaError(e.message || 'Network error', { code: 'NETWORK_ERROR', status: 0 });
    }
  }

  return {
    get: (u, o) => request('GET', u, o),
    post: (u, b, o = {}) => request('POST', u, { ...o, body: b }),
    put: (u, b, o = {}) => request('PUT', u, { ...o, body: b, idempotent: true }),
    delete: (u, o) => request('DELETE', u, o)
  };
}

module.exports = { makeHttp };
