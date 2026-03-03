class WorkerRuntime {
  constructor({ poller, queueRunner, elector, metrics, intervalMs = 50, leaderJob = null, afterTick = null }) {
    this.poller = poller;
    this.queueRunner = queueRunner;
    this.elector = elector;
    this.metrics = metrics;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.leaderJob = leaderJob;
    this.afterTick = afterTick;
  }

  async tick() {
    await this.poller.runOnce();
    await this.queueRunner.runOnce();
    if (this.elector.isLeader() && this.leaderJob) {
      await this.leaderJob();
      this.metrics.leaderState = 'leader';
    } else {
      this.metrics.leaderState = 'follower';
    }
    if (this.afterTick) await this.afterTick();
    this.metrics.queueLag = this.queueRunner.queue.size();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { WorkerRuntime };
