function createFunctions(ctx) {
  return {
    httpsCallable(name) {
      return async (data = {}) => ctx.http.post(`/functions/${ctx.projectId}/${name}`, data);
    }
  };
}

module.exports = { createFunctions };
