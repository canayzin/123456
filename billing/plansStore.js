const fs = require('fs');
const path = require('path');

const DEFAULT_PLANS = {
  free: {
    pricePerMonth: 0,
    included: {
      'docdb.readsPerMonth': 50000,
      'docdb.writesPerMonth': 20000,
      'storage.gbMonth': 5,
      'functions.invocationsPerMonth': 100000
    },
    overage: {
      'docdb.readsPerMonth': 0,
      'docdb.writesPerMonth': 0,
      'storage.gbMonth': 0,
      'functions.invocationsPerMonth': 0
    },
    hardCaps: {
      'docdb.readsPerMonth': 50000,
      'docdb.writesPerMonth': 20000,
      'storage.bytesWritePerMonth': 5 * 1024 * 1024 * 1024,
      'storage.bytesReadPerMonth': 5 * 1024 * 1024 * 1024,
      'functions.invocationsPerMonth': 100000,
      'sync.opsPerMonth': 100000
    }
  },
  pro: {
    pricePerMonth: 2900,
    included: {
      'docdb.readsPerMonth': 200000,
      'docdb.writesPerMonth': 100000,
      'storage.gbMonth': 50,
      'functions.invocationsPerMonth': 2000000
    },
    overage: {
      'docdb.readsPerMonth': 1,
      'docdb.writesPerMonth': 2,
      'storage.gbMonth': 100,
      'functions.invocationsPerMonth': 0.02
    }
  },
  enterprise: {
    pricePerMonth: 19900,
    included: {
      'docdb.readsPerMonth': 10000000,
      'docdb.writesPerMonth': 5000000,
      'storage.gbMonth': 1000,
      'functions.invocationsPerMonth': 100000000
    },
    overage: {
      'docdb.readsPerMonth': 0,
      'docdb.writesPerMonth': 0,
      'storage.gbMonth': 0,
      'functions.invocationsPerMonth': 0
    }
  }
};

class PlansStore {
  constructor(file = path.join(process.cwd(), 'data', 'billing', 'plans.json')) { this.file = file; }
  getAll() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(DEFAULT_PLANS, null, 2));
      return DEFAULT_PLANS;
    }
  }
  get(plan) { return this.getAll()[plan] || this.getAll().free; }
}

module.exports = { PlansStore, DEFAULT_PLANS };
