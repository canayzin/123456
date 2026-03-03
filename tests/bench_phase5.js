const { FunctionsService } = require('../functions');

async function main() {
  const svc = new FunctionsService({ emulator: true });
  svc.deploy('bench', { name: 'helloHttp', entryPath: 'functions/handlers/helloHttp.js', exportName: 'helloHttp', triggerType: 'http' });
  const n = 500;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: n }, (_, i) => svc.invoker.invoke('bench', 'helloHttp', { i }, { auth: { uid: 'u' } })));
  const dt = Date.now() - t0;
  console.log(JSON.stringify({ n, ms: dt, rps: Math.round((n * 1000) / dt), metrics: svc.metrics.snapshot() }, null, 2));
}

main();
