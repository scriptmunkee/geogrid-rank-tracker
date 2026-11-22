// Scan storage: one JSON file per scan in data/scans.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'scans');
fs.mkdirSync(DIR, { recursive: true });

const fileFor = (id) => {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Bad scan id');
  return path.join(DIR, `${id}.json`);
};

function newId() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function save(scan) {
  const file = fileFor(scan.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(scan, null, 2));
  fs.renameSync(tmp, file);
}

function load(id) {
  const file = fileFor(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function list() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
        return {
          id: s.id,
          createdAt: s.createdAt,
          status: s.status,
          demo: s.demo,
          engine: s.engine,
          keyword: s.keyword,
          business: s.target && s.target.title,
          gridSize: s.grid.size,
          summary: s.summary,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = { newId, save, load, list, DIR };
