import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const app = Fastify({ logger: { level: 'info' } });
const db = new Database(process.env.AUTH_DB_PATH || 'auth.db');
const accessTtl = '15m';
const metrics = { requestsTotal: 0, authFailuresTotal: 0 };

const err = (code, message, details = {}) => ({ error: { code, message, details } });

app.addHook('onRequest', async (req) => {
  metrics.requestsTotal += 1;
  req.requestId = req.headers['x-request-id'] || nanoid();
});
app.addHook('onSend', async (req, reply, payload) => {
  reply.header('x-request-id', req.requestId);
  return payload;
});

db.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,email_verified INTEGER DEFAULT 0,disabled INTEGER DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refresh_tokens (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,token_hash TEXT NOT NULL,revoked INTEGER DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS password_resets (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,token_hash TEXT NOT NULL,consumed INTEGER DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS email_verifications (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,token_hash TEXT NOT NULL,consumed INTEGER DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY,action TEXT NOT NULL,user_id TEXT,ip TEXT,created_at TEXT NOT NULL);
`);

await app.register(cors, { origin: true, credentials: true });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret' });

app.decorate('authenticate', async (req, reply) => {
  try {
    await req.jwtVerify();
  } catch {
    metrics.authFailuresTotal += 1;
    return reply.code(401).send(err('UNAUTHORIZED', 'Unauthorized'));
  }
});

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const emailSchema = z.object({ email: z.string().email() });

function createAudit(action, userId, ip) {
  db.prepare('INSERT INTO audit_logs (id, action, user_id, ip, created_at) VALUES (?, ?, ?, ?, ?)').run(nanoid(), action, userId ?? null, ip ?? null, new Date().toISOString());
}
function createAccessToken(user) {
  return app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: accessTtl });
}
function persistOpaqueToken(table, userId) {
  const raw = nanoid(48);
  const hash = bcrypt.hashSync(raw, 10);
  db.prepare(`INSERT INTO ${table} (id, user_id, token_hash, created_at) VALUES (?, ?, ?, ?)`).run(nanoid(), userId, hash, new Date().toISOString());
  return raw;
}

app.post('/v1/auth/signup', async (req, reply) => {
  const parse = credentialsSchema.safeParse(req.body);
  if (!parse.success) return reply.code(400).send(err('INVALID_PAYLOAD', 'Invalid signup payload', parse.error.flatten()));
  const { email, password } = parse.data;
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return reply.code(409).send(err('EMAIL_EXISTS', 'Email already exists'));
  const id = nanoid();
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, email, bcrypt.hashSync(password, 12), new Date().toISOString());
  createAudit('signup', id, req.ip);
  return reply.code(201).send({ user: { id, email, emailVerified: false }, accessToken: createAccessToken({ id, email }), refreshToken: persistOpaqueToken('refresh_tokens', id), verificationToken: persistOpaqueToken('email_verifications', id) });
});

app.post('/v1/auth/login', async (req, reply) => {
  const parse = credentialsSchema.safeParse(req.body);
  if (!parse.success) return reply.code(400).send(err('INVALID_PAYLOAD', 'Invalid login payload'));
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(parse.data.email);
  if (!user || !bcrypt.compareSync(parse.data.password, user.password_hash)) {
    metrics.authFailuresTotal += 1;
    createAudit('login_failed', user?.id, req.ip);
    return reply.code(401).send(err('INVALID_CREDENTIALS', 'Invalid credentials'));
  }
  if (user.disabled) return reply.code(403).send(err('USER_DISABLED', 'User disabled'));
  createAudit('login_success', user.id, req.ip);
  return { user: { id: user.id, email: user.email, emailVerified: Boolean(user.email_verified) }, accessToken: createAccessToken(user), refreshToken: persistOpaqueToken('refresh_tokens', user.id) };
});

app.post('/v1/auth/refresh', async (req, reply) => {
  const token = req.body?.refreshToken;
  if (!token) return reply.code(400).send(err('MISSING_REFRESH_TOKEN', 'Missing refresh token'));
  const record = db.prepare('SELECT * FROM refresh_tokens WHERE revoked = 0').all().find((row) => bcrypt.compareSync(token, row.token_hash));
  if (!record) return reply.code(401).send(err('INVALID_REFRESH_TOKEN', 'Invalid refresh token'));
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(record.id);
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(record.user_id);
  return { accessToken: createAccessToken(user), refreshToken: persistOpaqueToken('refresh_tokens', user.id) };
});

app.post('/v1/auth/logout', async (req, reply) => {
  const token = req.body?.refreshToken;
  if (!token) return reply.code(204).send();
  const record = db.prepare('SELECT * FROM refresh_tokens WHERE revoked = 0').all().find((row) => bcrypt.compareSync(token, row.token_hash));
  if (record) db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(record.id);
  createAudit('logout', record?.user_id, req.ip);
  return reply.code(204).send();
});

app.post('/v1/auth/forgot-password', async (req, reply) => {
  const parse = emailSchema.safeParse(req.body);
  if (!parse.success) return reply.code(400).send(err('INVALID_PAYLOAD', 'Invalid email payload'));
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(parse.data.email);
  if (!user) return { message: 'reset_requested' };
  createAudit('forgot_password', user.id, req.ip);
  return { message: 'reset_requested', resetToken: persistOpaqueToken('password_resets', user.id) };
});

app.post('/v1/auth/verify-email', async (req, reply) => {
  const token = req.body?.verificationToken;
  if (!token) return reply.code(400).send(err('INVALID_PAYLOAD', 'Missing verification token'));
  const record = db.prepare('SELECT * FROM email_verifications WHERE consumed = 0').all().find((row) => bcrypt.compareSync(token, row.token_hash));
  if (!record) return reply.code(401).send(err('INVALID_VERIFICATION_TOKEN', 'Invalid verification token'));
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(record.user_id);
  db.prepare('UPDATE email_verifications SET consumed = 1 WHERE id = ?').run(record.id);
  createAudit('email_verified', record.user_id, req.ip);
  return { message: 'email_verified' };
});

app.get('/v1/auth/me', { preHandler: [app.authenticate] }, async (req, reply) => {
  const user = db.prepare('SELECT id, email, email_verified, disabled FROM users WHERE id = ?').get(req.user.sub);
  if (!user) return reply.code(404).send(err('USER_NOT_FOUND', 'User not found'));
  return { id: user.id, email: user.email, emailVerified: Boolean(user.email_verified), disabled: Boolean(user.disabled) };
});
app.get('/v1/admin/users', async () => db.prepare('SELECT id, email, email_verified, disabled, created_at FROM users').all());
app.get('/metrics', async () => `requests_total ${metrics.requestsTotal}\nauth_failures_total ${metrics.authFailuresTotal}\n`);
app.get('/health', async () => ({ status: 'ok', service: 'auth' }));
app.get('/docs', async (_, reply) => reply.type('text/html').send(`<!doctype html><html><body><h1>Swagger UI</h1><div id="swagger"></div><script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" /><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger'})</script></body></html>`));
app.get('/openapi.json', async () => ({ openapi: '3.1.0', info: { title: 'NovaBase Auth API', version: '1.0.0' } }));

app.listen({ port: Number(process.env.PORT || 4001), host: '0.0.0.0' });
