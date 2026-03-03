function buildPublicConfig(project) {
  const pk = (project.apiKeys || []).find((k) => k.type === 'public' && !k.revoked);
  return {
    projectId: project.projectId,
    apiKeyPublic: pk ? pk.prefix : '',
    region: project.regionPrimary,
    endpoints: {
      auth: '/auth',
      firestore: `/v1/projects/${project.projectId}/docdb`,
      functions: `/functions/${project.projectId}`,
      messaging: `/v1/projects/${project.projectId}/messaging`,
      remoteconfig: `/v1/projects/${project.projectId}/remoteconfig`,
      analytics: `/v1/projects/${project.projectId}/analytics`
    }
  };
}

module.exports = { buildPublicConfig };
