async function helloHttp(data, ctx) {
  if (ctx.log) ctx.log('info', 'helloHttp invoked');
  return { message: 'hello', echo: data || null, projectId: ctx.projectId, requestId: ctx.requestId };
}

module.exports = { helloHttp };
