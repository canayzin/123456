const { EventEmitter } = require('events');

class LeaderElector {
  constructor({ nodeId = 'node-1', leaderId = 'node-1' } = {}) {
    this.nodeId = nodeId;
    this.leaderId = leaderId;
    this.ee = new EventEmitter();
  }
  isLeader() { return this.nodeId === this.leaderId; }
  setLeader(leaderId) {
    this.leaderId = leaderId;
    this.ee.emit('change', this.isLeader());
  }
  onChange(cb) { this.ee.on('change', cb); return () => this.ee.off('change', cb); }
}

module.exports = { LeaderElector };
