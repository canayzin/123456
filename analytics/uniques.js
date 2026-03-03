const crypto = require('crypto');

function hashId(value = '') {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}

function ensureSet(map, key) {
  if (!map[key]) map[key] = new Set();
  return map[key];
}

module.exports = { hashId, ensureSet };
