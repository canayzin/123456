function createTokenManager(store) {
  return {
    get accessToken() { return store.get('accessToken') || ''; },
    set accessToken(v) { store.set('accessToken', v || ''); },
    get refreshToken() { return store.get('refreshToken') || ''; },
    set refreshToken(v) { store.set('refreshToken', v || ''); },
    clear() { store.remove('accessToken'); store.remove('refreshToken'); }
  };
}

module.exports = { createTokenManager };
