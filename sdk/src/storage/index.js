function asUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  return new Uint8Array([]);
}

function createStorage(ctx) {
  return {
    async upload({ bucket, key, data, contentType = 'application/octet-stream' }) {
      const sign = await ctx.http.post(`/v1/projects/${ctx.projectId}/storage/sign`, { method: 'PUT', bucket, key, contentType });
      const bytes = asUint8Array(data);
      const res = await fetch(sign.url, { method: 'PUT', headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) }, body: bytes });
      if (!res.ok) throw new Error('UPLOAD_FAILED');
      return { ok: true };
    },
    async download({ bucket, key }) {
      const sign = await ctx.http.post(`/v1/projects/${ctx.projectId}/storage/sign`, { method: 'GET', bucket, key });
      const res = await fetch(sign.url, { method: 'GET' });
      if (!res.ok) throw new Error('DOWNLOAD_FAILED');
      return new Uint8Array(await res.arrayBuffer());
    }
  };
}

module.exports = { createStorage };
