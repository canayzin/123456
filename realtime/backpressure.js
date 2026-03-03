class BackpressureQueue {
  constructor({ maxQueueLen = 256, maxQueueBytes = 2 * 1024 * 1024, policy = 'DISCONNECT_SLOW_CLIENT' } = {}) {
    this.maxQueueLen = maxQueueLen;
    this.maxQueueBytes = maxQueueBytes;
    this.policy = policy;
    this.items = [];
    this.bytes = 0;
  }

  enqueue(frame) {
    const len = frame.length;
    if (this.bytes + len <= this.maxQueueBytes && this.items.length < this.maxQueueLen) {
      this.items.push(frame);
      this.bytes += len;
      return { ok: true };
    }
    if (this.policy === 'DROP_OLDEST' && this.items.length) {
      let dropped = 0;
      while (this.items.length && (this.bytes + len > this.maxQueueBytes || this.items.length >= this.maxQueueLen)) {
        const x = this.items.shift();
        this.bytes -= x.length;
        dropped += 1;
      }
      this.items.push(frame);
      this.bytes += len;
      return { ok: true, dropped };
    }
    return { ok: false, reason: 'SLOW_CLIENT' };
  }

  drain(write) {
    while (this.items.length) {
      const frame = this.items.shift();
      this.bytes -= frame.length;
      const canWrite = write(frame);
      if (!canWrite) {
        this.items.unshift(frame);
        this.bytes += frame.length;
        break;
      }
    }
  }
}

module.exports = { BackpressureQueue };
