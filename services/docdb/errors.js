/** Build standardized DocDB error payload. */
function docdbError(code, message, details = {}, requestId = '') {
  return { error: { code, message, details }, requestId };
}

module.exports = {
  docdbError,
  CODES: {
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RULE_DENY_READ: 'RULE_DENY_READ',
    RULE_DENY_WRITE: 'RULE_DENY_WRITE',
    INVALID_QUERY: 'INVALID_QUERY',
    WAL_RECOVERY: 'WAL_RECOVERY'
  }
};
