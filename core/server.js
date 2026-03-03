const http = require('http');
const { AuthEngine } = require('../services/auth');
const { DocDbEngine } = require('../services/docdb');

const auth = new AuthEngine();
const docDb = new DocDbEngine();

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('payload_too_large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function getAuthUser(req) {
  const value = req.headers.authorization || '';
  const token = value.startsWith('Bearer ') ? value.slice(7) : null;
  return token ? auth.verifyAccessToken(token) : null;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/auth/signup') {
      const body = await parseBody(req);
      return send(res, 201, await auth.signup({ ...body, ip: req.socket.remoteAddress }));
    }
    if (req.method === 'POST' && req.url === '/auth/login') {
      const body = await parseBody(req);
      return send(res, 200, await auth.login({ ...body, ip: req.socket.remoteAddress }));
    }
    if (req.method === 'POST' && req.url === '/auth/refresh') {
      const body = await parseBody(req);
      return send(res, 200, await auth.refreshTokens({ ...body, ip: req.socket.remoteAddress }));
    }

    const mGet = req.url.match(/^\/docdb\/([^/]+)\/([^/]+)$/);
    if (req.method === 'GET' && mGet) {
      const doc = docDb.collection(mGet[1]).doc(mGet[2]).get();
      if (!doc) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Document not found', details: {} } });
      return send(res, 200, doc);
    }
    if (req.method === 'POST' && mGet) {
      const user = getAuthUser(req);
      if (!user) return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized', details: {} } });
      const body = await parseBody(req);
      const doc = docDb.collection(mGet[1]).doc(mGet[2]).set({ ...body, owner: body.owner || user.sub });
      return send(res, 200, doc);
    }

    return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found', details: {} } });
  } catch (e) {
    if (e?.error) return send(res, 400, e);
    const code = e.message === 'invalid_json' ? 'INVALID_JSON' : 'INTERNAL_ERROR';
    return send(res, code === 'INVALID_JSON' ? 400 : 500, { error: { code, message: e.message, details: {} } });
  }
});

if (require.main === module) {
  server.listen(8080, () => console.log('NovaBase core server listening on :8080'));
}

module.exports = { server, auth, docDb };
