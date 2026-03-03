const fs = require('fs');
const path = require('path');

function rmSafe(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function swapRemoveDir(dir) {
  if (!fs.existsSync(dir)) return;
  const tmp = `${dir}.reset-${Date.now()}`;
  fs.renameSync(dir, tmp);
  fs.mkdirSync(dir, { recursive: true });
  rmSafe(tmp);
}

function resetProject(projectId) {
  const syncRoot = path.join(process.cwd(), 'data', 'sync');
  const objectRoot = path.join(process.cwd(), 'data', 'object_store');
  const storageMetaRoot = path.join(process.cwd(), 'data', 'storage');
  const usageRoot = path.join(process.cwd(), 'data', 'usage');
  const quotaRoot = path.join(process.cwd(), 'data', 'quota');
  const functionsRoot = path.join(process.cwd(), 'data', 'functions');
  const auditRoot = path.join(process.cwd(), 'data', 'audit');

  if (!projectId) {
    swapRemoveDir(syncRoot);
    swapRemoveDir(objectRoot);
    swapRemoveDir(storageMetaRoot);
    swapRemoveDir(usageRoot);
    swapRemoveDir(functionsRoot);
    swapRemoveDir(auditRoot);
    swapRemoveDir(path.join(quotaRoot, 'counters'));
    rmSafe(path.join(quotaRoot, 'default-project.json'));
    for (const f of ['docdb.json', 'users.json', 'refreshTokens.json', 'authLockouts.json', 'audit.log']) {
      rmSafe(path.join(process.cwd(), 'data', f));
    }
    if (fs.existsSync(quotaRoot)) {
      for (const f of fs.readdirSync(quotaRoot)) {
        if (f.endsWith('.json')) rmSafe(path.join(quotaRoot, f));
      }
    }
    return;
  }


  const docdbFile = path.join(process.cwd(), 'data', 'docdb.json');
  if (fs.existsSync(docdbFile)) {
    try {
      const db = JSON.parse(fs.readFileSync(docdbFile, 'utf8'));
      for (const collection of Object.keys(db.collections || {})) {
        const docs = db.collections[collection] || {};
        for (const docId of Object.keys(docs)) {
          if (docs[docId] && docs[docId]._projectId === projectId) delete docs[docId];
        }
      }
      const tmp = `${docdbFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, docdbFile);
    } catch {}
  }

  rmSafe(path.join(syncRoot, 'ops', `${projectId}.ndjson`));
  rmSafe(path.join(syncRoot, 'clocks', `${projectId}.json`));
  rmSafe(path.join(syncRoot, 'state', projectId));
  rmSafe(path.join(objectRoot, projectId));
  rmSafe(path.join(storageMetaRoot, projectId));
  rmSafe(path.join(usageRoot, `${projectId}.ndjson`));
  rmSafe(path.join(quotaRoot, `${projectId}.json`));
  rmSafe(path.join(quotaRoot, 'counters', `${projectId}.json`));
  rmSafe(path.join(functionsRoot, `${projectId}.json`));
  rmSafe(path.join(auditRoot, `${projectId}.log`));
}

module.exports = { resetProject };
