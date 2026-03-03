const { spawn } = require('node:child_process');
const path = require('node:path');

const scripts = ['load_http.js', 'load_storage.js', 'load_functions.js', 'load_ws.js'];
(async () => {
  for (const s of scripts) {
    await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [path.join(__dirname, s), '--concurrency=10', '--duration=10'], { stdio: 'inherit' });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${s} failed ${code}`))));
    });
  }
})();
