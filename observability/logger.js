const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel() { return LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info; }
function fmtPretty(entry) { return `[${entry.level}] ${entry.msg} requestId=${entry.requestId || '-'} route=${entry.route || '-'} latencyMs=${entry.latencyMs ?? '-'}${entry.code ? ` code=${entry.code}` : ''}`; }

function log(level, msg, fields = {}) {
  if ((LEVELS[level] || 0) < currentLevel()) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...fields };
  const mode = process.env.LOG_FORMAT || 'json';
  if (mode === 'pretty') console.log(fmtPretty(entry));
  else console.log(JSON.stringify(entry));
}

module.exports = {
  debug: (msg, f) => log('debug', msg, f),
  info: (msg, f) => log('info', msg, f),
  warn: (msg, f) => log('warn', msg, f),
  error: (msg, f) => log('error', msg, f)
};
