function createAuth(ctx) {
  return {
    async signUp(email, password) {
      return ctx.http.post('/auth/signup', { email, password });
    },
    async signIn(email, password) {
      const out = await ctx.http.post('/auth/login', { email, password });
      ctx.tokens.accessToken = out.accessToken || '';
      ctx.tokens.refreshToken = out.refreshToken || '';
      return out;
    },
    signOut() { ctx.tokens.clear(); },
    getAccessToken() { return ctx.tokens.accessToken; },
    async refresh() {
      if (!ctx.tokens.refreshToken) return null;
      const out = await ctx.http.post('/auth/refresh', { refreshToken: ctx.tokens.refreshToken });
      ctx.tokens.accessToken = out.accessToken || '';
      ctx.tokens.refreshToken = out.refreshToken || ctx.tokens.refreshToken;
      return out;
    }
  };
}

module.exports = { createAuth };
