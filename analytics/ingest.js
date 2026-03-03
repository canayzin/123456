const { analyticsError } = require('./errors');

function readJsonWithLimit(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let s = '';
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(analyticsError('RESOURCE_EXHAUSTED', 'PAYLOAD_TOO_LARGE', { maxBytes }));
        req.destroy();
        return;
      }
      s += c;
    });
    req.on('end', () => {
      try {
        resolve({ body: s ? JSON.parse(s) : {}, bytes: total });
      } catch {
        reject(analyticsError('INVALID_JSON', 'Invalid JSON'));
      }
    });
    req.on('error', () => reject(analyticsError('REQUEST_ERROR', 'Request stream error')));
  });
}

module.exports = { readJsonWithLimit };
