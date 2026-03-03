const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hostingError } = require('./errors');

function safeRel(p) {
  const rel = `/${String(p || '').replace(/^\/+/, '')}`;
  if (rel.includes('..')) throw hostingError('INVALID_ARGUMENT', 'Invalid path');
  return rel;
}

function contentTypeFor(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const buf = fs.readFileSync(file);
  h.update(buf);
  return h.digest('hex');
}

function etagFromHash(hash) { return `"${hash}"`; }

function writeManifest(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

module.exports = { safeRel, contentTypeFor, sha256File, etagFromHash, writeManifest };
