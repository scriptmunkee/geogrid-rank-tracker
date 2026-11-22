// Runs a scan: builds the grid, searches every point, scores the result.

const { buildGrid } = require('./grid');
const { getEngine } = require('./engines');
const { mapLimit, hasCredentials } = require('./dataforseo');
const { summarise, competitors } = require('./metrics');
const store = require('./store');

const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || 5);

function validate(input) {
  const keyword = String(input.keyword || '').trim();
  if (!keyword) throw new Error('Keyword is required');
  if (!input.target || !(input.target.cid || input.target.placeId || input.target.title)) {
    throw new Error('Pick a business to track');
  }
  const zoom = Number(input.zoom ?? 13);
  if (!Number.isInteger(zoom) || zoom < 3 || zoom > 21) throw new Error('Zoom must be 3 to 21');
  const depth = Number(input.depth ?? 20);
  if (!Number.isInteger(depth) || depth < 1 || depth > 100) throw new Error('Depth must be 1 to 100');
  return { keyword, zoom, depth };
}

/** Create a scan record and start it in the background. Returns the scan (status "running"). */
function startScan(input) {
  const { keyword, zoom, depth } = validate(input);
  const engine = getEngine(input.engine || 'google_maps');
  const demo = input.demo === true || !hasCredentials();
  const grid = {
    lat: Number(input.lat),
    lng: Number(input.lng),
    size: Number(input.size),
    spacing: Number(input.spacing),
    unit: input.unit === 'mi' ? 'mi' : 'km',
    zoom,
  };
  const points = buildGrid(grid);

  const t = input.target;
  const scan = {
    id: store.newId(),
    createdAt: new Date().toISOString(),
    status: 'running',
    demo,
    engine: engine.id,
    keyword,
    languageCode: input.languageCode || process.env.DEFAULT_LANGUAGE || 'en',
    device: input.device === 'mobile' ? 'mobile' : 'desktop',
    depth,
    target: {
      title: t.title || null,
      cid: t.cid ? String(t.cid) : null,
      placeId: t.placeId || null,
      domain: t.domain || null,
      address: t.address || null,
      lat: t.lat ?? null,
      lng: t.lng ?? null,
    },
    grid,
    estCost: demo ? 0 : Math.round(points.length * engine.costPerPoint * 1000) / 1000,
    progress: { done: 0, total: points.length },
    results: points.map((p) => ({ ...p, rank: null, listings: [], error: null })),
    summary: null,
    competitors: [],
  };
  store.save(scan);
  run(scan, engine).catch((err) => {
    scan.status = 'failed';
    scan.error = err.message;
    store.save(scan);
  });
  return scan;
}

async function run(scan, engine) {
  let sinceSave = 0;
  await mapLimit(scan.results, CONCURRENCY, async (point) => {
    try {
      const listings = await engine.searchPoint(
        {
          keyword: scan.keyword,
          lat: point.lat,
          lng: point.lng,
          zoom: scan.grid.zoom,
          depth: scan.depth,
          languageCode: scan.languageCode,
          device: scan.device,
        },
        { demo: scan.demo },
      );
      point.listings = listings.slice(0, scan.depth);
      const hit = point.listings.find((l) => engine.matchesTarget(l, scan.target));
      point.rank = hit ? hit.rank : null;
    } catch (err) {
      point.error = err.message;
      if (err.code === 'auth' || err.code === 'no_credentials') throw err; // no point carrying on
    }
    scan.progress.done++;
    if (++sinceSave >= 5) {
      sinceSave = 0;
      store.save(scan);
    }
  });

  scan.summary = summarise(scan.results, scan.depth);
  scan.competitors = competitors(scan.results, scan.depth, engine.matchesTarget, scan.target);
  scan.status = scan.summary.scanned === 0 ? 'failed' : 'done';
  if (scan.status === 'failed') scan.error = scan.results.find((r) => r.error)?.error || 'No points returned data';
  scan.finishedAt = new Date().toISOString();
  store.save(scan);
  return scan;
}

module.exports = { startScan, run };
