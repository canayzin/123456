function decodeCursor(cursor) {
  if (!cursor) return { offset: 0 };
  try { return JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8')); } catch { return { offset: 0 }; }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function paginate(items, { limit = 50, cursor = '' } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit || 50)));
  const cur = decodeCursor(cursor);
  const start = Math.max(0, Number(cur.offset || 0));
  const slice = items.slice(start, start + lim);
  const nextOffset = start + slice.length;
  return { items: slice, nextCursor: nextOffset < items.length ? encodeCursor({ offset: nextOffset }) : '' };
}

module.exports = { decodeCursor, encodeCursor, paginate };
