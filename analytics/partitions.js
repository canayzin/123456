function dayKey(ts = Date.now()) {
  return new Date(Number(ts)).toISOString().slice(0, 10);
}

function hourKey(ts = Date.now()) {
  return new Date(Number(ts)).toISOString().slice(11, 13);
}

module.exports = { dayKey, hourKey };
