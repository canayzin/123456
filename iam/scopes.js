const SCOPES = [
  'docdb.read', 'docdb.write', 'storage.read', 'storage.write', 'storage.admin',
  'functions.invoke', 'functions.deploy', 'quota.admin', 'infra.admin', 'region.failover',
  'analytics.read', 'analytics.write', 'analytics.admin', 'org.admin', 'project.admin', 'project.read', 'apikey.admin', 'control.read', 'console.read', 'console.admin', 'logs.read', 'exports.read', 'billing.admin', 'hosting.read', 'hosting.deploy', 'hosting.admin', 'messaging.read', 'messaging.send', 'messaging.admin', 'remoteconfig.read', 'remoteconfig.publish', 'remoteconfig.admin', 'appcheck.read', 'appcheck.admin', 'iam.admin', 'docdb.*', 'storage.*', 'all.*'
];

module.exports = { SCOPES };
