const { StorageService } = require('../storage');

async function main() {
  const s = new StorageService();
  s.createBucket('bench', 'bench-b1');
  const t0 = Date.now();
  for (let i = 0; i < 100; i += 1) {
    await s.putObject('bench', 'bench-b1', `k${i}.txt`, Buffer.from(`v${i}`), { ownerUid: 'u1' }, { auth: { uid: 'u1' } });
  }
  const t1 = Date.now();
  const list = s.listObjects('bench', 'bench-b1', '', { auth: { uid: 'u1' } });
  for (const obj of list) await s.getObject('bench', 'bench-b1', obj.key, { auth: { uid: 'u1' } });
  const t2 = Date.now();
  console.log(JSON.stringify({ uploadMs: t1 - t0, listCount: list.length, downloadMs: t2 - t1, metrics: s.metrics }, null, 2));
}

main();
