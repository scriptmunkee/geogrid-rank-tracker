const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'geogrid-'));
delete process.env.DATAFORSEO_LOGIN;
delete process.env.DATAFORSEO_PASSWORD;

const { buildGrid } = require('../lib/grid');
const { summarise, competitors } = require('../lib/metrics');
const maps = require('../lib/engines/maps');
const { startScan } = require('../lib/scanner');
const store = require('../lib/store');

test('grid: 7x7 at 1 km has 49 points, centre in the middle, 1 km steps', () => {
  const pts = buildGrid({ lat: 54.7761, lng: -1.5733, size: 7, spacing: 1 });
  assert.equal(pts.length, 49);
  const mid = pts.find((p) => p.row === 3 && p.col === 3);
  assert.equal(mid.lat, 54.7761);
  assert.equal(mid.lng, -1.5733);
  assert.equal(mid.distanceKm, 0);
  const east = pts.find((p) => p.row === 3 && p.col === 4);
  assert.equal(east.distanceKm, 1);
  const north = pts.find((p) => p.row === 2 && p.col === 3);
  assert.ok(north.lat > mid.lat);
  // corner is sqrt(18) km away
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
          { type: 'maps_search', rank_group: 1, rank_absolute: 1, title: 'A Ltd', cid: 111, place_id: 'p1', domain: 'a.com', rating: { value: 4.5, votes_count: 10 }, latitude: 1, longitude: 2 },
          { type: 'maps_paid_item', rank_group: 1, title: 'Advert' },
          { type: 'maps_search', rank_group: 2, rank_absolute: 3, title: 'B Ltd', cid: '222', place_id: 'p2' },
        ],
      },
    ],
  };
  const items = maps.itemsFromTask(task);
  assert.equal(items.length, 2);
  assert.equal(items[0].cid, '111');
  assert.equal(items[0].rating, 4.5);
  assert.equal(items[1].rank, 2);
  assert.ok(maps.matchesTarget(items[1], { cid: '222' }));
  assert.ok(!maps.matchesTarget(items[0], { cid: '222' }));
  assert.ok(maps.matchesTarget({ title: 'B  Ltd.' }, { title: 'b ltd' }));
});

test('competitors: target flagged and sorted by SoLV', () => {
  const grid = [
    { listings: [{ rank: 1, title: 'X', cid: '1' }, { rank: 2, title: 'T', cid: '9' }] },
    { listings: [{ rank: 1, title: 'X', cid: '1' }] },
  ];
  const rows = competitors(grid, 20, maps.matchesTarget, { cid: '9' });
  assert.equal(rows[0].title, 'X');
  assert.equal(rows[0].solv, 100);
  const t = rows.find((r) => r.isTarget);
  assert.equal(t.found, 1);
  assert.equal(t.atrp, (2 + 21) / 2);
});

test('scanner: demo scan runs end to end and saves', async () => {
  const [target] = await maps.findBusiness({ query: 'Ascend Digital Marketing', lat: 54.7761, lng: -1.5733 }, { demo: true });
  const scan = startScan({ keyword: 'seo consultant', target, lat: 54.7761, lng: -1.5733, size: 5, spacing: 1, unit: 'km' });
  assert.equal(scan.demo, true);
  for (let i = 0; i < 100; i++) {
    const s = store.load(scan.id);
    if (s.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const done = store.load(scan.id);
  assert.equal(done.status, 'done');
  assert.equal(done.summary.scanned, 25);
  assert.ok(done.summary.found > 0);
  assert.ok(done.competitors.some((c) => c.isTarget));
});
