const crypto = require('crypto');
const { AppStore } = require('./store');
const { KeysStore } = require('./keys');
const { ReplayStore } = require('./replay');
const { createMetrics } = require('./metrics');
const { appendAudit } = require('./audit');
const { appCheckError } = require('./errors');
const { sign } = require('./token');
const { verifyAppCheckToken, deriveDebugSecret } = require('./verify');
const { extractToken, enforceMode, appIdFromHeaders } = require('./middleware');

class AppCheckService {
  constructor({ billing }) {
    this.apps = new AppStore();
    this.keys = new KeysStore();
    this.replay = new ReplayStore();
    this.billing = billing;
    this.metrics = createMetrics();
  }
  close() { this.replay.close(); }

  _plan(projectId, orgId = 'default-org') { return this.billing.ensureProject(projectId, orgId).plan || 'free'; }
  _defaultMode(projectId, orgId) { return this._plan(projectId, orgId) === 'free' ? 'monitor' : 'enforce'; }

  listApps(projectId) { return this.apps.get(projectId).apps || []; }

  registerApp(projectId, orgId, app) {
    const row = this.apps.get(projectId);
    const mode = this._defaultMode(projectId, orgId);
    const enforcement = app.enforcement || {
      'remoteconfig.fetch': mode,
      'messaging.send': mode,
      'messaging.tokens': mode,
      'storage.sign': mode,
      'functions.invoke': mode,
      'analytics.ingest': mode
    };
    const next = { appId: app.appId, platform: app.platform || 'web', provider: app.provider || 'debug', createdAt: Date.now(), enforcement };
    row.apps = row.apps.filter((x) => x.appId !== next.appId).concat([next]);
    this.apps.save(projectId, row);
    appendAudit({ type: 'app.register', projectId, appId: next.appId, provider: next.provider });
    return next;
  }

  setEnforcement(projectId, appId, serviceKey, mode) {
    const row = this.apps.get(projectId);
    const app = row.apps.find((x) => x.appId === appId);
    if (!app) throw appCheckError('NOT_FOUND', 'APP_NOT_FOUND');
    app.enforcement = app.enforcement || {};
    app.enforcement[serviceKey] = mode;
    this.apps.save(projectId, row);
    appendAudit({ type: 'enforcement.mode.change', projectId, appId, serviceKey, mode });
    return app;
  }

  addDebugToken(projectId, token) {
    const row = this.keys.get(projectId);
    row.debugTokens = Array.from(new Set([...(row.debugTokens || []), token]));
    this.keys.save(projectId, row);
    appendAudit({ type: 'debugToken.add', projectId, token });
    return { ok: true };
  }

  setCustomSecret(projectId, appId, secretBase64) {
    const row = this.keys.get(projectId);
    row.customSecrets = row.customSecrets || {};
    row.customSecrets[appId] = secretBase64;
    this.keys.save(projectId, row);
    appendAudit({ type: 'customSecret.set', projectId, appId });
    return { ok: true };
  }

  _mint(projectId, app) {
    const iat = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'novacloud-appcheck',
      sub: app.appId,
      projectId,
      platform: app.platform,
      iat,
      exp: iat + 600,
      jti: crypto.randomUUID(),
      tokenType: 'appcheck',
      provider: app.provider
    };
    const keys = this.keys.get(projectId);
    const secret = app.provider === 'debug' ? deriveDebugSecret(projectId, app.appId) : keys.customSecrets[app.appId];
    if (!secret) throw appCheckError('PERMISSION_DENIED', 'APP_CHECK_PROVIDER_NOT_CONFIGURED');
    const token = sign(payload, secret, app.appId);
    this.metrics.appcheck_exchange_total += 1;
    appendAudit({ type: 'token.exchange', projectId, appId: app.appId, provider: app.provider });
    return { token, expireTime: payload.exp };
  }

  exchangeDebug(projectId, appId, debugToken) {
    const app = this.listApps(projectId).find((x) => x.appId === appId && x.provider === 'debug');
    if (!app) throw appCheckError('NOT_FOUND', 'APP_NOT_FOUND');
    const keys = this.keys.get(projectId);
    if (!(keys.debugTokens || []).includes(debugToken)) throw appCheckError('PERMISSION_DENIED', 'APP_CHECK_DEBUG_TOKEN_INVALID');
    return this._mint(projectId, app);
  }

  exchangeCustom(projectId, appId, secret) {
    const app = this.listApps(projectId).find((x) => x.appId === appId && x.provider === 'custom');
    if (!app) throw appCheckError('NOT_FOUND', 'APP_NOT_FOUND');
    const keys = this.keys.get(projectId);
    if (String(keys.customSecrets?.[appId] || '') !== String(secret || '')) throw appCheckError('PERMISSION_DENIED', 'APP_CHECK_CUSTOM_SECRET_INVALID');
    return this._mint(projectId, app);
  }

  verifyForService(req, { projectId, serviceKey }) {
    this.metrics.appcheck_verify_total += 1;
    const appId = appIdFromHeaders(req);
    if (!appId) return { mode: 'skip', claims: null, appId: '', result: 'skipped' };
    const app = this.listApps(projectId).find((x) => x.appId === appId);
    if (!app) return { mode: 'skip', claims: null, appId, result: 'skipped' };
    const mode = enforceMode(app, serviceKey);
    if (mode === 'off') return { mode, claims: null, appId, result: 'skipped' };
    const token = extractToken(req);
    if (!token) {
      this.metrics.appcheck_missing_total += 1;
      if (mode === 'monitor') {
        this.metrics.appcheck_monitor_only_total += 1;
        appendAudit({ type: 'verify.deny', projectId, appId, serviceKey, reason: 'missing', monitor: true });
        return { mode, claims: null, appId, result: 'missing' };
      }
      this.metrics.appcheck_denied_total += 1;
      appendAudit({ type: 'verify.deny', projectId, appId, serviceKey, reason: 'missing', monitor: false });
      throw appCheckError('PERMISSION_DENIED', 'APP_CHECK_REQUIRED');
    }
    try {
      const claims = verifyAppCheckToken({ token, projectId, appId, app, keys: this.keys.get(projectId), replay: this.replay });
      return { mode, claims, appId, result: 'ok' };
    } catch (e) {
      const reason = String(e.message || '').includes('REPLAY') ? 'replay' : 'invalid';
      if (reason === 'replay') this.metrics.appcheck_replay_total += 1;
      if (mode === 'monitor') {
        this.metrics.appcheck_monitor_only_total += 1;
        appendAudit({ type: 'verify.deny', projectId, appId, serviceKey, reason, monitor: true });
        return { mode, claims: null, appId, result: reason };
      }
      this.metrics.appcheck_denied_total += 1;
      appendAudit({ type: 'verify.deny', projectId, appId, serviceKey, reason, monitor: false });
      throw e;
    }
  }
}

module.exports = { AppCheckService };
