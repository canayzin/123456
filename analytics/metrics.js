function createMetrics() {
  return {
    analytics_events_ingested_total: 0,
    analytics_batches_ingested_total: 0,
    analytics_invalid_total: 0,
    analytics_rejected_total: 0,
    analytics_agg_runs_total: 0,
    analytics_agg_events_processed_total: 0,
    analytics_daily_flush_total: 0,
    analytics_hourly_flush_total: 0,
    analytics_cohort_updates_total: 0,
    analytics_pii_rejected_total: 0
  };
}

module.exports = { createMetrics };
