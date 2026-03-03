const { node } = require('./ast');

function parse(tokens) {
  let i = 0;
  const cur = () => tokens[i];
  const eat = (type) => { if (cur().type !== type) throw new Error(`Expected ${type}`); const v = cur(); i += 1; return v; };

  function parsePrimary() {
    if (cur().type === 'STRING') return node('Literal', { value: eat('STRING').value });
    if (cur().type === 'NUMBER') return node('Literal', { value: eat('NUMBER').value });
    if (cur().type === 'IDENT') {
      const id = eat('IDENT').value;
      if (cur().type === '(') {
        eat('(');
        const args = [];
        if (cur().type !== ')') { args.push(parseExpr()); while (cur().type === ',') { eat(','); args.push(parseExpr()); } }
        eat(')');
        return node('Call', { name: id, args });
      }
      if (cur().type === '.') {
        eat('.');
        const prop = eat('IDENT').value;
        return node('Member', { object: id, property: prop });
      }
      return node('Ident', { name: id });
    }
    if (cur().type === '(') { eat('('); const e = parseExpr(); eat(')'); return e; }
    if (cur().type === '!') { eat('!'); return node('Unary', { op: '!', arg: parsePrimary() }); }
    throw new Error('Invalid expression');
  }

  function parseCmp() {
    let left = parsePrimary();
    while (['==', '!=', '<', '>', '<=', '>='].includes(cur().type)) {
      const op = eat(cur().type).type;
      const right = parsePrimary();
      left = node('Binary', { op, left, right });
    }
    return left;
  }
  function parseAnd() { let left = parseCmp(); while (cur().type === '&&') { eat('&&'); left = node('Binary', { op: '&&', left, right: parseCmp() }); } return left; }
  function parseExpr() { let left = parseAnd(); while (cur().type === '||') { eat('||'); left = node('Binary', { op: '||', left, right: parseAnd() }); } return left; }

  const out = parseExpr();
  eat('EOF');
  return out;
}

module.exports = { parse };
