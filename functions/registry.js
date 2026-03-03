const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'data', 'functions');

function fileFor(projectId) {
  fs.mkdirSync(ROOT, { recursive: true });
  return path.join(ROOT, `${projectId}.json`);
}

function readState(projectId) {
  try { return JSON.parse(fs.readFileSync(fileFor(projectId), 'utf8')); } catch { return { functions: [] }; }
}

function writeState(projectId, state) {
  fs.writeFileSync(fileFor(projectId), JSON.stringify(state, null, 2));
}

class FunctionsRegistry {
  deploy(projectId, metadata) {
    const state = readState(projectId);
    const prev = state.functions.filter((f) => f.name === metadata.name);
    const version = prev.length ? Math.max(...prev.map((x) => x.version)) + 1 : 1;
    const next = { ...metadata, projectId, version, deployedAt: Date.now() };
    state.functions.push(next);
    writeState(projectId, state);
    return next;
  }

  latest(projectId, name) {
    const state = readState(projectId);
    return state.functions.filter((f) => f.name === name).sort((a, b) => b.version - a.version)[0] || null;
  }

  list(projectId) {
    return readState(projectId).functions;
  }
}

module.exports = { FunctionsRegistry };
