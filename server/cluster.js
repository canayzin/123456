const cluster = require('cluster');
const os = require('os');
const logger = require('../observability/logger');
const { loadConfig } = require('../config');

const cfg = loadConfig();
const workersWanted = cfg.cluster.workers || os.cpus().length;

if (cluster.isPrimary && cfg.cluster.enabled) {
  logger.info('cluster.master.start', { workersWanted });
  const lastRestart = new Map();
  function spawn() { const w = cluster.fork(); logger.info('cluster.worker.spawn', { workerId: w.id }); }
  for (let i = 0; i < workersWanted; i += 1) spawn();
  cluster.on('exit', (worker) => {
    const now = Date.now();
    const prev = lastRestart.get(worker.id) || 0;
    if (now - prev < 1000) return;
    lastRestart.set(worker.id, now);
    logger.warn('cluster.worker.exit', { workerId: worker.id });
    spawn();
  });
  process.on('SIGHUP', () => {
    const arr = Object.values(cluster.workers || {});
    let i = 0;
    const roll = () => {
      const w = arr[i++];
      if (!w) return;
      const nw = cluster.fork();
      nw.on('listening', () => { try { w.kill('SIGTERM'); } catch {} roll(); });
    };
    roll();
  });
  process.on('SIGTERM', () => { Object.values(cluster.workers || {}).forEach((w) => { try { w.kill('SIGTERM'); } catch {} }); process.exit(0); });
} else {
  const { app, cfg } = require('./index');
  app.listen(cfg.port, () => logger.info('cluster.worker.listen', { pid: process.pid, port: cfg.port }));
}
