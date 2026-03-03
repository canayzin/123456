function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

class NovaError extends Error {
  constructor(code, message, details = {}, status = 500) {
    super(message);
    this.name = 'NovaError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function createClient(config) {
  const state = {
    projectId: config.projectId,
    apiKey: config.apiKey,
    authBaseUrl: config.authBaseUrl || config.baseUrl,
    dataBaseUrl: config.dataBaseUrl || config.baseUrl,
    wsUrl: config.wsUrl,
    accessToken: null,
    listeners: []
  };

  async function request(baseUrl, path, options = {}, retries = 2) {
    const headers = { 'Content-Type': 'application/json', 'x-api-key': state.apiKey, ...(options.headers || {}) };
    if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
        if (res.status === 204) return null;
        const body = await res.json();
        if (!res.ok) {
          const e = body.error || {};
          throw new NovaError(e.code || 'REQUEST_FAILED', e.message || 'Request failed', e.details || body, res.status);
        }
        return body;
      } catch (error) {
        if (attempt >= retries) throw error;
        await delay(100 * (2 ** attempt));
      }
    }
    throw new NovaError('REQUEST_FAILED', 'Request failed');
  }

  const auth = {
    async signUp(email, password) {
      const data = await request(state.authBaseUrl, '/v1/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
      state.accessToken = data.accessToken;
      state.listeners.forEach((cb) => cb(data.user));
      return data.user;
    },
    async signIn(email, password) {
      const data = await request(state.authBaseUrl, '/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      state.accessToken = data.accessToken;
      state.listeners.forEach((cb) => cb(data.user));
      return data.user;
    },
    me() { return request(state.authBaseUrl, '/v1/auth/me'); },
    onAuthStateChanged(cb) { state.listeners.push(cb); }
  };

  function collection(name) {
    const query = { where: [], limit: 20, offset: 0, orderBy: 'updated_at', direction: 'desc' };
    return {
      where(field, op, value) { query.where.push({ field, op, value }); return this; },
      limit(value) { query.limit = value; return this; },
      orderBy(field, direction = 'desc') { query.orderBy = field; query.direction = direction; return this; },
      async get() {
        return request(state.dataBaseUrl, `/v1/projects/${state.projectId}/db/query`, { method: 'POST', body: JSON.stringify({ collection: name, ...query }) });
      },
      async add(data) {
        return request(state.dataBaseUrl, `/v1/projects/${state.projectId}/db/collections/${name}/docs`, { method: 'POST', body: JSON.stringify(data) });
      },
      doc(id) {
        return {
          get: () => request(state.dataBaseUrl, `/v1/projects/${state.projectId}/db/collections/${name}/docs/${id}`),
          set: (data) => request(state.dataBaseUrl, `/v1/projects/${state.projectId}/db/collections/${name}/docs/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
          onSnapshot(cb) {
            const ws = new WebSocket(`${state.wsUrl}/v1/projects/${state.projectId}/db/subscribe`);
            ws.onopen = () => ws.send(JSON.stringify({ collection: name }));
            ws.onmessage = (evt) => {
              const msg = JSON.parse(evt.data);
              if (msg.doc?.id === id) cb({ data: () => msg.doc, type: msg.type });
            };
            return () => ws.close();
          }
        };
      }
    };
  }

  return { auth, docDb: { collection }, error: { NovaError } };
}

export const init = createClient;
