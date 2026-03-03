const http = require('http');
const https = require('https');

function requestWithHttp(url, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: `${u.pathname}${u.search}`, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const parsed = data ? JSON.parse(data) : null;
        if (res.statusCode >= 400) return reject(parsed);
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function makeRequest(url, method = 'GET', body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (typeof fetch === 'function') {
    return fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw j;
      return j;
    });
  }
  return requestWithHttp(url, method, body, headers);
}

function createClient({ baseURL }) {
  const state = { token: null };

  return {
    auth: {
      async login(email, password) {
        const out = await makeRequest(`${baseURL}/auth/login`, 'POST', { email, password });
        state.token = out.accessToken;
        return out;
      },
      signup(email, password) {
        return makeRequest(`${baseURL}/auth/signup`, 'POST', { email, password });
      }
    },
    docDb: {
      collection(name) {
        return {
          doc(id) {
            return {
              get() {
                return makeRequest(`${baseURL}/docdb/${name}/${id}`, 'GET', null, state.token);
              },
              set(data) {
                return makeRequest(`${baseURL}/docdb/${name}/${id}`, 'POST', data, state.token);
              }
            };
          }
        };
      }
    }
  };
}

module.exports = { createClient };
