function joinPath(base, add) {
  return [...base, ...add];
}

function flattenMatches(ast) {
  const rows = [];
  function walk(node, prefix = [], allows = []) {
    if (node.type !== 'Match') return;
    const fullPath = joinPath(prefix, node.path);
    const localAllows = [...allows, ...node.body.filter((x) => x.type === 'Allow')];
    rows.push({ path: fullPath, allows: localAllows });
    for (const child of node.body) if (child.type === 'Match') walk(child, fullPath, localAllows);
  }
  for (const node of ast.body) walk(node, [], []);
  return rows;
}

function normalizePath(path) {
  const clean = String(path || '').split('?')[0].replace(/^\/+|\/+$/g, '');
  const segs = clean ? clean.split('/') : [];
  const idx = segs.indexOf('documents');
  return idx >= 0 ? segs.slice(idx + 1) : segs;
}

function matchPath(pattern, pathSegs) {
  const params = {};
  if (!pattern.length && !pathSegs.length) return { ok: true, params };
  let i = 0;
  let j = 0;
  while (i < pattern.length && j < pathSegs.length) {
    const p = pattern[i];
    const s = pathSegs[j];
    if (p.type === 'literal') {
      if (p.value !== s) return { ok: false };
    } else {
      params[p.name] = s;
    }
    i += 1;
    j += 1;
  }
  if (i !== pattern.length || j !== pathSegs.length) return { ok: false };
  return { ok: true, params };
}

function resolveBest(ast, path) {
  const candidates = flattenMatches(ast);
  const segs = normalizePath(path);
  let best = null;
  for (const c of candidates) {
    const relPattern = normalizePath(c.path.map((x) => (x.type === 'param' ? `{${x.name}}` : x.value)).join('/'));
    const pattern = relPattern.map((x) => (x.startsWith('{') ? { type: 'param', name: x.slice(1, -1) } : { type: 'literal', value: x }));
    const m = matchPath(pattern, segs);
    if (!m.ok) continue;
    const score = pattern.filter((x) => x.type === 'literal').length * 1000 + pattern.length;
    if (!best || score > best.score) best = { ...c, params: m.params, score };
  }
  return best;
}

module.exports = { flattenMatches, normalizePath, resolveBest };
