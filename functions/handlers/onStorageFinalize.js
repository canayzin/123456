async function onStorageFinalize(event, ctx) {
  if (ctx.log) ctx.log('info', `storage finalize ${event.bucket}/${event.key}`);
  return { ok: true, bucket: event.bucket, key: event.key };
}

module.exports = { onStorageFinalize };
