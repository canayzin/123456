const { percent } = require('./percent');

function truthy(v) { return Boolean(v); }

function evalAst(ast, ctx) {
  switch (ast.type) {
    case 'Literal': return ast.value;
    case 'Ident': return ctx[ast.name];
    case 'Member': return ast.object === 'attr' ? (ctx.attributes || {})[ast.property] : undefined;
    case 'Unary': return ast.op === '!' ? !truthy(evalAst(ast.arg, ctx)) : undefined;
    case 'Call': {
      if (ast.name !== 'percent') throw new Error('Unsupported function');
      const [a0, a1] = ast.args;
      const uid = evalAst(a0, ctx);
      const salt = evalAst(a1, ctx);
      return percent(uid, salt);
    }
    case 'Binary': {
      const l = evalAst(ast.left, ctx);
      const r = evalAst(ast.right, ctx);
      if (ast.op === '&&') return truthy(l) && truthy(r);
      if (ast.op === '||') return truthy(l) || truthy(r);
      if (ast.op === '==') return String(l) === String(r);
      if (ast.op === '!=') return String(l) !== String(r);
      if (ast.op === '<') return Number(l) < Number(r);
      if (ast.op === '>') return Number(l) > Number(r);
      if (ast.op === '<=') return Number(l) <= Number(r);
      if (ast.op === '>=') return Number(l) >= Number(r);
      throw new Error('Unsupported operator');
    }
    default: throw new Error('Invalid AST');
  }
}

module.exports = { evalAst };
