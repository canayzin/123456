function esc(s) { return s.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

function toRegex(pattern = '**') {
  const p = String(pattern || '**');
  const out = ['^'];
  for (let i = 0; i < p.length; i += 1) {
    const ch = p[i];
    const nxt = p[i + 1];
    if (ch === '*' && nxt === '*') { out.push('.*'); i += 1; continue; }
    if (ch === '*') { out.push('[^/]*'); continue; }
    out.push(esc(ch));
  }
  out.push('$');
  return new RegExp(out.join(''));
}

function match(pattern, value) {
  return toRegex(pattern).test(value);
}

module.exports = { toRegex, match };
