import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { evaluateRules, runRuleTests } from '@novabase/rules-engine';

const app = Fastify({ logger: true });
const db = new Database(process.env.DOCDB_PATH || 'docdb.db');

await app.register(cors, { origin: true });
await app.register(websocket);

db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_project_collection ON documents(project_id, collection);
`);

const rulesByProject = new Map();
const subscriptions = new Map();

function decodeAuth(req) {
  const value = req.headers.authorization;
  if (!value) return null;
  const token = value.replace('Bearer ', '');
  const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString() || '{}');
  return { uid: payload.sub, email: payload.email };
}

function getRules(projectId) {
  return rulesByProject.get(projectId) || [{ path: '/', auth: 'required', allow: true }];
}

function notify(projectId, collection, payload) {
  const key = `${projectId}:${collection}`;
  for (const socket of subscriptions.get(key) || []) {
    socket.send(JSON.stringify(payload));
  }
}

app.post('/v1/projects/:pid/rules', async (req) => {
  rulesByProject.set(req.params.pid, req.body.rules || []);
  return { ok: true };
});

app.post('/v1/projects/:pid/rules/test', async (req) => {
  return { results: runRuleTests({ rules: getRules(req.params.pid), tests: req.body.tests || [] }) };
});

app.get('/v1/projects/:pid/db/collections/:col/docs', async (req) => {
  const docs = db.prepare('SELECT id, data, created_at, updated_at FROM documents WHERE project_id = ? AND collection = ? LIMIT ? OFFSET ?')
    .all(req.params.pid, req.params.col, Number(req.query.limit || 20), Number(req.query.offset || 0))
    .map((row) => ({ id: row.id, ...JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at }));
  return { docs };
});

app.post('/v1/projects/:pid/db/collections/:col/docs', async (req, reply) => {
  const auth = decodeAuth(req);
  const data = req.body || {};
  const check = evaluateRules({ rules: getRules(req.params.pid), request: { path: `/${req.params.col}`, method: 'create', auth, data } });
  if (!check.allow) return reply.code(403).send({ error: 'forbidden', reason: check.reason });

  const id = data.id || nanoid();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO documents (id, project_id, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.pid, req.params.col, JSON.stringify(data), now, now);
  const doc = { id, ...data, createdAt: now, updatedAt: now };
  notify(req.params.pid, req.params.col, { type: 'created', doc });
  return reply.code(201).send(doc);
});

app.get('/v1/projects/:pid/db/collections/:col/docs/:id', async (req, reply) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND project_id = ? AND collection = ?').get(req.params.id, req.params.pid, req.params.col);
  if (!row) return reply.code(404).send({ error: 'not_found' });
  return { id: row.id, ...JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at };
});

app.patch('/v1/projects/:pid/db/collections/:col/docs/:id', async (req, reply) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND project_id = ? AND collection = ?').get(req.params.id, req.params.pid, req.params.col);
  if (!row) return reply.code(404).send({ error: 'not_found' });

  const existing = JSON.parse(row.data);
  const next = { ...existing, ...(req.body || {}) };
  const auth = decodeAuth(req);
  const check = evaluateRules({ rules: getRules(req.params.pid), request: { path: `/${req.params.col}`, method: 'update', auth, data: next, existing } });
  if (!check.allow) return reply.code(403).send({ error: 'forbidden', reason: check.reason });

  const now = new Date().toISOString();
  db.prepare('UPDATE documents SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), now, req.params.id);
  const doc = { id: req.params.id, ...next, createdAt: row.created_at, updatedAt: now };
  notify(req.params.pid, req.params.col, { type: 'updated', doc });
  return doc;
});

app.delete('/v1/projects/:pid/db/collections/:col/docs/:id', async (req) => {
  db.prepare('DELETE FROM documents WHERE id = ? AND project_id = ? AND collection = ?').run(req.params.id, req.params.pid, req.params.col);
  notify(req.params.pid, req.params.col, { type: 'deleted', id: req.params.id });
  return { ok: true };
});

app.post('/v1/projects/:pid/db/query', async (req) => {
  const { collection, where = [], orderBy = 'updated_at', direction = 'desc', limit = 20, offset = 0 } = req.body;
  const clauses = ['project_id = ?', 'collection = ?'];
  const args = [req.params.pid, collection];
  for (const filter of where) {
    clauses.push(`json_extract(data, '$.${filter.field}') = ?`);
    args.push(filter.value);
  }
  const rows = db.prepare(`SELECT * FROM documents WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy} ${direction.toUpperCase()} LIMIT ? OFFSET ?`)
    .all(...args, limit, offset)
    .map((row) => ({ id: row.id, ...JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at }));
  return { docs: rows };
});

app.get('/v1/projects/:pid/db/subscribe/:col', { websocket: true }, (socket, req) => {
  const key = `${req.params.pid}:${req.params.col}`;
  if (!subscriptions.has(key)) subscriptions.set(key, new Set());
  subscriptions.get(key).add(socket);

  socket.on('close', () => {
    subscriptions.get(key)?.delete(socket);
  });
});

app.get('/health', async () => ({ status: 'ok', service: 'docdb' }));

const port = Number(process.env.PORT || 4002);
app.listen({ port, host: '0.0.0.0' });
