// GeoGrid Rank Tracker: Cloudflare Worker entry point.
// Static UI is served from /public by Workers Assets; this handles /api/*.

import { ScanStore } from './scan-store.js';
import { getEngine, listEngines } from './engines/index.js';
import { hasCredentials } from './dataforseo.js';
import { buildGrid } from './grid.js';

export { ScanStore };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function defaults(env) {
  return {
    lat: Number(env.DEFAULT_LAT || 54.7761),
    lng: Number(env.DEFAULT_LNG || -1.5733),
    locationName: env.DEFAULT_LOCATION || 'United Kingdom',
    languageCode: env.DEFAULT_LANGUAGE || 'en',
  };
}

/** Live scans need both DataForSEO keys and an app password, so the URL can't spend credit on its own. */
const liveEnabled = (env) => hasCredentials(env) && Boolean(env.APP_PASSWORD);

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

async function authorised(request, env) {
  if (!env.APP_PASSWORD) return true; // no password set: API is open but demo-only
  const header = request.headers.get('Authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [a, b] = await Promise.all([sha256(given), sha256(env.APP_PASSWORD)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const store = (env) => env.SCANS.get(env.SCANS.idFromName('global'));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (p === '/api/config' && request.method === 'GET') {
        return json({
          live: liveEnabled(env),
          hasCredentials: hasCredentials(env),
          authRequired: Boolean(env.APP_PASSWORD),
          engines: listEngines(),
          defaults: defaults(env),
        });
      }

      if (!(await authorised(request, env))) return json({ error: 'Password required' }, 401);

      if (p === '/api/auth-check') return json({ ok: true });

      if (p === '/api/business-search' && request.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
        if (!q) return json({ error: 'Enter a business name' }, 400);
        const demo = url.searchParams.get('demo') === '1' || !liveEnabled(env);
        const d = defaults(env);
        const results = await getEngine('google_maps').findBusiness(
          {
            query: q,
            lat: parseFloat(url.searchParams.get('lat')),
            lng: parseFloat(url.searchParams.get('lng')),
            locationName: d.locationName,
            languageCode: d.languageCode,
          },
          { demo, env },
        );
        return json({ demo, results: results.slice(0, 10) });
      }

      if (p === '/api/grid-preview' && request.method === 'POST') {
        const b = await request.json();
        return json({ points: buildGrid({ lat: +b.lat, lng: +b.lng, size: +b.size, spacing: +b.spacing, unit: b.unit }) });
      }

      if (p === '/api/scans' && request.method === 'GET') {
        return json({ scans: await store(env).listScans() });
      }

      if (p === '/api/scans' && request.method === 'POST') {
        const input = await request.json();
        const demo = input.demo === true || !liveEnabled(env);
        return json(await store(env).createScan(input, { demo, defaults: defaults(env) }), 202);
      }

      const m = p.match(/^\/api\/scans\/([a-z0-9-]+)$/i);
      if (m && request.method === 'GET') {
        const scan = await store(env).getScan(m[1]);
        return scan ? json(scan) : json({ error: 'Scan not found' }, 404);
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message || 'Something went wrong' }, 400);
    }
  },
};
