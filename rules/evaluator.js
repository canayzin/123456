const { RulesEvalError } = require('./errors');

function getPath(ctx, parts) {
  let cur = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function evalExpr(node, ctx) {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'Identifier') return getPath(ctx, node.path);
  if (node.type === 'Unary') {
    if (node.op !== '!') throw new RulesEvalError('Invalid unary op');
    return !evalExpr(node.expr, ctx);
  }
  if (node.type === 'Binary') {
    const l = evalExpr(node.left, ctx);
    const r = evalExpr(node.right, ctx);
    if (node.op === '==') return l === r;
    if (node.op === '!=') return l !== r;
    if (node.op === '<') return l < r;
    if (node.op === '<=') return l <= r;
    if (node.op === '>') return l > r;
    if (node.op === '>=') return l >= r;
    if (node.op === '&&') return Boolean(l) && Boolean(r);
    if (node.op === '||') return Boolean(l) || Boolean(r);
    if (node.op === 'in') return Array.isArray(r) && r.includes(l);
    if (node.op === 'array-contains') return Array.isArray(l) && l.includes(r);
    throw new RulesEvalError(`Unsupported operator ${node.op}`);
  }
  throw new RulesEvalError(`Unsupported node ${node.type}`);
}

module.exports = { evalExpr };
