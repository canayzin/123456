class SlidingCounter {
  constructor(windowSec = 60) { this.windowSec = windowSec; this.map = new Map(); }
  add(key, by = 1, now = Date.now()) {
    const sec = Math.floor(now / 1000);
    const row = this.map.get(key) || [];
    row.push([sec, by]);
    const min = sec - this.windowSec;
    while (row.length && row[0][0] <= min) row.shift();
    this.map.set(key, row);
    return row.reduce((a, x) => a + x[1], 0);
  }
  sum(key, now = Date.now()) {
    const sec = Math.floor(now / 1000);
    const row = this.map.get(key) || [];
    const min = sec - this.windowSec;
    while (row.length && row[0][0] <= min) row.shift();
    this.map.set(key, row);
    return row.reduce((a, x) => a + x[1], 0);
  }
}
module.exports = { SlidingCounter };
