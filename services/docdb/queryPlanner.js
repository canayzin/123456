class QueryPlanner {
  constructor(indexEngine) {
    this.indexEngine = indexEngine;
  }

  parse(query) {
    return {
      where: query.where || [],
      orderBy: query.orderBy || [],
      limit: query.limit,
      cursor: {
        startAt: query.startAt,
        startAfter: query.startAfter,
        endAt: query.endAt,
        endBefore: query.endBefore,
        limitToLast: query.limitToLast
      }
    };
  }

  chooseIndex(collection, parsed) {
    const candidates = this.indexEngine.listIndexes(collection);
    let best = null;
    let bestScore = -1;
    for (const idx of candidates) {
      let score = 0;
      for (const w of parsed.where) if (idx.fields.some((f) => f.field === w.field)) score += 2;
      for (const o of parsed.orderBy) if (idx.fields.some((f) => f.field === o.field)) score += 1;
      if (score > bestScore) {
        best = idx;
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : null;
  }

  plan(collection, query, collectionSize = 0) {
    const parsed = this.parse(query);
    const selected = this.chooseIndex(collection, parsed);
    if (!selected) {
      return {
        strategy: 'scan',
        estimatedCost: collectionSize,
        usedIndex: null,
        suggestion: this.indexEngine.suggestIndex(collection, parsed),
        parsed
      };
    }
    const indexedRows = this.indexEngine.queryIndex(selected.name).length;
    return {
      strategy: 'index',
      estimatedCost: Math.max(1, Math.floor(indexedRows / 2)),
      usedIndex: selected.name,
      suggestion: null,
      parsed
    };
  }
}

module.exports = { QueryPlanner };
