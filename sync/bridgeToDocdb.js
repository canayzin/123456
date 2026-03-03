function bridgeToDocdb(docdb, projectId, collection, docId, state) {
  const payload = state || { _deleted: true };
  docdb.collection(collection).doc(docId).set({ ...payload, _syncProjectId: projectId, _syncActor: 'system' });
}
module.exports = { bridgeToDocdb };
