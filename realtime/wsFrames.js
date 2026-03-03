const MAX_FRAME = 1024 * 1024;

function encodeFrame(text, opcode = 0x1) {
  const payload = Buffer.from(String(text));
  const len = payload.length;
  if (len > MAX_FRAME) throw new Error('FRAME_TOO_LARGE');
  const header = [];
  header.push(0x80 | (opcode & 0x0f));
  if (len < 126) {
    header.push(len);
  } else if (len < 65536) {
    header.push(126, (len >> 8) & 0xff, len & 0xff);
  } else {
    header.push(127, 0, 0, 0, 0, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
  }
  return Buffer.concat([Buffer.from(header), payload]);
}

function decodeFrames(state, chunk, { requireMasked = true } = {}) {
  state.buffer = Buffer.concat([state.buffer || Buffer.alloc(0), chunk]);
  const frames = [];
  while (state.buffer.length >= 2) {
    const b1 = state.buffer[0];
    const b2 = state.buffer[1];
    const fin = (b1 & 0x80) !== 0;
    const opcode = b1 & 0x0f;
    const masked = (b2 & 0x80) !== 0;
    let len = b2 & 0x7f;
    let offset = 2;
    if (!fin) throw new Error('FRAGMENT_UNSUPPORTED');
    if (len === 126) {
      if (state.buffer.length < offset + 2) break;
      len = state.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (state.buffer.length < offset + 8) break;
      const hi = state.buffer.readUInt32BE(offset);
      const lo = state.buffer.readUInt32BE(offset + 4);
      if (hi !== 0) throw new Error('FRAME_TOO_LARGE');
      len = lo;
      offset += 8;
    }
    if (len > MAX_FRAME) throw new Error('FRAME_TOO_LARGE');
    if (requireMasked && !masked) throw new Error('CLIENT_FRAME_NOT_MASKED');
    const maskBytes = masked ? 4 : 0;
    if (state.buffer.length < offset + maskBytes + len) break;
    let payload = state.buffer.subarray(offset + maskBytes, offset + maskBytes + len);
    if (masked) {
      const mask = state.buffer.subarray(offset, offset + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    state.buffer = state.buffer.subarray(offset + maskBytes + len);
    frames.push({ opcode, fin, payload, text: payload.toString('utf8') });
  }
  return frames;
}

module.exports = { encodeFrame, decodeFrames, MAX_FRAME };
