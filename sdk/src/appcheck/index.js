const { exchangeDebug } = require('./debug');

function createAppCheck(ctx) {
  return {
    async ensureToken() {
      const now = Math.floor(Date.now() / 1000);
      if (ctx.appCheckToken && ctx.appCheckExp > now + 15) return ctx.appCheckToken;
      if (!ctx.debugAppCheckToken) return '';
      await exchangeDebug(ctx);
      return ctx.appCheckToken || '';
    }
  };
}

module.exports = { createAppCheck };
