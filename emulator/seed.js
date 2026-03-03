const { Buffer } = require('buffer');

async function seedProject(services, payload) {
  const { projectId } = payload;
  if (!projectId) throw new Error('projectId is required');
  if (payload.time != null) services.clock.set(payload.time);

  const tenant = services.tenants.ensureProject({ organization: 'default-org', project: projectId, environment: 'dev' });

  for (const u of payload.users || []) {
    await services.identity.signup({ tenant, email: u.email, password: u.password, ip: '127.0.0.1' });
  }

  for (const d of payload.docs || []) {
    services.docdb.collection(d.collection).doc(d.docId).set({ ...(d.data || {}), _createdAt: services.clock.now(), _projectId: projectId });
  }

  for (const s of payload.storage || []) {
    services.storage.createBucket(projectId, s.bucket);
    const content = Buffer.from(s.contentBase64 || s.content || '', 'base64');
    await services.storage.putObject(projectId, s.bucket, s.key, content, { contentType: s.contentType || 'application/octet-stream', ownerUid: s.ownerUid || null }, { auth: { uid: s.ownerUid || null } });
  }

  if (payload.quota) services.quota.setQuota(projectId, payload.quota);
}

module.exports = { seedProject };
