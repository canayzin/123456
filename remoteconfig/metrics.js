function createMetrics() {
  return {
    remoteconfig_fetch_total: 0,
    remoteconfig_fetch_throttled_total: 0,
    remoteconfig_not_modified_total: 0,
    remoteconfig_publish_total: 0,
    remoteconfig_versions_total: 0,
    remoteconfig_rollbacks_total: 0,
    remoteconfig_eval_ms_p95: 0,
    remoteconfig_condition_compile_fail_total: 0
  };
}
module.exports = { createMetrics };
