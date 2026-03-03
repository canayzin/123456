const fs = require('fs');

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function loadConfig() {
  const defaults = {
    port: Number(process.env.PORT || 8080),
    cluster: { enabled: process.env.CLUSTER === '1', workers: Number(process.env.CLUSTER_WORKERS || 0) },
    log: { level: process.env.LOG_LEVEL || 'info', format: process.env.LOG_FORMAT || 'json' },
    cors: { allowlist: String(process.env.CORS_ALLOWLIST || '').split(',').map((x) => x.trim()).filter(Boolean) },
    limits: { bodyBytes: Number(process.env.BODY_LIMIT_BYTES || 1024 * 1024) },
    readiness: { diskWriteTest: process.env.READYZ_DISK_TEST !== '0' },
    adapter: { store: process.env.STORE_ADAPTER || 'file' }
  };
  const p = process.env.NOVACLOUD_CONFIG || '';
  let fileCfg = {};
  if (p && fs.existsSync(p)) {
    try { fileCfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return deepMerge(defaults, fileCfg);
}

module.exports = { loadConfig };
