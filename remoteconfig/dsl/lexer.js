function lex(input) {
  const s = String(input || '');
  const t = [];
  let i = 0;
  const push = (type, value = type) => t.push({ type, value });
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i += 1; continue; }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '&&', '||', '<=', '>='].includes(two)) { push(two); i += 2; continue; }
    if (['(', ')', '!', '<', '>', ',', '.'].includes(c)) { push(c); i += 1; continue; }
    if (c === "'") {
      let j = i + 1; let out = '';
      while (j < s.length && s[j] !== "'") { out += s[j]; j += 1; }
      if (j >= s.length) throw new Error('Unclosed string');
      push('STRING', out); i = j + 1; continue;
    }
    if (/\d/.test(c)) {
      let j = i; while (j < s.length && /\d/.test(s[j])) j += 1;
      push('NUMBER', Number(s.slice(i, j))); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
      push('IDENT', s.slice(i, j)); i = j; continue;
    }
    throw new Error(`Unexpected token ${c}`);
  }
  push('EOF');
  return t;
}
module.exports = { lex };
