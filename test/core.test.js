import test from 'node:test';
import assert from 'node:assert';

import { buildGrid } from '../src/grid.js';
import { summarise, competitors } from '../src/metrics.js';
import { mapsEngine, itemsFromTask, matchesTarget } from '../src/engines/maps.js';
import { buildScan, runPoint, finaliseScan } from '../src/scan.js';
import { searchEngine, parseOrganic, parseFinder, combine } from '../src/engines/search.js';
import { namedInAio } from '../src/analysis.js';
import { iodFor } from '../src/area.js';
import { parseDistanceKm, nameKey } from '../src/engines/match.js';

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
  assert.ok(scan.report.insights.length >= 2);
  assert.equal(scan.report.search, null);
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


// ---------- Google Search engine ----------

const organicFixture = {
  result: [{
    items: [
      { type: 'paid', rank_group: 1, rank_absolute: 1, title: 'Ad Co', domain: 'www.adco.co.uk' },
      { type: 'local_services', rank_group: 1, rank_absolute: 2, items: [{ type: 'local_services_element', title: 'LSA Plumbing', domain: 'lsa.co.uk' }] },
      { type: 'ai_overview', rank_group: 1, rank_absolute: 3, asynchronous_ai_overview: true, markdown: 'Options near you:\n\n* **Rapid National Plumbing**: 24/7.\n* **Bravo Plumbing Ltd**: local.\n* **Alpha Plumbing**: reviews.\n\n**What to check:** reviews.',
        items: [{ type: 'ai_overview_element', references: [{ source: 'Yell', domain: 'yell.com', url: 'https://www.yell.com/x', title: 'Yell' }, { source: 'Alpha', domain: 'www.alpha.co.uk', url: 'https://www.alpha.co.uk/', title: 'Alpha' }] }],
        references: [{ source: 'Yell', domain: 'yell.com', url: 'https://www.yell.com/x', title: 'Yell' }] },
      { type: 'local_pack', rank_group: 1, rank_absolute: 4, title: 'Bravo Plumbing', description: '0.5 mi · High St', cid: '2', domain: 'bravo.co.uk', is_paid: false, rating: { value: 4.8, votes_count: 50 } },
      { type: 'local_pack', rank_group: 2, rank_absolute: 5, title: 'Alpha Plumbing', description: '1.2 mi · Low St', cid: '1', domain: 'alpha.co.uk', is_paid: false },
      { type: 'local_pack', rank_group: 3, rank_absolute: 6, title: 'Charlie Plumbing', description: '3 km', cid: '3', is_paid: false },
      { type: 'organic', rank_group: 1, rank_absolute: 7, domain: 'www.alpha.co.uk', url: 'https://www.alpha.co.uk/', title: 'Alpha' },
    ],
  }],
};
const finderFixture = {
  result: [{
    items: [
      { type: 'local_pack', rank_absolute: 1, title: 'Sponsored Co', cid: '9', is_paid: true },
      { type: 'local_pack', rank_absolute: 2, title: 'Bravo Plumbing', cid: '2', is_paid: false },
      { type: 'local_pack', rank_absolute: 3, title: 'Charlie Plumbing', cid: '3', is_paid: false },
      { type: 'local_pack', rank_absolute: 4, title: 'Sponsored Two', cid: '8', is_paid: true },
      { type: 'local_pack', rank_absolute: 5, title: 'Delta Plumbing', cid: '4', is_paid: false },
      { type: 'local_pack', rank_absolute: 6, title: 'Alpha Plumbing', cid: '1', is_paid: false },
    ],
  }],
};

test('search: parses pack, ads, AI Overview and organic from a DataForSEO task', () => {
  const o = parseOrganic(organicFixture);
  assert.deepEqual(o.pack.map((l) => l.title), ['Bravo Plumbing', 'Alpha Plumbing', 'Charlie Plumbing']);
  assert.equal(o.pack[0].distanceKm, 0.8);
  assert.equal(o.single, null);
  assert.deepEqual(o.ads.map((a) => a.where), ['search', 'local_services']);
  assert.equal(o.ads[0].domain, 'adco.co.uk');
  assert.ok(o.aio.markdown.includes('Rapid National'));
  assert.deepEqual(o.aio.references.map((r) => r.domain), ['yell.com', 'alpha.co.uk']);
  assert.equal(o.organic[0].domain, 'alpha.co.uk');
});

test('search: Local Finder drops ads from ranks and counts ads above you', () => {
  const f = parseFinder(finderFixture);
  assert.deepEqual(f.list.map((l) => [l.title, l.rank]), [['Bravo Plumbing', 1], ['Charlie Plumbing', 2], ['Delta Plumbing', 3], ['Alpha Plumbing', 4]]);
  assert.equal(f.ads.length, 2);
  const target = { cid: '4', title: 'Delta Plumbing', domain: 'delta.co.uk' };
  const r = combine(parseOrganic(organicFixture), f, target);
  assert.equal(r.rank, 4); // after the 3-pack
  assert.equal(r.rankFrom, 'finder');
  assert.equal(r.finderRank, 3);
  assert.equal(r.adsAboveYou, 2);
  const r2 = combine(parseOrganic(organicFixture), f, { cid: '1', title: 'Alpha Plumbing', domain: 'alpha.co.uk' });
  assert.equal(r2.rank, 2);
  assert.equal(r2.rankFrom, 'pack');
  assert.equal(r2.organicRank, 1);
  assert.equal(r2.distanceKm, 1.93);
});

test('search: one local result is a single-business (1-Box) point', () => {
  const one = { result: [{ items: [organicFixture.result[0].items[3]] }] };
  const r = combine(parseOrganic(one), null, { cid: '2', title: 'Bravo Plumbing' });
  assert.equal(r.single.title, 'Bravo Plumbing');
  assert.equal(r.single.isTarget, true);
  assert.equal(r.rank, 1);
  assert.equal(r.rankFrom, 'single');
  const none = combine(parseOrganic({ result: [{ items: [] }] }), null, { cid: '2' });
  assert.equal(none.noLocal, true);
  assert.equal(none.rank, null);
});

test('search: cost per point', () => {
  assert.equal(searchEngine.costPerPoint({ aio: true, finder: true, device: 'mobile' }), 0.008);
  assert.equal(searchEngine.costPerPoint({ aio: false, finder: false }), 0.002);
  assert.equal(searchEngine.costPerPoint({ aio: true, finder: true, device: 'desktop' }), 0.006);
});

test('ai: local names found in order, sentence by sentence', () => {
  const known = new Map([[nameKey('Alpha Plumbing'), 'Alpha Plumbing'], [nameKey('Bravo Plumbing'), 'Bravo Plumbing']]);
  const named = namedInAio(organicFixture.result[0].items[2].markdown, known, { keyword: 'plumber' });
  assert.deepEqual(named.map((n) => n.title), ['Bravo Plumbing', 'Alpha Plumbing']);
});

test('ai: real-world cases from live scans', () => {
  // Local AI answer naming businesses in bold, with citation markers
  const local = '**Dixon Digital Marketing Ltd** operates as a dedicated **marketing consultant** nearby, while **Right Hook - Marketing Agency** and **Stick Marketing** are full agencies.[[1]](https://google.com/goto?url=x)';
  const known = new Map(['Dixon Digital Marketing Ltd', 'Right Hook - Marketing Agency', 'Stick Marketing', 'UK AI SEO Consultant', 'Ascend Digital Marketing'].map((t) => [nameKey(t), t]));
  assert.deepEqual(namedInAio(local, known, { keyword: 'seo consultant' }).map((n) => n.title), ['Dixon Digital Marketing Ltd', 'Right Hook - Marketing Agency', 'Stick Marketing']);

  // Generic answer: a listing called "UK AI SEO Consultant" must not match prose about AI SEO consultants
  const generic = '#### Notable Consultants\n- **Independent Consultants:** Specialists such as Luca Tagliaferro (focusing on AI search in the UK) and Chris Raulf.\n- **UK Agencies:** Agencies offering AI SEO include Found, Envisage Digital, Sherbet Donkey.\n#### How do you measure AI visibility?\nAn AI SEO consultant helps businesses get cited.';
  const named = namedInAio(generic, known, { keyword: 'ai seo consultant', sources: ['Luca Tagliaferro', 'Chris Raulf', 'Envisage Digital', 'YouTube', 'Digital Marketing Agency London'] });
  const titles = named.map((n) => n.title);
  assert.deepEqual(titles, ['Luca Tagliaferro', 'Chris Raulf', 'Envisage Digital']);
  assert.ok(named.every((n) => !n.local));
  assert.ok(!titles.includes('UK AI SEO Consultant'));

  // ...but an exact-case mention of a keyword-named business still counts
  assert.equal(namedInAio('Try UK AI SEO Consultant for audits.', known, { keyword: 'ai seo consultant' })[0].title, 'UK AI SEO Consultant');
});

test('search: Google viewer and redirect links are not websites', () => {
  const o = parseOrganic({ result: [{ items: [
    { type: 'local_pack', rank_absolute: 1, title: 'Power SEO', cid: '5', domain: 'google.com', url: 'https://www.google.com/searchviewer/10', is_paid: false },
    { type: 'ai_overview', rank_absolute: 2, markdown: 'x', references: [{ source: 'Envisage Digital', domain: 'google.com', url: 'https://google.com/goto?url=abc' }, { source: 'Found', domain: 'found.co.uk', url: 'https://found.co.uk/' }] },
  ] }] });
  assert.equal(o.single.domain, null);
  assert.deepEqual(o.aio.references.map((r) => [r.source, r.domain]), [['Envisage Digital', null], ['Found', 'found.co.uk']]);
});

test('area: IoD 2025 lookup and distance parsing', () => {
  const d = iodFor('E01000001');
  assert.ok(d.imdDecile >= 1 && d.imdDecile <= 10 && d.population > 0);
  assert.equal(iodFor('W01000001'), null);
  assert.equal(parseDistanceKm('2 mi · x'), 3.22);
  assert.equal(parseDistanceKm('850 m'), 0.85);
  assert.equal(parseDistanceKm('no distance'), null);
});

test('search scan: demo end to end builds the full report', async () => {
  const [target] = await mapsEngine.findBusiness({ query: 'Ascend Digital Marketing', lat: 54.7761, lng: -1.5733 }, { demo: true });
  const { scan, points } = buildScan(
    { engine: 'google_search', keyword: 'seo consultant', target, lat: 54.7761, lng: -1.5733, size: 5, spacing: 1, options: { aio: true, finder: true } },
    { demo: true, engine: searchEngine },
  );
  assert.equal(scan.device, 'mobile');
  let i = 0;
  for (const p of points) {
    await runPoint(scan, p, searchEngine, {}, { areaLookup: () => Promise.resolve({ lsoa: 'E01034493', population: 1500, incomeDecile: 1 + (i++ % 10), imdDecile: 5 }) });
  }
  finaliseScan(scan, points, searchEngine);
  const r = scan.report;
  assert.equal(scan.status, 'done');
  assert.ok(r.search.ai.shownAt > 0);
  assert.ok(r.search.ai.named.length > 0);
  assert.ok(r.affluence && r.affluence.weightedSolv != null);
  assert.ok(points.every((p) => p.ai));
  assert.ok(r.competitors.some((c) => c.isTarget && c.aiNamedAt != null));
  assert.ok(r.insights.some((x) => x.kind === 'ai'));
});

test('ai: a cited website is matched to a local business by name', async () => {
  const { buildReport } = await import('../src/analysis.js');
  const scan = { engine: 'google_search', depth: 20, keyword: 'ai seo consultant', options: { aio: true }, grid: { lat: 54, lng: -1, unit: 'km' },
    target: { title: 'Ascend Digital Marketing', cid: '1', domain: 'ascenddigitalmarketing.co.uk', lat: 54, lng: -1 } };
  const points = [{ lat: 54, lng: -1, rank: 2, listings: [{ rank: 1, title: 'UK AI SEO Consultant', cid: '7', domain: null }, { rank: 2, title: 'Ascend Digital Marketing', cid: '1' }],
    aio: { markdown: 'Some text.', references: [{ source: 'UK AI SEO', domain: 'ukaiseoconsultant.co.uk' }, { source: 'Yell', domain: 'yell.com' }, { source: 'www.example.com', domain: null }] } }];
  const r = buildReport(scan, points, { matchesTarget: () => false });
  const cats = Object.fromEntries(r.search.ai.sources.map((x) => [x.domain, x.category]));
  assert.equal(cats['ukaiseoconsultant.co.uk'], 'competitor');
  assert.equal(cats['yell.com'], 'directory');
  assert.ok('example.com' in cats);
});
