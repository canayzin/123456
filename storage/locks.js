class LockMap { constructor() { this.map = new Map(); } async withLock(key, fn) { const prev = this.map.get(key) || Promise.resolve(); let done; const cur = new Promise((r)=>{done=r;}); this.map.set(key, prev.then(()=>cur)); await prev; try { return await fn(); } finally { done(); } } }
module.exports = { LockMap };
