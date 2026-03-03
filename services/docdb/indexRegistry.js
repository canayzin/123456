const fs = require('fs');
const path = require('path');

/** Registry for project-scoped index definitions. */
class IndexRegistry {
  constructor(root = path.join(process.cwd(), 'data', 'indexes')) {
    this.root = root;
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** Build metadata file path for project. */
  _file(projectId) {
    return path.join(this.root, `${projectId}.json`);
  }

  /** Load index definitions. */
  _read(projectId) {
    try {
      return JSON.parse(fs.readFileSync(this._file(projectId), 'utf8'));
    } catch {
      return { indexes: [] };
    }
  }

  /** Persist definitions. */
  _write(projectId, state) {
    fs.writeFileSync(this._file(projectId), JSON.stringify(state, null, 2));
  }

  /** Register new index definition. */
  create(projectId, def) {
    const state = this._read(projectId);
    const name = def.name || `${def.collection}:${def.fields.map((f) => `${f.field}_${(f.direction || 'ASC').toUpperCase()}`).join('__')}`;
    const exists = state.indexes.find((x) => x.name === name);
    if (!exists) {
      state.indexes.push({ ...def, name });
      this._write(projectId, state);
    }
    return name;
  }

  /** List definitions by collection. */
  list(projectId, collection) {
    const state = this._read(projectId);
    return state.indexes.filter((x) => x.collection === collection);
  }
}

module.exports = { IndexRegistry };
