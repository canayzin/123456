function createMetrics() {
  return {
    messaging_tokens_total: 0,
    messaging_topics_total: 0,
    messaging_sends_total: 0,
    messaging_fanout_total: 0,
    messaging_queue_depth: 0,
    messaging_due_total: 0,
    messaging_delivered_total: 0,
    messaging_failed_total: 0,
    messaging_retried_total: 0,
    messaging_expired_total: 0,
    messaging_dlq_total: 0,
    messaging_device_connections_active: 0,
    messaging_device_msgs_out_total: 0,
    messaging_device_acks_total: 0
  };
}
module.exports = { createMetrics };
