class QueueInterface {
  enqueue() { throw new Error('not_implemented'); }
  dequeue() { throw new Error('not_implemented'); }
  ack() { throw new Error('not_implemented'); }
  retry() { throw new Error('not_implemented'); }
}

module.exports = { QueueInterface };
