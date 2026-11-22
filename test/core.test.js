import test from 'node:test';
import assert from 'node:assert';

import { buildGrid } from '../src/grid.js';
import { summarise, competitors } from '../src/metrics.js';
import { mapsEngine, itemsFromTask, matchesTarget } from '../src/engines/maps.js';
import { buildScan, runPoint, finaliseScan } from '../src/scan.js';

test('grid: 7x7 at 1 km has 49 points, centre in the middle, 1 km steps', () => {
  const pts = buildGrid({ lat: 54.7761, lng: -1.5733, size: 7, spacing: 1 });
  assert.equal(pts.length, 49);
  const mid = pts.find((p) => p.row === 3 && p.col === 3);
  assert.equal(mid.lat, 54.7761);
  assert.equal(mid.lng, -1.5733);
  assert.equal(mid.distanceKm, 0);
  assert.equal(pts.find((p) => p.row === 3 && p.col === 4).distanceKm, 1);
  assert.ok(pts.find((p) => p.row === 2 && p.col === 3).lat > mid.lat);
  assert.equal(pts[0].distanceKm, Math.round(Math.hypot(3, 3) * 100) / 100);
});

test('grid: miles convert and bad sizes are rejected', () => {
  const pts = buildGrid({ lat: 40, lng: -75, size: 3, spacing: 1, unit: 'mi' });
  assert.equal(pts.find((p) => p.row === 1 && p.col === 2).distanceKm, 1.61);
  assert.throws(() => buildGrid({ lat: 40, lng: -75, size: 4, spacing: 1 }));
  assert.throws(() => buildGrid({ lat: 40, lng: -75, size: 17, spacing: 1 }));
});

test('metrics: ARP, ATRP, SoLV', () => {
  const s = summarise([{ rank: 1 }, { rank: 3 }, { rank: 8 }, { rank: null }, { rank: null, error: 'x' }], 20);
  assert.equal(s.scanned, 4);
  assert.equal(s.found, 3);
  assert.equal(s.arp, 4);
  assert.equal(s.atrp, (1 + 3 + 8 + 21) / 4);
  assert.equal(s.solv, 50);
  assert.equal(s.errors, 1);
});

test('maps engine: parses a DataForSEO task and matches by CID', () => {
  const task = {
    status_code: 20000,
    result: [
      {
        items: [
          { type: 'maps_search', rank_group: 1, title: 'A Ltd', cid: 111, place_id: 'p1', domain: 'a.com', rating: { value: 4.5, votes_count: 10 }, latitude: 1, longitude: 2 },
          { type: 'maps_paid_item', rank_group: 1, title: 'Advert' },
          { type: 'maps_search', rank_group: 2, title: 'B Ltd', cid: '222', place_id: 'p2' },
        ],
      },
    ],
  };
  const items = itemsFromTask(task);
  assert.equal(items.length, 2);
  assert.equal(items[0].cid, '111');
  assert.equal(items[0].rating, 4.5);
  assert.equal(items[1].rank, 2);
  assert.ok(matchesTarget(items[1], { cid: '222' }));
  assert.ok(!matchesTarget(items[0], { cid: '222' }));
  assert.ok(matchesTarget({ title: 'B  Ltd.' }, { title: 'b ltd' }));
});

test('competitors: target flagged and sorted by SoLV', () => {
  const grid = [
    { listings: [{ rank: 1, title: 'X', cid: '1' }, { rank: 2, title: 'T', cid: '9' }] },
    { listings: [{ rank: 1, title: 'X', cid: '1' }] },
  ];
  const rows = competitors(grid, 20, matchesTarget, { cid: '9' });
  assert.equal(rows[0].title, 'X');
  assert.equal(rows[0].solv, 100);
  const t = rows.find((r) => r.isTarget);
  assert.equal(t.found, 1);
  assert.equal(t.atrp, (2 + 21) / 2);
});

test('scan: demo scan builds, runs every point and scores', async () => {
  const [target] = await mapsEngine.findBusiness({ query: 'Ascend Digital Marketing', lat: 54.7761, lng: -1.5733 }, { demo: true });
  const { scan, points } = buildScan(
    { keyword: 'seo consultant', target, lat: 54.7761, lng: -1.5733, size: 5, spacing: 1, unit: 'km' },
    { demo: true, engine: mapsEngine },
  );
  assert.equal(points.length, 25);
  assert.equal(scan.estCost, 0);
  for (const p of points) await runPoint(scan, p, mapsEngine, {});
  finaliseScan(scan, points, mapsEngine);
  assert.equal(scan.status, 'done');
  assert.equal(scan.summary.scanned, 25);
  assert.ok(scan.summary.found > 0);
  assert.ok(scan.competitors.some((c) => c.isTarget));
});

test('scan: live mode without credentials fails the point as fatal', async () => {
  const { scan, points } = buildScan(
    { keyword: 'x', target: { cid: '1' }, lat: 54, lng: -1, size: 3, spacing: 1 },
    { demo: false, engine: mapsEngine },
  );
  assert.equal(scan.estCost, 0.018);
  await runPoint(scan, points[0], mapsEngine, {});
  assert.ok(points[0].fatal);
});

test('scan: rejects bad input', () => {
  assert.throws(() => buildScan({ keyword: '', target: { cid: '1' } }, { demo: true, engine: mapsEngine }), /Keyword/);
  assert.throws(() => buildScan({ keyword: 'x' }, { demo: true, engine: mapsEngine }), /business/);
});
