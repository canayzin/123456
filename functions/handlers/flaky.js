let count = 0;
async function flaky() {
  count += 1;
  if (count < 3) throw new Error('flaky_fail');
  return { ok: true, attempts: count };
}
function reset() { count = 0; }
module.exports = { flaky, reset };
