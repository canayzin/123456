const { connectDevice } = require('./deviceWs');

function createMessaging(ctx) {
  return {
    registerToken(token, meta = {}) { return ctx.http.post(`/v1/projects/${ctx.projectId}/messaging/tokens`, { token, ...meta, appId: ctx.appId, platform: ctx.platform }); },
    subscribe(topic, token) { return ctx.http.post(`/v1/projects/${ctx.projectId}/messaging/topics/${topic}/subscribe`, { token }); },
    send(message) { return ctx.http.post(`/v1/projects/${ctx.projectId}/messaging/send`, { message }); },
    connectDevice(token, onMessage) { return connectDevice({ baseUrl: ctx.baseUrl, projectId: ctx.projectId, token, onMessage }); }
  };
}

module.exports = { createMessaging };
