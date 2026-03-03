const fs = require('fs');
const path = require('path');

class WriteAheadLog {
  constructor(filePath = path.join(process.cwd(), 'data', 'docdb.wal.log')) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '');
  }

  append(entry) {
    fs.appendFileSync(this.filePath, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
  }

  replay() {
    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line));
  }
}

module.exports = { WriteAheadLog };
