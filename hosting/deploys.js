const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeConfig } = require('./config');
const { hostingError } = require('./errors');

function deployFile(deployId) {
  const dir = path.join(process.cwd(), 'data', 'hosting', 'deploys');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${deployId}.json`);
}

function createDeploy({ projectId, siteId, actor, message = '', config = {} }) {
  const releaseId = `rel_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const deployId = `dep_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const cfg = normalizeConfig(config);
  const configHash = crypto.createHash('sha256').update(JSON.stringify(cfg)).digest('hex');
  const row = { deployId, releaseId, projectId, siteId, actor, message, createdAt: Date.now(), config: cfg, configHash, files: {}, bytesTotal: 0, finalized: false };
  fs.writeFileSync(deployFile(deployId), JSON.stringify(row, null, 2));
  return row;
}

function getDeploy(deployId) {
  try { return JSON.parse(fs.readFileSync(deployFile(deployId), 'utf8')); }
  catch { throw hostingError('NOT_FOUND', 'Deploy not found'); }
}

function saveDeploy(deploy) {
  fs.writeFileSync(deployFile(deploy.deployId), JSON.stringify(deploy, null, 2));
}

module.exports = { createDeploy, getDeploy, saveDeploy };
