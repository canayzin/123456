const BUILTIN_ROLES = {
  owner: ['all.*'],
  editor: ['docdb.*', 'storage.*', 'functions.*', 'sync.*', 'analytics.read', 'hosting.read', 'messaging.read', 'remoteconfig.read', 'appcheck.read', 'remoteconfig.publish'],
  viewer: ['docdb.read', 'storage.read', 'analytics.read', 'hosting.read', 'messaging.read', 'remoteconfig.read', 'appcheck.read', 'project.read', 'control.read'],
  org_admin: ['org.admin', 'project.admin', 'control.read', 'console.admin', 'logs.read', 'exports.read', 'analytics.admin', 'billing.admin', 'iam.admin'],
  project_admin: ['project.admin', 'apikey.admin', 'project.read', 'console.read', 'logs.read', 'exports.read']
};

function hasScope(scopes, required) {
  if (!required) return true;
  const list = scopes || [];
  if (list.includes('all.*')) return true;
  if (list.includes(required)) return true;
  const prefix = required.split('.')[0];
  return list.includes(`${prefix}.*`);
}

module.exports = { BUILTIN_ROLES, hasScope };
