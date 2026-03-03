const fs = require('fs');
const path = require('path');
const { MemoryStore } = require('./stores/memory');
const { FileStore } = require('./stores/file');
const clock = require('./clock');
const { seedProject } = require('./seed');
const { resetProject } = require('./reset');
const { append } = require('../functions/logs');

function listProjectIds() {
  const ids = new Set();
  const roots = [
    path.join(process.cwd(), 'data', 'storage'),
    path.join(process.cwd(), 'data', 'object_store'),
    path.join(process.cwd(), 'data', 'quota'),
    path.join(process.cwd(), 'data', 'usage'),
    path.join(process.cwd(), 'data', 'audit')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      if (!name || name.startsWith('.')) continue;
      if (name.endsWith('.json') || name.endsWith('.ndjson') || name.endsWith('.log')) {
        ids.add(name.split('.')[0]);
        continue;
      }
      const full = path.join(root, name);
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) ids.add(name);
    }
  }
  ids.delete('counters');
  ids.delete('emulator');
  return Array.from(ids).sort();
}

class EmulatorController {
  constructor(services) {
    this.services = services;
    this.memory = new MemoryStore();
    this.file = new FileStore();
    this.mode = this.file.readMode() || 'file';
  }

  enabled() { return process.env.EMULATOR === '1'; }
  status() { return { enabled: this.enabled(), mode: this.mode, time: clock.now(), projects: listProjectIds() }; }

  setMode(mode) {
    this.mode = mode === 'memory' ? 'memory' : 'file';
    this.file.writeMode(this.mode);
    append({ projectId: 'global', type: 'emulator.mode', tag: 'emulator', mode: this.mode });
    return this.status();
  }

  async seed(payload) {
    await seedProject({ ...this.services, clock }, payload);
    append({ projectId: payload.projectId || 'global', type: 'emulator.seed', tag: 'emulator' });
    return { ok: true, projectId: payload.projectId || null };
  }

  reset(projectId) {
    resetProject(projectId);
    if (this.mode === 'memory') this.memory.reset(projectId);
    append({ projectId: projectId || 'global', type: 'emulator.reset', tag: 'emulator', scope: projectId ? 'project' : 'full' });
    return { ok: true, projectId: projectId || null };
  }
}

module.exports = { EmulatorController, clock };
