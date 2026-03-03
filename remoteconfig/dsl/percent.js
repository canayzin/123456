const crypto = require('crypto');
function percent(uid, salt) {
  if (!uid) return 100;
  const h = crypto.createHash('sha256').update(`${uid}|${salt}`).digest();
  const n = h.readUInt32BE(0);
  return n % 100;
}
module.exports = { percent };
