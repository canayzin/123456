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
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  consumed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  consumed INTEGER DEFAULT 0,
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

app.decorate('authenticate', async (req, reply) => {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
});

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

function persistOpaqueToken(table, userId) {
  const raw = nanoid(48);
  const hash = bcrypt.hashSync(raw, 10);
  db.prepare(`INSERT INTO ${table} (id, user_id, token_hash, created_at) VALUES (?, ?, ?, ?)`)
    .run(nanoid(), userId, hash, new Date().toISOString());
  return raw;
}

function rotateRefreshToken(userId) {
  return persistOpaqueToken('refresh_tokens', userId);
}

function findValidOpaqueToken(table, raw) {
  const rows = db.prepare(`SELECT * FROM ${table} WHERE consumed = 0 OR revoked = 0`).all();
  return rows.find((row) => bcrypt.compareSync(raw, row.token_hash));
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

  createAudit('signup', id, req.ip);
  const verifyToken = persistOpaqueToken('email_verifications', id);
  return reply.code(201).send({
    user: { id, email, emailVerified: false },
    accessToken: createAccessToken({ id, email }),
    refreshToken: rotateRefreshToken(id),
    verificationToken: verifyToken
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
    refreshToken: rotateRefreshToken(user.id)
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
    refreshToken: rotateRefreshToken(user.id)
  };
});

app.post('/v1/auth/logout', async (req, reply) => {
  const token = req.body?.refreshToken;
  if (!token) return reply.code(204).send();

  const rows = db.prepare('SELECT * FROM refresh_tokens WHERE revoked = 0').all();
  const record = rows.find((row) => bcrypt.compareSync(token, row.token_hash));
  if (record) db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(record.id);
  createAudit('logout', record?.user_id, req.ip);
  return reply.code(204).send();
});

app.post('/v1/auth/forgot-password', async (req, reply) => {
  const email = req.body?.email;
  if (!email) return reply.code(400).send({ error: 'invalid_payload' });

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return { message: 'reset_requested' };

  const resetToken = persistOpaqueToken('password_resets', user.id);
  createAudit('forgot_password', user.id, req.ip);
  return { message: 'reset_requested', resetToken };
});

app.post('/v1/auth/verify-email', async (req, reply) => {
  const token = req.body?.verificationToken;
  if (!token) return reply.code(400).send({ error: 'invalid_payload' });

  const rows = db.prepare('SELECT * FROM email_verifications WHERE consumed = 0').all();
  const record = rows.find((row) => bcrypt.compareSync(token, row.token_hash));
  if (!record) return reply.code(401).send({ error: 'invalid_verification_token' });

  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(record.user_id);
  db.prepare('UPDATE email_verifications SET consumed = 1 WHERE id = ?').run(record.id);
  createAudit('email_verified', record.user_id, req.ip);
  return { message: 'email_verified' };
});

app.get('/v1/auth/me', { preHandler: [app.authenticate] }, async (req, reply) => {
  const user = db.prepare('SELECT id, email, email_verified, disabled FROM users WHERE id = ?').get(req.user.sub);
  if (!user) return reply.code(404).send({ error: 'user_not_found' });
  return { id: user.id, email: user.email, emailVerified: Boolean(user.email_verified), disabled: Boolean(user.disabled) };
});

app.get('/v1/admin/users', async () => db.prepare('SELECT id, email, email_verified, disabled, created_at FROM users').all());
app.patch('/v1/admin/users/:id/disable', async (req) => {
  db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(req.params.id);
  createAudit('admin_disable_user', req.params.id, req.ip);
  return { ok: true };
});
app.patch('/v1/admin/users/:id/enable', async (req) => {
  db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(req.params.id);
  createAudit('admin_enable_user', req.params.id, req.ip);
  return { ok: true };
});
app.delete('/v1/admin/users/:id', async (req) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  createAudit('admin_delete_user', req.params.id, req.ip);
  return { ok: true };
});

app.get('/health', async () => ({ status: 'ok', service: 'auth' }));

const port = Number(process.env.PORT || 4001);
app.listen({ port, host: '0.0.0.0' });
