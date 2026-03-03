/** Encode cursor object to stable base64url string. */
function encodeCursor(cursorObj) {
  return Buffer.from(JSON.stringify(cursorObj)).toString('base64url');
}

/** Decode cursor string into object. */
function decodeCursor(cursorValue) {
  if (!cursorValue) return null;
  return JSON.parse(Buffer.from(cursorValue, 'base64url').toString('utf8'));
}

module.exports = { encodeCursor, decodeCursor };
