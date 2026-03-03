const fs = require('fs');
const path = require('path');

function releasesFile(projectId, siteId) {
  const dir = path.join(process.cwd(), 'data', 'hosting', 'releases', projectId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${siteId}.ndjson`);
}

function appendRelease(projectId, siteId, entry) {
  fs.appendFileSync(releasesFile(projectId, siteId), `${JSON.stringify(entry)}\n`);
}

function readReleases(projectId, siteId) {
  try {
    return fs.readFileSync(releasesFile(projectId, siteId), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
  } catch {
    return [];
  }
}

module.exports = { appendRelease, readReleases };
