// GeoGrid Rank Tracker: local server (no dependencies).

const fs = require('fs');
const path = require('path');
const http = require('http');

loadEnv(path.join(__dirname, '.env'));

const store = require('./lib/store');
const { startScan } = require('./lib/scanner');
const { getEngine, listEngines } = require('./lib/engines');
const { hasCredentials } = require('./lib/dataforseo');
const { buildGrid } = require('./lib/grid');

const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw new Error('Body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === '/api/config' && req.method === 'GET') {
      return send(res, 200, {
        hasCredentials: hasCredentials(),
        engines: listEngines(),
        defaults: {
          lat: Number(process.env.DEFAULT_LAT || 54.7761),
          lng: Number(process.env.DEFAULT_LNG || -1.5733),
          locationName: process.env.DEFAULT_LOCATION || 'United Kingdom',
          languageCode: process.env.DEFAULT_LANGUAGE || 'en',
        },
      });
    }

    if (p === '/api/business-search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return send(res, 400, { error: 'Enter a business name' });
      const lat = parseFloat(url.searchParams.get('lat'));
      const lng = parseFloat(url.searchParams.get('lng'));
      const demo = url.searchParams.get('demo') === '1' || !hasCredentials();
      const results = await getEngine('google_maps').findBusiness(
        {
          query: q,
          lat,
          lng,
          locationName: process.env.DEFAULT_LOCATION || 'United Kingdom',
          languageCode: process.env.DEFAULT_LANGUAGE || 'en',
        },
        { demo },
      );
      return send(res, 200, { demo, results: results.slice(0, 10) });
    }

    if (p === '/api/grid-preview' && req.method === 'POST') {
      const b = await readJson(req);
      return send(res, 200, { points: buildGrid({ lat: +b.lat, lng: +b.lng, size: +b.size, spacing: +b.spacing, unit: b.unit }) });
    }

    if (p === '/api/scans' && req.method === 'GET') return send(res, 200, { scans: store.list() });

    if (p === '/api/scans' && req.method === 'POST') {
      const scan = startScan(await readJson(req));
      return send(res, 202, { id: scan.id, demo: scan.demo, estCost: scan.estCost });
    }

    const m = p.match(/^\/api\/scans\/([a-z0-9-]+)$/i);
    if (m && req.method === 'GET') {
      const scan = store.load(m[1]);
      return scan ? send(res, 200, scan) : send(res, 404, { error: 'Scan not found' });
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    return serveStatic(req, res, p);
  } catch (err) {
    return send(res, 400, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`GeoGrid Rank Tracker running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(hasCredentials() ? 'DataForSEO credentials found: live scans enabled' : 'No DataForSEO credentials: demo mode only');
});
