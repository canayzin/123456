class StoreInterface {
  read() { throw new Error('not_implemented'); }
  write() { throw new Error('not_implemented'); }
  list() { throw new Error('not_implemented'); }
  atomicWrite() { throw new Error('not_implemented'); }
}

module.exports = { StoreInterface };
