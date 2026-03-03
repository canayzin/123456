let fixed = null;
let originalNow = null;

function now() {
  return fixed == null ? Date.now() : fixed;
}

function set(timeMs) {
  fixed = Number(timeMs);
  if (!originalNow) {
    originalNow = Date.now;
    Date.now = () => (fixed == null ? originalNow() : fixed);
  }
}

function tick(ms = 1) {
  if (fixed == null) set(Date.now());
  fixed += Number(ms);
  return fixed;
}

function reset() {
  fixed = null;
  if (originalNow) {
    Date.now = originalNow;
    originalNow = null;
  }
}

module.exports = { now, set, tick, reset };
