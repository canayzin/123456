const { lex } = require('./dsl/lexer');
const { parse } = require('./dsl/parser');
const { rcError } = require('./errors');

function assertSafe(ast) {
  if (!ast || typeof ast !== 'object') return;
  if (ast.type === 'Call' && ast.name !== 'percent') throw new Error('Unsupported function');
  if (ast.type === 'Call' && ast.args && ast.args.length !== 2) throw new Error('percent requires 2 args');
  if (ast.type === 'Binary' && !['==','!=','<','>','<=','>=','&&','||'].includes(ast.op)) throw new Error('Unsupported operator');
  if (ast.type === 'Unary' && ast.op !== '!') throw new Error('Unsupported unary');
  for (const v of Object.values(ast)) if (v && typeof v === 'object') {
    if (Array.isArray(v)) v.forEach(assertSafe); else if (v.type) assertSafe(v);
  }
}

function compileExpression(expr) {
  try { const ast = parse(lex(expr)); assertSafe(ast); return ast; }
  catch (e) { throw rcError('INVALID_ARGUMENT', `Invalid condition expression: ${e.message}`); }
}

function validateTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') throw rcError('INVALID_ARGUMENT', 'Invalid template');
  const parameters = tpl.parameters || {};
  const conditions = Array.isArray(tpl.conditions) ? tpl.conditions : [];
  for (const [k, v] of Object.entries(parameters)) {
    if (!v.defaultValue || typeof v.defaultValue.value !== 'string') throw rcError('INVALID_ARGUMENT', `Invalid defaultValue for ${k}`);
    if (v.conditionalValues && typeof v.conditionalValues !== 'object') throw rcError('INVALID_ARGUMENT', `Invalid conditionalValues for ${k}`);
  }
  const compiled = {};
  for (const c of conditions) {
    if (!c.name || !c.expression) throw rcError('INVALID_ARGUMENT', 'Invalid condition');
    compiled[c.name] = compileExpression(c.expression);
  }
  return { parameters, conditions, minimumFetchIntervalSeconds: Number(tpl.minimumFetchIntervalSeconds || 3600), compiled };
}

module.exports = { validateTemplate, compileExpression };
