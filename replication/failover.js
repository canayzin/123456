class FailoverController {
  constructor({ elector, metrics }) {
    this.elector = elector;
    this.metrics = metrics;
    this.primaryNodeId = elector.leaderId;
  }
  failover(nextLeaderId) {
    this.primaryNodeId = nextLeaderId || (this.primaryNodeId === 'node-1' ? 'node-2' : 'node-1');
    this.elector.setLeader(this.primaryNodeId);
    this.metrics.failover_count = (this.metrics.failover_count || 0) + 1;
    return { primaryNodeId: this.primaryNodeId, failoverCount: this.metrics.failover_count };
  }
}

module.exports = { FailoverController };
