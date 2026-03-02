export function init(config) {
  const state = { ...config, accessToken: null, listeners: [] };

  async function request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
    const res = await fetch(`${state.baseUrl}${path}`, { ...options, headers });
    if (res.status === 204) return null;
    const body = await res.json();
    if (!res.ok) throw Object.assign(new Error(body.error || 'request_failed'), { status: res.status, body });
    return body;
  }

  return {
    auth: {
      async signUp(email, password) {
        const data = await request('/v1/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
        state.accessToken = data.accessToken;
        state.listeners.forEach((cb) => cb(data.user));
        return data.user;
      },
      async signIn(email, password) {
        const data = await request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        state.accessToken = data.accessToken;
        state.listeners.forEach((cb) => cb(data.user));
        return data.user;
      },
      onAuthStateChanged(cb) {
        state.listeners.push(cb);
      }
    },
    db: {
      collection(name) {
        return {
          async add(data) {
            return request(`/v1/projects/${state.projectId}/db/collections/${name}/docs`, { method: 'POST', body: JSON.stringify(data) });
          },
          doc(id) {
            return {
              async get() {
                return request(`/v1/projects/${state.projectId}/db/collections/${name}/docs/${id}`);
              },
              async set(data) {
                return request(`/v1/projects/${state.projectId}/db/collections/${name}/docs/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
              },
              onSnapshot(cb) {
                const ws = new WebSocket(`${state.wsUrl}/v1/projects/${state.projectId}/db/subscribe/${name}`);
                ws.onmessage = (evt) => {
                  const message = JSON.parse(evt.data);
                  if (message.doc?.id === id) cb(message.doc);
                };
                return () => ws.close();
              }
            };
          }
        };
      }
    }
  };
}
