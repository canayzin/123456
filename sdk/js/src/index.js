export function init(config) {
  const state = {
    appId: config.appId,
    apiKey: config.apiKey,
    projectId: config.projectId,
    authBaseUrl: config.authBaseUrl || config.baseUrl,
    dataBaseUrl: config.dataBaseUrl || config.baseUrl,
    wsUrl: config.wsUrl,
    accessToken: null,
    listeners: []
  };

  async function request(baseUrl, path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': state.apiKey,
      ...(options.headers || {})
    };
    if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;

    const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
    if (res.status === 204) return null;
    const body = await res.json();
    if (!res.ok) {
      const err = new Error(body.error || 'request_failed');
      err.status = res.status;
      err.code = body.error || 'request_failed';
      err.details = body;
      throw err;
    }
    return body;
  }

  return {
    auth: {
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
      async me() {
        return request(state.authBaseUrl, '/v1/auth/me');
      },
      onAuthStateChanged(cb) {
        state.listeners.push(cb);
      }
    },
    db: {
      collection(name) {
        return {
          async add(data) {
            return request(state.dataBaseUrl, `/v1/projects/${state.projectId}/db/collections/${name}/docs`, {
              method: 'POST',
              body: JSON.stringify(data)
            });
          },
          async list(params = {}) {
            const qs = new URLSearchParams(params).toString();
            return request(state.dataBaseUrl, `/v1/projects/${state.projectId}/db/collections/${name}/docs${qs ? `?${qs}` : ''}`);
          },
          doc(id) {
            return {
              async get() {
                return request(state.dataBaseUrl, `/v1/projects/${state.projectId}/db/collections/${name}/docs/${id}`);
              },
              async set(data) {
                return request(state.dataBaseUrl, `/v1/projects/${state.projectId}/db/collections/${name}/docs/${id}`, {
                  method: 'PATCH',
                  body: JSON.stringify(data)
                });
              }
            };
          },
          onSnapshot(cb) {
            const ws = new WebSocket(`${state.wsUrl}/v1/projects/${state.projectId}/db/subscribe`);
            ws.onopen = () => ws.send(JSON.stringify({ collection: name }));
            ws.onmessage = (evt) => {
              const message = JSON.parse(evt.data);
              if (message.doc) cb(message);
            };
            return () => ws.close();
          }
        };
      }
    }
  };
}
