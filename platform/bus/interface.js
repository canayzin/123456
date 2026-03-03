class BusInterface {
  publish() { throw new Error('not_implemented'); }
  subscribe() { throw new Error('not_implemented'); }
}

module.exports = { BusInterface };
