const fs = require('fs');
const path = require('path');

function dateRange(from, to) {
  const out = []; let d = new Date(`${from}T00:00:00.000Z`); const e = new Date(`${to}T00:00:00.000Z`);
  while (d <= e) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

function analyticsEventsSeries(projectId, from, to) {
  const days = dateRange(from, to);
  const series = days.map((d) => {
    const f = path.join(process.cwd(), 'data', 'analytics', 'agg', projectId, 'daily', `${d}.json`);
    let row = { eventsTotal: 0, uniqueUsers: 0 }; try { row = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    return { ts: d, eventsTotal: Number(row.eventsTotal || 0), uniqueUsers: Number(row.uniqueUsers || 0) };
  });
  return { series };
}

function flatZeroSeries(from, to, keys) {
  return { series: dateRange(from, to).map((d) => ({ ts: d, ...Object.fromEntries(keys.map((k) => [k, 0])) })) };
}

module.exports = { analyticsEventsSeries, flatZeroSeries };
