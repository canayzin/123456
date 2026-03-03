const { hashKey } = require('./apikeys');

function resolveApiKey(projectsStore, providedKey) {
  if (!providedKey) return null;
  const dirRows = projectsStore.listByOrg ? null : null;
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(process.cwd(), 'data', 'control', 'projects');
  if (!fs.existsSync(dir)) return null;
  const h = hashKey(providedKey);
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const k of (p.apiKeys || [])) {
      if (k.keyHash === h) return { project: p, key: k };
    }
  }
  return null;
}

module.exports = { resolveApiKey };
