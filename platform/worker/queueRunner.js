class QueueRunner {
  constructor({ queue }) { this.queue = queue; }
  async runOnce() {
    const job = this.queue.dequeue();
    if (!job) return 0;
    try {
      await job.handler(job.payload || {});
      this.queue.ack(job.id);
    } catch (e) {
      if (job.attempts >= (job.maxRetries || 2)) this.queue.ack(job.id);
      else this.queue.retry(job.id, e);
    }
    return 1;
  }
}

module.exports = { QueueRunner };
