const fs = require('fs');
const path = require('path');
const { BUILTIN_ROLES, hasScope } = require('./roles');

class IamEngine {
  constructor({ orgStore, serviceAccounts }) {
    this.orgStore = orgStore;
    this.serviceAccounts = serviceAccounts;
    this.metrics = { iam_checks_total: 0, iam_denied_total: 0, service_token_issued_total: 0, iam_audit_entries_total: 0 };
    this.auditFile = path.join(process.cwd(), 'data', 'iam', 'audit.ndjson');
    fs.mkdirSync(path.dirname(this.auditFile), { recursive: true });
  }

  _appendAudit(entry) {
    fs.appendFileSync(this.auditFile, `${JSON.stringify(entry)}\n`);
    this.metrics.iam_audit_entries_total += 1;
  }

  resolveScopes({ orgId, projectId, actor }) {
    if (actor.kind === 'service') return actor.scopes || [];
    const org = this.orgStore.ensureProject(orgId, projectId);
    const p = org.projects[projectId];
    const m = (p.members || []).find((x) => x.uid === actor.uid);
    if (!m) return [];
    if (BUILTIN_ROLES[m.role]) return BUILTIN_ROLES[m.role];
    return p.customRoles[m.role] || [];
  }

  check(ctx, requiredScope) {
    this.metrics.iam_checks_total += 1;
    const scopes = this.resolveScopes(ctx);
    const allowed = hasScope(scopes, requiredScope);
    const actorId = ctx.actor.kind === 'service' ? ctx.actor.id : ctx.actor.uid;
    this._appendAudit({ ts: Date.now(), orgId: ctx.orgId, projectId: ctx.projectId, actor: actorId, scope: requiredScope, result: allowed ? 'allow' : 'deny', requestId: ctx.requestId || '' });
    if (!allowed) {
      this.metrics.iam_denied_total += 1;
      const e = new Error('Missing required scope');
      e.code = 'PERMISSION_DENIED';
      e.details = { requiredScope, requestId: ctx.requestId || '' };
      throw e;
    }
    return true;
  }
}

module.exports = { IamEngine };
