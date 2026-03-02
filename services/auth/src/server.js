import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const app = Fastify({ logger: true });
const db = new Database(process.env.AUTH_DB_PATH || 'auth.db');

const accessTtl = '15m';
const refreshTtl = '7d';

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified INTEGER DEFAULT 0,
  disabled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  revoked INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  user_id TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
`);

await app.register(cors, { origin: true, credentials: true });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret' });

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

function createAudit(action, userId, ip) {
  db.prepare('INSERT INTO audit_logs (id, action, user_id, ip, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(nanoid(), action, userId ?? null, ip ?? null, new Date().toISOString());
}

function createAccessToken(user) {
  return app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: accessTtl });
}

function createRefreshToken(userId) {
  const raw = nanoid(48);
  const hash = bcrypt.hashSync(raw, 10);
  db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(nanoid(), userId, hash, new Date().toISOString());
  return raw;
}

app.post('/v1/auth/signup', async (req, reply) => {
  const parse = credentialsSchema.safeParse(req.body);
  if (!parse.success) return reply.code(400).send({ error: 'invalid_payload', details: parse.error.flatten() });

  const { email, password } = parse.data;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return reply.code(409).send({ error: 'email_exists' });

  const id = nanoid();
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, email, hash, new Date().toISOString());

  const user = { id, email };
  createAudit('signup', id, req.ip);
  return reply.code(201).send({
    user,
    accessToken: createAccessToken(user),
    refreshToken: createRefreshToken(id)
  });
});

app.post('/v1/auth/login', async (req, reply) => {
  const parse = credentialsSchema.safeParse(req.body);
  if (!parse.success) return reply.code(400).send({ error: 'invalid_payload' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(parse.data.email);
  if (!user || !bcrypt.compareSync(parse.data.password, user.password_hash)) {
    createAudit('login_failed', user?.id, req.ip);
    return reply.code(401).send({ error: 'invalid_credentials' });
  }
  if (user.disabled) return reply.code(403).send({ error: 'user_disabled' });

  createAudit('login_success', user.id, req.ip);
  return {
    user: { id: user.id, email: user.email, emailVerified: Boolean(user.email_verified) },
    accessToken: createAccessToken(user),
    refreshToken: createRefreshToken(user.id)
  };
});

app.post('/v1/auth/refresh', async (req, reply) => {
  const token = req.body?.refreshToken;
  if (!token) return reply.code(400).send({ error: 'missing_refresh_token' });

  const rows = db.prepare('SELECT * FROM refresh_tokens WHERE revoked = 0').all();
  const record = rows.find((row) => bcrypt.compareSync(token, row.token_hash));
  if (!record) return reply.code(401).send({ error: 'invalid_refresh_token' });

  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(record.id);
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(record.user_id);

  return {
    accessToken: createAccessToken(user),
    refreshToken: createRefreshToken(user.id)
  };
});

app.post('/v1/auth/logout', async (req, reply) => {
  const token = req.body?.refreshToken;
  if (!token) return reply.code(204).send();

  const rows = db.prepare('SELECT * FROM refresh_tokens WHERE revoked = 0').all();
  const record = rows.find((row) => bcrypt.compareSync(token, row.token_hash));
  if (record) db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(record.id);
  return reply.code(204).send();
});

app.post('/v1/auth/forgot-password', async () => ({ message: 'password reset email queued (stub)' }));
app.post('/v1/auth/verify-email', async () => ({ message: 'email verified (stub)' }));

app.get('/v1/auth/me', { preHandler: [app.authenticate || ((req, r, done) => done())] }, async (req, reply) => {
  try {
    const decoded = await req.jwtVerify();
    const user = db.prepare('SELECT id, email, email_verified, disabled FROM users WHERE id = ?').get(decoded.sub);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    return { id: user.id, email: user.email, emailVerified: Boolean(user.email_verified), disabled: Boolean(user.disabled) };
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
});

app.get('/v1/admin/users', async () => db.prepare('SELECT id, email, email_verified, disabled, created_at FROM users').all());
app.patch('/v1/admin/users/:id/disable', async (req) => {
  db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(req.params.id);
  return { ok: true };
});
app.patch('/v1/admin/users/:id/enable', async (req) => {
  db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(req.params.id);
  return { ok: true };
});
app.delete('/v1/admin/users/:id', async (req) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  return { ok: true };
});

app.get('/health', async () => ({ status: 'ok', service: 'auth' }));

const port = Number(process.env.PORT || 4001);
app.listen({ port, host: '0.0.0.0' });
