const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TENANT_FILE = path.join(process.cwd(), 'data', 'tenants.json');

function readTenants() {
  try {
    return JSON.parse(fs.readFileSync(TENANT_FILE, 'utf8'));
  } catch {
    return { organizations: [] };
  }
}

function writeTenants(state) {
  fs.mkdirSync(path.dirname(TENANT_FILE), { recursive: true });
  fs.writeFileSync(TENANT_FILE, JSON.stringify(state, null, 2));
}

class TenantModel {
  ensureProject({ organization = 'default-org', project = 'default-project', environment = 'dev' }) {
    const state = readTenants();
    let org = state.organizations.find((o) => o.name === organization);
    if (!org) {
      org = { id: crypto.randomUUID(), name: organization, projects: [] };
      state.organizations.push(org);
    }
    let prj = org.projects.find((p) => p.name === project);
    if (!prj) {
      prj = { id: crypto.randomUUID(), name: project, environments: ['dev', 'prod'], keys: [crypto.randomBytes(16).toString('hex')], quotas: { requestsPerMin: 1000 } };
      org.projects.push(prj);
    }
    writeTenants(state);
    if (!prj.environments.includes(environment)) throw new Error('INVALID_ENVIRONMENT');
    return { organizationId: org.id, projectId: prj.id, environment, apiKey: prj.keys[0] };
  }
}

module.exports = { TenantModel };
