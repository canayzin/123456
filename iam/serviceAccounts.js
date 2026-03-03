const crypto = require('crypto');
const { signServiceToken, verifyServiceToken } = require('./token');

const secretCache = new Map();

function hash(secret) { return crypto.createHash('sha256').update(secret).digest('hex'); }

class ServiceAccounts {
  constructor(orgStore) { this.orgStore = orgStore; }

  create(orgId, projectId, id, scopes = []) {
    const org = this.orgStore.ensureProject(orgId, projectId);
    const p = org.projects[projectId];
    const row = { id, scopes, keyHash: '' };
    p.serviceAccounts = p.serviceAccounts.filter((x) => x.id !== id).concat([row]);
    this.orgStore.save(orgId, org);
    return row;
  }

  issueKey(orgId, projectId, id) {
    const org = this.orgStore.ensureProject(orgId, projectId);
    const p = org.projects[projectId];
    const sa = p.serviceAccounts.find((x) => x.id === id);
    if (!sa) throw new Error('SERVICE_ACCOUNT_NOT_FOUND');
    const secret = crypto.randomBytes(24).toString('hex');
    sa.keyHash = hash(secret);
    this.orgStore.save(orgId, org);
    secretCache.set(`${orgId}:${projectId}:${id}`, secret);
    const now = Math.floor(Date.now() / 1000);
    const token = signServiceToken({ sub: id, orgId, projectId, scopes: sa.scopes || [], iat: now, exp: now + 3600 }, secret);
    return { token, secret };
  }

  remove(orgId, projectId, id) {
    const org = this.orgStore.ensureProject(orgId, projectId);
    org.projects[projectId].serviceAccounts = org.projects[projectId].serviceAccounts.filter((x) => x.id !== id);
    this.orgStore.save(orgId, org);
    secretCache.delete(`${orgId}:${projectId}:${id}`);
    return { ok: true };
  }

  verify(orgId, projectId, token) {
    const org = this.orgStore.ensureProject(orgId, projectId);
    for (const sa of org.projects[projectId].serviceAccounts || []) {
      const secret = secretCache.get(`${orgId}:${projectId}:${sa.id}`);
      if (!secret) continue;
      const out = verifyServiceToken(token, secret);
      if (out.ok && out.payload.sub === sa.id && out.payload.orgId === orgId && out.payload.projectId === projectId) return out;
    }
    return { ok: false, reason: 'INVALID' };
  }
}

module.exports = { ServiceAccounts };
