function backoffMs(attempt) {
  const base = 1000;
  return Math.min(60000, base * (2 ** Math.max(0, attempt - 1)));
}
module.exports = { backoffMs };
