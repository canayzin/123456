const { parse } = require('./parser');
const { evalExpr } = require('./evaluator');
const { resolveBest } = require('./matcher');

function actionAliases(action) {
  if (action === 'create') return ['create', 'write'];
  if (action === 'update') return ['update', 'write'];
  if (action === 'delete') return ['delete', 'write'];
  if (action === 'read') return ['read'];
  return [action];
}

class RulesEngine {
  constructor(source = "rules_version = '1'; match /databases/{db}/documents { allow read, write; }") {
    this.ast = typeof source === 'string' ? parse(source) : source;
  }

  _decision(ctx, action, path, resource) {
    const matched = resolveBest(this.ast, path);
    if (!matched) return false;
    const allowedKinds = new Set(actionAliases(action));
    let granted = false;
    for (const allow of matched.allows) {
      if (!allow.actions.some((x) => allowedKinds.has(x))) continue;
      const scope = {
        request: ctx.request || {},
        resource: {
          data: resource?.data || null,
          oldData: resource?.oldData || null,
          path,
          ...matched.params
        },
        ...matched.params
      };
      if (evalExpr(allow.condition, scope)) {
        granted = true;
        break;
      }
    }
    return granted;
  }

  canRead(ctx, path, doc) {
    return this._decision(ctx, 'read', path, { data: doc, oldData: doc });
  }
  canCreate(ctx, path, newDoc) {
    return this._decision(ctx, 'create', path, { data: newDoc, oldData: null });
  }
  canUpdate(ctx, path, newDoc, oldDoc) {
    return this._decision(ctx, 'update', path, { data: newDoc, oldData: oldDoc });
  }
  canDelete(ctx, path, oldDoc) {
    return this._decision(ctx, 'delete', path, { data: null, oldData: oldDoc });
  }

  _permissionDenied(action, path) {
    const error = new Error('PERMISSION_DENIED');
    error.payload = { error: { code: 'PERMISSION_DENIED', message: `Rule denied ${action}`, details: { path, action } } };
    return error;
  }

  enforceCreate(ctx, path, newDoc) {
    if (!this.canCreate(ctx, path, newDoc)) throw this._permissionDenied('create', path);
  }
  enforceUpdate(ctx, path, newDoc, oldDoc) {
    if (!this.canUpdate(ctx, path, newDoc, oldDoc)) throw this._permissionDenied('update', path);
  }
  enforceDelete(ctx, path, oldDoc) {
    if (!this.canDelete(ctx, path, oldDoc)) throw this._permissionDenied('delete', path);
  }

  filterQueryResults(ctx, collectionPath, docs, options = {}) {
    const overfetchFactor = options.overfetchFactor || 3;
    const limit = options.limit || docs.length;
    const scanLimit = Math.min(docs.length, limit * overfetchFactor);
    const accepted = [];
    let filtered = 0;
    for (let i = 0; i < scanLimit; i += 1) {
      const doc = docs[i];
      const p = `${String(collectionPath).replace(/\/+$/, '')}/${doc.id || doc._id || ''}`;
      if (this.canRead(ctx, p, doc)) accepted.push(doc);
      else filtered += 1;
      if (accepted.length >= limit) break;
    }
    return { docs: accepted, ruleFilteredCount: filtered, scannedCount: scanLimit, overfetchFactor };
  }
}

module.exports = { RulesEngine };
