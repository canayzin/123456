const fs = require('fs');
const path = require('path');

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

class CohortsState {
  constructor() {
    this.cache = {};
  }
  file(projectId) {
    const dir = path.join(process.cwd(), 'data', 'analytics', 'state', projectId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'uids.json');
  }
  get(projectId) {
    if (this.cache[projectId]) return this.cache[projectId];
    try { this.cache[projectId] = JSON.parse(fs.readFileSync(this.file(projectId), 'utf8')); } catch { this.cache[projectId] = { users: {} }; }
    return this.cache[projectId];
  }
  save(projectId) {
    fs.writeFileSync(this.file(projectId), JSON.stringify(this.get(projectId), null, 2));
  }
}

function buildMonthCohort(state, month) {
  const out = {};
  for (const [uid, row] of Object.entries(state.users || {})) {
    if (!String(row.firstSeen || '').startsWith(`${month}-`)) continue;
    const cohortDay = row.firstSeen;
    const b = out[cohortDay] || { users: 0, D1: 0, D7: 0, D30: 0 };
    b.users += 1;
    if ((row.days || {})[addDays(cohortDay, 1)]) b.D1 += 1;
    if ((row.days || {})[addDays(cohortDay, 7)]) b.D7 += 1;
    if ((row.days || {})[addDays(cohortDay, 30)]) b.D30 += 1;
    out[cohortDay] = b;
  }
  return out;
}

module.exports = { CohortsState, buildMonthCohort };
