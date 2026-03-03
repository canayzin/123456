function createMetrics() {
  return {
    appcheck_exchange_total: 0,
    appcheck_verify_total: 0,
    appcheck_denied_total: 0,
    appcheck_replay_total: 0,
    appcheck_missing_total: 0,
    appcheck_monitor_only_total: 0
  };
}
module.exports = { createMetrics };
