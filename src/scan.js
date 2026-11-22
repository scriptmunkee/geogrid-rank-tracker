// Scan lifecycle helpers, independent of storage.

import { buildGrid } from './grid.js';
import { summarise, competitors } from './metrics.js';

function newId() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const rand = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${stamp}-${rand}`;
}

/** Validate input and build the scan record plus its grid points. */
export function buildScan(input, { demo, engine, defaults = {} }) {
  const keyword = String(input.keyword || '').trim();
  if (!keyword) throw new Error('Keyword is required');
  if (keyword.length > 200) throw new Error('Keyword is too long');
  const t = input.target;
  if (!t || !(t.cid || t.placeId || t.title)) throw new Error('Pick a business to track');
  const zoom = Number(input.zoom ?? 13);
  if (!Number.isInteger(zoom) || zoom < 3 || zoom > 21) throw new Error('Zoom must be 3 to 21');
  const depth = Number(input.depth ?? 20);
  if (!Number.isInteger(depth) || depth < 1 || depth > 100) throw new Error('Depth must be 1 to 100');

  const grid = {
    lat: Number(input.lat),
    lng: Number(input.lng),
    size: Number(input.size),
    spacing: Number(input.spacing),
    unit: input.unit === 'mi' ? 'mi' : 'km',
    zoom,
  };
  const points = buildGrid(grid).map((p) => ({ ...p, rank: null, listings: [], error: null }));

  const scan = {
    id: newId(),
    createdAt: new Date().toISOString(),
    status: 'running',
    demo,
    engine: engine.id,
    keyword,
    languageCode: input.languageCode || defaults.languageCode || 'en',
    device: input.device === 'mobile' ? 'mobile' : 'desktop',
    depth,
    target: {
      title: t.title ? String(t.title).slice(0, 200) : null,
      cid: t.cid ? String(t.cid) : null,
      placeId: t.placeId || null,
      domain: t.domain || null,
      address: t.address || null,
      lat: Number.isFinite(t.lat) ? t.lat : null,
      lng: Number.isFinite(t.lng) ? t.lng : null,
    },
    grid,
    estCost: demo ? 0 : Math.round(points.length * engine.costPerPoint * 1000) / 1000,
    summary: null,
    competitors: [],
    error: null,
    finishedAt: null,
  };
  return { scan, points };
}

/** Search one point and record the target's rank. Mutates and returns the point. */
export async function runPoint(scan, point, engine, env) {
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
        centre: { lat: scan.grid.lat, lng: scan.grid.lng },
        target: scan.target,
      },
      { demo: scan.demo, env },
    );
    point.listings = listings.slice(0, scan.depth);
    const hit = point.listings.find((l) => engine.matchesTarget(l, scan.target));
    point.rank = hit ? hit.rank : null;
    point.error = null;
  } catch (err) {
    point.error = err.message || 'Search failed';
    point.fatal = err.code === 'auth' || err.code === 'no_credentials';
  }
  return point;
}

/** Score a finished scan. Mutates and returns the scan. */
export function finaliseScan(scan, points, engine) {
  scan.summary = summarise(points, scan.depth);
  scan.competitors = competitors(points, scan.depth, engine.matchesTarget, scan.target);
  scan.status = scan.summary.scanned === 0 ? 'failed' : 'done';
  if (scan.status === 'failed') scan.error = scan.error || points.find((p) => p.error)?.error || 'No points returned data';
  scan.finishedAt = new Date().toISOString();
  return scan;
}
