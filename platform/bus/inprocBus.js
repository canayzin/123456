const { EventEmitter } = require('events');

class InprocBus {
  constructor() { this.ee = new EventEmitter(); }
  publish(topic, message) { this.ee.emit(topic, message); }
  subscribe(topic, cb) { this.ee.on(topic, cb); return () => this.ee.off(topic, cb); }
}

module.exports = { InprocBus };
