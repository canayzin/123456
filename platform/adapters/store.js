const fs = require('fs');
const path = require('path');
const logger = require('../../observability/logger');

class FileStore {
  readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
  writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
}

class MemoryStore {
  constructor() { this.map = new Map(); }
  readJson(file, fallback = null) { return this.map.has(file) ? this.map.get(file) : fallback; }
  writeJson(file, value) { this.map.set(file, value); }
}

class StubPostgresStore {
  readJson(file, fallback = null) { logger.warn('StubPostgresStore.readJson not implemented', { file }); return fallback; }
  writeJson(file) { logger.warn('StubPostgresStore.writeJson not implemented', { file }); }
}

class FileBlobStore {
  read(file) { try { return fs.readFileSync(file); } catch { return Buffer.alloc(0); } }
  write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
}

class FileLogStore {
  append(file, line) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `${line}\n`); }
  readLines(file) { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; } }
}

module.exports = { FileStore, MemoryStore, StubPostgresStore, FileBlobStore, FileLogStore };
