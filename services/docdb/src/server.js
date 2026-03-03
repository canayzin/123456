import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { evaluateRules, runRuleTests } from '@novabase/rules-engine';
import { buildStructuredQuery } from './query.js';

const app = Fastify({ logger: { level: 'info' } });
const db = new Database(process.env.DOCDB_PATH || 'docdb.db');
const metrics = { requestsTotal: 0, wsConnections: 0, broadcastsTotal: 0 };
const err = (code, message, details = {}) => ({ error: { code, message, details } });

app.addHook('onRequest', async (req) => {
  metrics.requestsTotal += 1;
  req.requestId = req.headers['x-request-id'] || nanoid();
});
app.addHook('onSend', async (req, reply, payload) => {
  reply.header('x-request-id', req.requestId);
  return payload;
});

await app.register(cors, { origin: true });
await app.register(websocket);

db.exec(`
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,collection TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_docs_project_collection ON documents(project_id, collection);
CREATE TABLE IF NOT EXISTS idempotency_keys (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,method TEXT NOT NULL,path TEXT NOT NULL,response_body TEXT NOT NULL,created_at TEXT NOT NULL);
`);

const rulesByProject = new Map();
const subscriptions = new Map();

function decodeAuth(req) {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) return null;
  try {
    const payload = JSON.parse(Buffer.from(value.replace('Bearer ', '').split('.')[1] || '', 'base64url').toString() || '{}');
    return { uid: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
const getRules = (projectId) => rulesByProject.get(projectId) || [{ path: '/', auth: 'required', allow: true }];
function notify(projectId, collection, payload) {
  const key = `${projectId}:${collection}`;
  for (const socket of subscriptions.get(key) || []) socket.send(JSON.stringify(payload));
  metrics.broadcastsTotal += 1;
}
function getIdempotentResponse(req, projectId) {
  const key = req.headers['idempotency-key'];
  if (!key) return null;
  const row = db.prepare('SELECT response_body FROM idempotency_keys WHERE id = ? AND project_id = ? AND method = ? AND path = ?').get(key, projectId, req.method, req.url);
  return row ? JSON.parse(row.response_body) : null;
}
function saveIdempotentResponse(req, projectId, responseBody) {
  const key = req.headers['idempotency-key'];
  if (!key) return;
  db.prepare('INSERT OR REPLACE INTO idempotency_keys (id, project_id, method, path, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(key, projectId, req.method, req.url, JSON.stringify(responseBody), new Date().toISOString());
}

app.post('/v1/projects/:pid/rules', async (req) => {
  rulesByProject.set(req.params.pid, req.body.rules || []);
  return { ok: true };
});
app.post('/v1/projects/:pid/rules/test', async (req) => ({ results: runRuleTests({ rules: getRules(req.params.pid), tests: req.body.tests || [] }) }));

app.get('/v1/projects/:pid/db/collections/:col/docs', async (req) => ({
  docs: db.prepare('SELECT id, data, created_at, updated_at FROM documents WHERE project_id = ? AND collection = ? LIMIT ? OFFSET ?').all(req.params.pid, req.params.col, Number(req.query.limit || 20), Number(req.query.offset || 0)).map((row) => ({ id: row.id, ...JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at }))
}));

app.post('/v1/projects/:pid/db/collections/:col/docs', async (req, reply) => {
  const cached = getIdempotentResponse(req, req.params.pid);
  if (cached) return cached;
  const data = req.body || {};
  const check = evaluateRules({ rules: getRules(req.params.pid), request: { path: `/${req.params.col}`, method: 'create', auth: decodeAuth(req), data } });
  if (!check.allow) return reply.code(403).send(err('FORBIDDEN', 'Rules denied request', { reason: check.reason }));
  const id = data.id || nanoid();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO documents (id, project_id, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.params.pid, req.params.col, JSON.stringify(data), now, now);
  const doc = { id, ...data, createdAt: now, updatedAt: now };
  saveIdempotentResponse(req, req.params.pid, doc);
  notify(req.params.pid, req.params.col, { type: 'created', doc });
  return reply.code(201).send(doc);
});

app.get('/v1/projects/:pid/db/collections/:col/docs/:id', async (req, reply) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND project_id = ? AND collection = ?').get(req.params.id, req.params.pid, req.params.col);
  if (!row) return reply.code(404).send(err('NOT_FOUND', 'Document not found'));
  return { id: row.id, ...JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at };
});

app.patch('/v1/projects/:pid/db/collections/:col/docs/:id', async (req, reply) => {
  const cached = getIdempotentResponse(req, req.params.pid);
  if (cached) return cached;
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND project_id = ? AND collection = ?').get(req.params.id, req.params.pid, req.params.col);
  if (!row) return reply.code(404).send(err('NOT_FOUND', 'Document not found'));
  const existing = JSON.parse(row.data);
  const next = { ...existing, ...(req.body || {}) };
  const check = evaluateRules({ rules: getRules(req.params.pid), request: { path: `/${req.params.col}`, method: 'update', auth: decodeAuth(req), data: next, existing } });
  if (!check.allow) return reply.code(403).send(err('FORBIDDEN', 'Rules denied request', { reason: check.reason }));
  const now = new Date().toISOString();
  db.prepare('UPDATE documents SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), now, req.params.id);
  const doc = { id: req.params.id, ...next, createdAt: row.created_at, updatedAt: now };
  saveIdempotentResponse(req, req.params.pid, doc);
  notify(req.params.pid, req.params.col, { type: 'updated', doc });
  return doc;
});

app.put('/v1/projects/:pid/db/collections/:col/docs/:id', async (req, reply) => {
  const response = await app.inject({ method: 'PATCH', url: `/v1/projects/${req.params.pid}/db/collections/${req.params.col}/docs/${req.params.id}`, payload: req.body || {}, headers: req.headers });
  return reply.code(response.statusCode).send(response.body ? JSON.parse(response.body) : {});
});
app.delete('/v1/projects/:pid/db/collections/:col/docs/:id', async (req) => {
  db.prepare('DELETE FROM documents WHERE id = ? AND project_id = ? AND collection = ?').run(req.params.id, req.params.pid, req.params.col);
  notify(req.params.pid, req.params.col, { type: 'deleted', id: req.params.id });
  return { ok: true };
});

app.post('/v1/projects/:pid/db/query', async (req, reply) => {
  try {
    const query = buildStructuredQuery(req.body || {});
    const rows = db.prepare(`SELECT * FROM documents WHERE ${['project_id = ?', 'collection = ?'].concat(query.clauses).join(' AND ')} ORDER BY ${query.orderBy} ${query.direction} LIMIT ? OFFSET ?`).all(req.params.pid, query.collection, ...query.args, query.limit, query.offset).map((row) => ({ id: row.id, ...JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at }));
    return { docs: rows, page: { limit: query.limit, offset: query.offset } };
  } catch (error) {
    return reply.code(400).send(err('INVALID_QUERY', 'Invalid query', { message: String(error.message || error) }));
  }
});

app.get('/v1/projects/:pid/db/subscribe', { websocket: true }, (socket, req) => {
  metrics.wsConnections += 1;
  socket.on('message', (raw) => {
    try {
      const { collection } = JSON.parse(raw.toString());
      if (!collection) return;
      const key = `${req.params.pid}:${collection}`;
      if (!subscriptions.has(key)) subscriptions.set(key, new Set());
      subscriptions.get(key).add(socket);
      socket.send(JSON.stringify({ type: 'subscribed', collection, resumeToken: Date.now().toString() }));
    } catch {
      socket.send(JSON.stringify({ type: 'error', error: err('INVALID_SUBSCRIBE_PAYLOAD', 'Invalid subscribe payload').error }));
    }
  });
  socket.on('close', () => {
    metrics.wsConnections = Math.max(0, metrics.wsConnections - 1);
    for (const set of subscriptions.values()) set.delete(socket);
  });
});

app.get('/metrics', async () => `requests_total ${metrics.requestsTotal}\nws_connections ${metrics.wsConnections}\nbroadcasts_total ${metrics.broadcastsTotal}\n`);
app.get('/health', async () => ({ status: 'ok', service: 'docdb' }));
app.get('/docs', async (_, reply) => reply.type('text/html').send(`<!doctype html><html><body><h1>Swagger UI</h1><div id="swagger"></div><script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" /><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger'})</script></body></html>`));
app.get('/openapi.json', async () => ({ openapi: '3.1.0', info: { title: 'NovaBase DocDB API', version: '1.0.0' } }));

app.listen({ port: Number(process.env.PORT || 4002), host: '0.0.0.0' });
