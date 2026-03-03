async function transformDoc(event, ctx) {
  const token = ctx.secrets.get('TOKEN');
  return { ok: true, docId: event.docId, hasAfter: Boolean(event.after), tokenSeen: Boolean(token) };
}

module.exports = { transformDoc };
