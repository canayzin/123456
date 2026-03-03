class RulesSyntaxError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'RulesSyntaxError';
    this.index = index;
  }
}

class RulesEvalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RulesEvalError';
  }
}

module.exports = { RulesSyntaxError, RulesEvalError };
