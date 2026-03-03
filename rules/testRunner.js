const { RulesEngine } = require('./engine');

function runCases(source, cases) {
  const engine = new RulesEngine(source);
  return cases.map((c) => {
    if (c.type === 'read') return engine.canRead(c.ctx, c.path, c.doc);
    if (c.type === 'create') return engine.canCreate(c.ctx, c.path, c.newDoc);
    if (c.type === 'update') return engine.canUpdate(c.ctx, c.path, c.newDoc, c.oldDoc);
    if (c.type === 'delete') return engine.canDelete(c.ctx, c.path, c.oldDoc);
    return false;
  });
}

module.exports = { runCases };
