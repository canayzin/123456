const fs = require('fs');
const path = require('path');

function dates(from, to) {
  const out = [];
  let d = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

class AnalyticsDashboard {
  dailyFile(projectId, day) { return path.join(process.cwd(), 'data', 'analytics', 'agg', projectId, 'daily', `${day}.json`); }
  hourlyFile(projectId, day) { return path.join(process.cwd(), 'data', 'analytics', 'agg', projectId, 'hourly', `${day}.json`); }
  cohortFile(projectId, month) { return path.join(process.cwd(), 'data', 'analytics', 'agg', projectId, 'cohorts', `${month}.json`); }

  projectSummary(projectId, from, to) {
    const ds = dates(from, to);
    const eventsByName = {};
    const dau = [];
    const countries = {};
    const platforms = {};
    let eventsTotal = 0;
    for (const d of ds) {
      const row = readJson(this.dailyFile(projectId, d), { eventsTotal: 0, eventsByName: {}, uniqueUsers: 0, countries: {}, platforms: {} });
      eventsTotal += Number(row.eventsTotal || 0);
      for (const [k, v] of Object.entries(row.eventsByName || {})) eventsByName[k] = (eventsByName[k] || 0) + Number(v || 0);
      for (const [k, v] of Object.entries(row.countries || {})) countries[k] = (countries[k] || 0) + Number(v || 0);
      for (const [k, v] of Object.entries(row.platforms || {})) platforms[k] = (platforms[k] || 0) + Number(v || 0);
      dau.push({ date: d, uniqueUsers: Number(row.uniqueUsers || 0) });
    }
    const topEvents = Object.entries(eventsByName).sort((a, b) => b[1] - a[1]).slice(0, 10).reduce((a, [k, v]) => (a[k] = v, a), {});
    const last30 = dau.slice(-30);
    const mau = last30.reduce((m, x) => Math.max(m, Number(x.uniqueUsers || 0)), 0);
    const funnel = {
      screen_view: Number(eventsByName.screen_view || 0),
      add_to_cart: Number(eventsByName.add_to_cart || 0),
      purchase: Number(eventsByName.purchase || 0)
    };
    return { from, to, eventsTotal, eventsByName: topEvents, dau, mau, countries, platforms, funnel };
  }

  projectHourly(projectId, date) { return readJson(this.hourlyFile(projectId, date), { date, hours: {} }); }
  projectCohorts(projectId, month) { return readJson(this.cohortFile(projectId, month), { month, cohorts: {} }); }
}

module.exports = { AnalyticsDashboard };
