const { lex } = require('./lexer');
const { RulesSyntaxError } = require('./errors');
const { program, matchNode, allowNode } = require('./ast');

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }

  cur() { return this.tokens[this.i]; }
  eat(type) {
    const t = this.cur();
    if (t.type !== type) throw new RulesSyntaxError(`Expected ${type} got ${t.type}`, t.index);
    this.i += 1;
    return t;
  }
  maybe(type) {
    if (this.cur().type === type) { this.i += 1; return true; }
    return false;
  }

  parseProgram() {
    this.eat('rules_version'); this.eat('=');
    const v = this.eat('string').value;
    this.eat(';');
    const body = [this.parseMatch()];
    this.eat('EOF');
    return program(v, body);
  }

  parseMatch() {
    this.eat('match');
    const path = this.parsePath();
    this.eat('{');
    const body = [];
    while (this.cur().type !== '}') {
      if (this.cur().type === 'match') body.push(this.parseMatch());
      else if (this.cur().type === 'allow') body.push(this.parseAllow());
      else throw new RulesSyntaxError(`Unexpected ${this.cur().type}`, this.cur().index);
    }
    this.eat('}');
    return matchNode(path, body);
  }

  parsePath() {
    const parts = [];
    while (this.maybe('/')) {
      if (this.maybe('{')) {
        const name = this.eat('ident').value;
        this.eat('}');
        parts.push({ type: 'param', name });
      } else {
        const t = this.cur();
        if (!['ident', 'number', 'string'].includes(t.type)) throw new RulesSyntaxError('Bad path segment', t.index);
        this.i += 1;
        parts.push({ type: 'literal', value: String(t.value) });
      }
    }
    return parts;
  }

  parseAllow() {
    this.eat('allow');
    const actions = [this.eat('ident').value];
    while (this.maybe(',')) actions.push(this.eat('ident').value);
    let condition = { type: 'Literal', value: true };
    if (this.maybe(':')) {
      this.eat('if');
      condition = this.parseExpr();
    }
    this.eat(';');
    return allowNode(actions, condition);
  }

  parseExpr() { return this.parseOr(); }
  parseOr() {
    let left = this.parseAnd();
    while (this.maybe('||')) left = { type: 'Binary', op: '||', left, right: this.parseAnd() };
    return left;
  }
  parseAnd() {
    let left = this.parseCmp();
    while (this.maybe('&&')) left = { type: 'Binary', op: '&&', left, right: this.parseCmp() };
    return left;
  }
  parseCmp() {
    let left = this.parseUnary();
    const ops = ['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains'];
    while (ops.includes(this.cur().type)) {
      const op = this.cur().type;
      this.i += 1;
      left = { type: 'Binary', op, left, right: this.parseUnary() };
    }
    return left;
  }
  parseUnary() {
    if (this.maybe('!')) return { type: 'Unary', op: '!', expr: this.parseUnary() };
    return this.parsePrimary();
  }
  parsePrimary() {
    const t = this.cur();
    if (this.maybe('(')) {
      const e = this.parseExpr();
      this.eat(')');
      return e;
    }
    if (t.type === 'number') { this.i += 1; return { type: 'Literal', value: t.value }; }
    if (t.type === 'string') { this.i += 1; return { type: 'Literal', value: t.value }; }
    if (this.maybe('true')) return { type: 'Literal', value: true };
    if (this.maybe('false')) return { type: 'Literal', value: false };
    if (this.maybe('null')) return { type: 'Literal', value: null };
    if (t.type === 'ident') { this.i += 1; return { type: 'Identifier', path: t.value.split('.') }; }
    throw new RulesSyntaxError(`Unexpected token ${t.type}`, t.index);
  }
}

function parse(input) {
  const p = new Parser(lex(input));
  return p.parseProgram();
}

module.exports = { parse };
