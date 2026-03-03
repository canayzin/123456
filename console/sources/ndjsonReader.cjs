const fs = require('fs');

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((x) => x.trim()).map((x) => {
    try { return JSON.parse(x); } catch { return null; }
  }).filter(Boolean);
}

module.exports = { readNdjson };
