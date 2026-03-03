const fs = require('fs');
const path = require('path');
const { dayKey, hourKey } = require('./partitions');
const { hashId } = require('./uniques');
const { buildMonthCohort } = require('./cohorts');

class AnalyticsAggregator {
  constructor({ store, checkpoints, metrics, cohortsState }) {
    this.store = store;
    this.checkpoints = checkpoints;
    this.metrics = metrics;
    this.cohortsState = cohortsState;
    this.cache = {};
  }

  ensureDay(projectId, day) {
    const key = `${projectId}:${day}`;
    if (!this.cache[key]) this.cache[key] = { eventsTotal: 0, eventsByName: {}, userSet: new Set(), deviceSet: new Set(), countries: {}, platforms: {}, hours: {}, topParams: {} };
    return this.cache[key];
  }

  apply(projectId, row) {
    const day = dayKey(row.ts);
    const hour = hourKey(row.ts);
    const st = this.ensureDay(projectId, day);
    st.eventsTotal += 1;
    st.eventsByName[row.name] = (st.eventsByName[row.name] || 0) + 1;
    st.countries[row.country || ''] = (st.countries[row.country || ''] || 0) + 1;
    st.platforms[row.platform || ''] = (st.platforms[row.platform || ''] || 0) + 1;
    if (row.uid) st.userSet.add(hashId(`u:${row.uid}`));
    if (row.deviceId) st.deviceSet.add(hashId(`d:${row.deviceId}`));
    st.hours[hour] = st.hours[hour] || { eventsTotal: 0, userSet: new Set() };
    st.hours[hour].eventsTotal += 1;
    if (row.uid) st.hours[hour].userSet.add(hashId(`u:${row.uid}`));
    const params = row.params || {};
    for (const [k, v] of Object.entries(params)) {
      const kk = `${row.name}.${k}`;
      st.topParams[kk] = st.topParams[kk] || {};
      const sv = String(v).slice(0, 32);
      st.topParams[kk][sv] = (st.topParams[kk][sv] || 0) + 1;
    }
    const cs = this.cohortsState.get(projectId);
    if (row.uid) {
      const u = cs.users[row.uid] || { firstSeen: day, days: {} };
      if (day < u.firstSeen) u.firstSeen = day;
      u.days[day] = 1;
      cs.users[row.uid] = u;
      this.metrics.analytics_cohort_updates_total += 1;
    }
  }

  flushProject(projectId) {
    for (const [key, st] of Object.entries(this.cache)) {
      if (!key.startsWith(`${projectId}:`)) continue;
      const day = key.split(':')[1];
      const dailyDir = path.join(process.cwd(), 'data', 'analytics', 'agg', projectId, 'daily');
      const hourlyDir = path.join(process.cwd(), 'data', 'analytics', 'agg', projectId, 'hourly');
      fs.mkdirSync(dailyDir, { recursive: true });
      fs.mkdirSync(hourlyDir, { recursive: true });
      const daily = { date: day, eventsTotal: st.eventsTotal, eventsByName: st.eventsByName, uniqueUsers: st.userSet.size, uniqueDevices: st.deviceSet.size, topParams: st.topParams, countries: st.countries, platforms: st.platforms };
      fs.writeFileSync(path.join(dailyDir, `${day}.json`), JSON.stringify(daily, null, 2));
      this.metrics.analytics_daily_flush_total += 1;
      const hours = {};
      for (const [h, x] of Object.entries(st.hours)) hours[h] = { eventsTotal: x.eventsTotal, uniqueUsers: x.userSet.size };
      fs.writeFileSync(path.join(hourlyDir, `${day}.json`), JSON.stringify({ date: day, hours }, null, 2));
      this.metrics.analytics_hourly_flush_total += 1;
      const month = day.slice(0, 7);
      const cohortDir = path.join(process.cwd(), 'data', 'analytics', 'agg', projectId, 'cohorts');
      fs.mkdirSync(cohortDir, { recursive: true });
      const cohorts = buildMonthCohort(this.cohortsState.get(projectId), month);
      fs.writeFileSync(path.join(cohortDir, `${month}.json`), JSON.stringify({ month, cohorts }, null, 2));
    }
    this.cohortsState.save(projectId);
  }

  run(projectId) {
    const cp = this.checkpoints.get(projectId);
    let processed = 0;
    const files = this.store.listEventFiles(projectId);
    for (const file of files) {
      const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const offset = Number(cp.files[file] || 0);
      if (raw.length <= offset) continue;
      const chunk = raw.slice(offset);
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          this.apply(projectId, JSON.parse(line));
          processed += 1;
        } catch {}
      }
      cp.files[file] = raw.length;
    }
    this.checkpoints.save(projectId, cp);
    this.flushProject(projectId);
    this.metrics.analytics_agg_runs_total += 1;
    this.metrics.analytics_agg_events_processed_total += processed;
    return { processed };
  }
}

module.exports = { AnalyticsAggregator };
