class ConsistencyRouter {
  constructor() { this.mode = 'strong'; }
  setMode(mode) { this.mode = mode === 'eventual' ? 'eventual' : 'strong'; return this.mode; }
  getMode() { return this.mode; }
  read({ projectId, collection, docId, primaryRead, secondaryRead }) {
    if (this.mode === 'eventual') return secondaryRead(projectId, collection, docId);
    return primaryRead(projectId, collection, docId);
  }
}

module.exports = { ConsistencyRouter };
