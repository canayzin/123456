const { RulesSyntaxError } = require('./errors');

const KEYWORDS = new Set(['rules_version', 'match', 'allow', 'if', 'true', 'false', 'null', 'in']);
const TWO = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const ONE = new Set(['{', '}', '(', ')', ':', ';', ',', '=', '<', '>', '!', '/']);

function lex(input) {
  const out = [];
  let i = 0;
  const push = (type, value = type) => out.push({ type, value, index: i });

  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let s = '';
      while (j < input.length && input[j] !== quote) {
        s += input[j];
        j += 1;
      }
      if (j >= input.length) throw new RulesSyntaxError('Unterminated string', i);
      out.push({ type: 'string', value: s, index: i });
      i = j + 1;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < input.length && /[\d.]/.test(input[j])) j += 1;
      out.push({ type: 'number', value: Number(input.slice(i, j)), index: i });
      i = j;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (TWO.has(two)) {
      out.push({ type: two, value: two, index: i });
      i += 2;
      continue;
    }
    if (ONE.has(ch)) {
      out.push({ type: ch, value: ch, index: i });
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_.-]/.test(input[j])) j += 1;
      const ident = input.slice(i, j);
      if (ident === 'array-contains') out.push({ type: 'array-contains', value: ident, index: i });
      else if (KEYWORDS.has(ident)) out.push({ type: ident, value: ident, index: i });
      else out.push({ type: 'ident', value: ident, index: i });
      i = j;
      continue;
    }
    throw new RulesSyntaxError(`Unexpected token ${ch}`, i);
  }
  out.push({ type: 'EOF', value: 'EOF', index: i });
  return out;
}

module.exports = { lex };
