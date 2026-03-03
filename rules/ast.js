function program(version, body) {
  return { type: 'Program', version, body };
}

function matchNode(path, body) {
  return { type: 'Match', path, body };
}

function allowNode(actions, condition) {
  return { type: 'Allow', actions, condition };
}

module.exports = { program, matchNode, allowNode };
