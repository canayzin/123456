const { createClient } = require('../src');

(async () => {
  const client = await createClient({
    projectId: 'my-project',
    apiKey: 'pk_live_xxx',
    baseUrl: 'http://127.0.0.1:8080',
    appId: 'app_1',
    platform: 'web',
    deviceId: 'device_1',
    debugAppCheckToken: 'dbg_token'
  });

  await client.auth.signUp('dev@example.com', 'password1');
  await client.auth.signIn('dev@example.com', 'password1');
  await client.docdb.collection('todos').doc('a').set({ title: 'hello' });
  const doc = await client.docdb.collection('todos').doc('a').get();
  console.log('doc', doc);

  const rc = await client.remoteConfig.fetch({ minimumFetchIntervalSeconds: 0 });
  console.log('remoteconfig title', rc.getString('title'));

  client.analytics.logEvent('screen_view', { screen: 'home' });
  await client.analytics.flush();
  client.close();
})();
