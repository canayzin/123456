const crypto = require('crypto');
const { verify } = require('./token');
const { appCheckError } = require('./errors');

function deriveDebugSecret(projectId, appId) { return crypto.createHash('sha256').update(`${projectId}:${appId}:debug`).digest('hex'); }

function verifyAppCheckToken({ token, projectId, appId, app, keys, replay }) {
  const secret = app.provider === 'debug' ? deriveDebugSecret(projectId, appId) : (keys.customSecrets[appId] || '');
  if (!secret) throw appCheckError('PERMISSION_DENIED', 'APP_CHECK_INVALID');
  const out = verify(token, secret);
  if (!out.ok) throw appCheckError('PERMISSION_DENIED', 'APP_CHECK_INVALID', { reason: out.code });
  const c = out.payload;
  const now = Math.floor(Date.now() / 1000);
  if (c.tokenType !== 'appcheck' || c.projectId !== projectId || c.sub !== appId) throw appCheckError('PERMISSION_DENIED', 'APP_CHECK_INVALID');
  if (Number(c.exp || 0) < now || Number(c.iat || 0) > now + 60) throw appCheckError('PERMISSION_DENIED', 'APP_CHECK_EXPIRED');
  if (replay.seen(projectId, c.jti)) throw appCheckError('PERMISSION_DENIED', 'APP_CHECK_REPLAY');
  replay.add(projectId, c.jti, Date.now());
  return c;
}

module.exports = { verifyAppCheckToken, deriveDebugSecret };
