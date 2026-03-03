const fs = require('fs');
const path = require('path');
const { BillingEngine } = require('../billing/engine');

const projectId = 'bench15';
const usageFile = path.join(process.cwd(), 'data', 'usage', `${projectId}.ndjson`);
fs.mkdirSync(path.dirname(usageFile), { recursive: true });
let out = '';
for (let i = 0; i < 50000; i += 1) out += `${JSON.stringify({ ts: Date.now(), projectId, service: 'docdb', op: 'read', count: 1, bytes: 0 })}\n`;
fs.writeFileSync(usageFile, out);

const b = new BillingEngine();
b.setBilling(projectId, 'org_bench', { plan: 'pro' }, 'bench');
const started = Date.now();
const agg = b.runAggregation(projectId);
const inv = b.generateInvoice(projectId, new Date().toISOString().slice(0, 7), 'bench');
const ms = Date.now() - started;
console.log(`phase15 bench durationMs=${ms} processed=${agg.processed} eps=${Math.round((agg.processed / Math.max(ms,1))*1000)} totalCents=${inv.totalCents}`);
