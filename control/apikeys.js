const crypto = require('crypto');

function rand(n = 24) { return crypto.randomBytes(n).toString('hex'); }
function hashKey(k) { return crypto.createHash('sha256').update(String(k)).digest('hex'); }

function createKey(type = 'public') {
  const keyId = rand(8);
  const prefix = type === 'server' ? 'sk_live_' : 'pk_live_';
  const secret = `${prefix}${rand(16)}`;
  return { keyId, secret, hash: hashKey(secret), prefix };
}

module.exports = { createKey, hashKey };
