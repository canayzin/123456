class QueryRef {
  constructor(col, filters = [], order = null, lim = null) {
    this.col = col;
    this.filters = filters;
    this.order = order;
    this.lim = lim;
  }
  where(field, op, value) { return new QueryRef(this.col, this.filters.concat([{ field, op, value }]), this.order, this.lim); }
  orderBy(field, direction = 'asc') { return new QueryRef(this.col, this.filters, { field, direction }, this.lim); }
  limit(n) { return new QueryRef(this.col, this.filters, this.order, Number(n)); }
  async get() {
    let rows = Array.from(this.col._docs.values()).filter((x) => x && x.__col === this.col.name).map((x) => ({ ...x }));
    for (const f of this.filters) {
      rows = rows.filter((r) => {
        if (f.op === '==') return r[f.field] === f.value;
        if (f.op === '>=') return r[f.field] >= f.value;
        if (f.op === '<=') return r[f.field] <= f.value;
        return false;
      });
    }
    if (this.order) rows.sort((a, b) => (a[this.order.field] > b[this.order.field] ? 1 : -1) * (this.order.direction === 'desc' ? -1 : 1));
    if (Number.isFinite(this.lim) && this.lim >= 0) rows = rows.slice(0, this.lim);
    return { docs: rows };
  }
}

module.exports = { QueryRef };
