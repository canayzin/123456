const fs = require('fs');
const path = require('path');
const { append } = require('./logs');

function validate(meta) {
  if (!meta.name) throw new Error('INVALID_NAME');
  if (!meta.entryPath) throw new Error('INVALID_ENTRY');
  const full = path.join(process.cwd(), meta.entryPath);
  if (!fs.existsSync(full)) throw new Error('ENTRY_NOT_FOUND');
}

function deploy(registry, projectId, meta) {
  validate(meta);
  const deployed = registry.deploy(projectId, {
    timeoutMs: meta.timeoutMs || 5000,
    memoryMb: meta.memoryMb || 128,
    triggerType: meta.triggerType || 'http',
    retryPolicy: meta.retryPolicy || { mode: 'at_most_once', maxAttempts: 1, baseDelayMs: 50 },
    envRefs: meta.envRefs || [],
    admin: Boolean(meta.admin),
    ...meta
  });
  append({ projectId, type: 'functions.deploy', functionName: deployed.name, version: deployed.version });
  return deployed;
}

module.exports = { deploy };
