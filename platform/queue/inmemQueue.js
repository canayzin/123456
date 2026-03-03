class InmemQueue {
  constructor() {
    this.q = [];
    this.inflight = new Map();
  }
  enqueue(job) { this.q.push({ ...job, attempts: job.attempts || 0, id: job.id || `${Date.now()}-${Math.random()}` }); }
  dequeue() {
    const job = this.q.shift();
    if (!job) return null;
    this.inflight.set(job.id, job);
    return job;
  }
  ack(id) { this.inflight.delete(id); }
  retry(id, err) {
    const job = this.inflight.get(id);
    if (!job) return;
    this.inflight.delete(id);
    this.q.push({ ...job, attempts: job.attempts + 1, lastError: err ? String(err.message || err) : '' });
  }
  size() { return this.q.length + this.inflight.size; }
}

module.exports = { InmemQueue };
