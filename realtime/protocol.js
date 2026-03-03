const ALLOWED_SUB_TYPES = new Set(['docdb.doc', 'docdb.query', 'rtdb.path']);

function parseMessage(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_MESSAGE');
  if (!parsed.type) throw new Error('MISSING_TYPE');
  return parsed;
}

function validateSubscribe(msg) {
  if (!ALLOWED_SUB_TYPES.has(msg.subType)) throw new Error('INVALID_SUB_TYPE');
  if (!msg.topic || typeof msg.topic !== 'object') throw new Error('INVALID_TOPIC');
  if (msg.subType === 'docdb.doc' && (!msg.topic.collection || !msg.topic.docId)) throw new Error('INVALID_TOPIC');
  if (msg.subType === 'docdb.query' && !msg.topic.collection) throw new Error('INVALID_TOPIC');
  if (msg.subType === 'rtdb.path' && !msg.topic.path) throw new Error('INVALID_TOPIC');
}

module.exports = { parseMessage, validateSubscribe };
