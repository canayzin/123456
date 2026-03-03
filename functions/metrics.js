class FunctionsMetrics {
  constructor() {
    this.invocations = 0;
    this.failures = 0;
    this.totalLatency = 0;
    this.coldStarts = 0;
    this.retries = 0;
  }
  snapshot() {
    return {
      functions_invocations_total: this.invocations,
      functions_invocations_failed_total: this.failures,
      functions_avg_latency_ms: this.invocations ? this.totalLatency / this.invocations : 0,
      functions_cold_starts_total: this.coldStarts,
      functions_retries_total: this.retries
    };
  }
}

module.exports = { FunctionsMetrics };
