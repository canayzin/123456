const fs = require('fs');
const path = require('path');

/** Encode index tuple into deterministic sortable key string. */
function encodeKey(parts) {
  return JSON.stringify(parts);
}

/** Compare scalar values deterministically. */
function cmp(a, b) {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a > b ? 1 : -1;
}

/** File-backed postings engine for single/composite indexes. */
class IndexEngine {
  constructor(root = path.join(process.cwd(), 'data', 'index')) {
    this.root = root;
    fs.mkdirSync(this.root, { recursive: true });
    this.registry = new Map();
    this.suggestions = new Map();
  }

  /** Build postings file path using required naming format. */
  _file(projectId, collection, fields) {
    const dir = path.join(this.root, projectId, collection);
    fs.mkdirSync(dir, { recursive: true });
    if (fields.length === 1) return path.join(dir, `field__${fields[0].field}.ndjson`);
    const s = fields.map((f) => `${f.field}_${(f.direction || 'ASC').toUpperCase()}`).join('__');
    return path.join(dir, `cmp__${s}.ndjson`);
  }

  /** Normalize signature so engine supports both v1 and v2 callers. */
  _normalizeArgs(a, b, c) {
    if (Array.isArray(c)) return { projectId: a, collection: b, defs: c };
    if (Array.isArray(b)) return { projectId: 'default', collection: a, defs: b };
    const defs = this.listIndexes(a);
    return { projectId: 'default', collection: a, defs };
  }

  /** Load postings from NDJSON file. */
  _read(file) {
    try {
      const txt = fs.readFileSync(file, 'utf8').trim();
      if (!txt) return [];
      return txt.split('\n').map((x) => JSON.parse(x));
    } catch {
      return [];
    }
  }

  /** Write postings to NDJSON file. */
  _write(file, rows) {
    const payload = rows.map((x) => JSON.stringify(x)).join('\n');
    fs.writeFileSync(file, payload ? `${payload}\n` : '');
  }

  createIndex({ collection, fields, name }) {
    const indexName = name || `${collection}:${fields.map((f) => `${f.field}:${f.direction || 'ASC'}`).join('|')}`;
    this.registry.set(indexName, { name: indexName, collection, fields });
    return indexName;
  }

  listIndexes(collection) {
    return [...this.registry.values()].filter((x) => x.collection === collection);
  }

  suggestIndex(collection, query) {
    const key = `${collection}:${JSON.stringify({ where: query.where || [], orderBy: query.orderBy || [] })}`;
    const suggestion = {
      collection,
      fields: [
        ...(query.where || []).map((w) => ({ field: w.field, direction: 'ASC' })),
        ...(query.orderBy || []).map((o) => ({ field: o.field, direction: o.direction || 'ASC' }))
      ]
    };
    this.suggestions.set(key, suggestion);
    return suggestion;
  }

  /** Remove previous postings for a doc from all indexes in collection. */
  removeDoc(a, b, c, d) {
    const { projectId, collection, defs } = this._normalizeArgs(a, b, c);
    const docId = d || c;
    for (const def of defs) {
      const file = this._file(projectId, collection, def.fields);
      const rows = this._read(file).filter((x) => x.docId !== docId);
      this._write(file, rows);
    }
  }

  /** Upsert doc postings in all relevant indexes. */
  upsertDoc(a, b, c, d) {
    let projectId;
    let collection;
    let defs;
    let doc;

    if (d !== undefined) {
      ({ projectId, collection, defs } = this._normalizeArgs(a, b, c));
      doc = d;
    } else {
      projectId = 'default';
      collection = a;
      defs = this.listIndexes(a);
      doc = { _id: b, data: c };
    }

    for (const def of defs) {
      const file = this._file(projectId, collection, def.fields);
      const rows = this._read(file).filter((x) => x.docId !== doc._id);
      const tuple = def.fields.map((f) => doc.data[f.field]);
      rows.push({ key: encodeKey([...tuple, doc._id]), tuple, docId: doc._id, values: tuple });
      rows.sort((x, y) => {
        for (let i = 0; i < def.fields.length; i += 1) {
          const dir = (def.fields[i].direction || 'ASC').toUpperCase();
          const compared = cmp(x.tuple[i], y.tuple[i]);
          if (compared !== 0) return dir === 'DESC' ? -compared : compared;
        }
        return cmp(x.docId, y.docId);
      });
      this._write(file, rows);
    }
  }

  /** Read postings for given index definition. */
  postings(projectId, collection, def) {
    return this._read(this._file(projectId, collection, def.fields));
  }

  queryIndex(indexName) {
    const def = this.registry.get(indexName);
    if (!def) return [];
    return this._read(this._file('default', def.collection, def.fields));
  }
}

module.exports = { IndexEngine, encodeKey };
