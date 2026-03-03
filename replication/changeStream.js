const { EventEmitter } = require('events');

class ChangeStream {
  constructor() { this.ee = new EventEmitter(); }
  publish(projectId, event) { this.ee.emit(`project:${projectId}`, event); }
  subscribeChangeStream(projectId, fromVersion = 0, onEvent = () => {}) {
    const fn = (event) => {
      if (Number(event.version || 0) >= Number(fromVersion || 0)) onEvent(event);
    };
    this.ee.on(`project:${projectId}`, fn);
    return () => this.ee.off(`project:${projectId}`, fn);
  }
}

module.exports = { ChangeStream };
