class ShardRouter {
  constructor({ shards = 4, overrides = {} } = {}) {
    this.shards = shards;
    this.overrides = overrides;
  }

  route(ctx = {}) {
    const projectId = String(ctx.projectId || 'default-project');
    if (this.overrides[projectId] != null) return this.overrides[projectId];
    let h = 0;
    for (let i = 0; i < projectId.length; i += 1) h = ((h * 31) + projectId.charCodeAt(i)) >>> 0;
    return h % this.shards;
  }
}

module.exports = { ShardRouter };
