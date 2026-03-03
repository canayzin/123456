function protocolError(code, message, details = {}, requestId = '') {
  return { type: 'ERROR', requestId, error: { code, message, details } };
}

module.exports = { protocolError };
