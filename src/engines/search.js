// Google Search engine: what a searcher sees on the normal results page at each grid point.
//   1. Organic SERP (mobile by default) with location_coordinate: map pack, single-business result,
//      AI Overview (text + sources), search ads, Local Services Ads, your organic position.
//   2. Optional Local Finder ("More places") at the same point: your rank beyond the top 3, and finder ads.

import { postLiveTask } from '../dataforseo.js';
import * as mock from '../mock.js';
import { matchesTarget, cleanDomain, parseDistanceKm } from './match.js';

const ORGANIC = '/serp/google/organic/live/advanced';
const FINDER = '/serp/google/local_finder/live/advanced';
const AIO_MAX_CHARS = 6000;

function rating(item) {
  return item.rating ? { rating: item.rating.value ?? null, votes: item.rating.votes_count ?? null } : { rating: null, votes: null };
}

function localListing(item) {
  return {
    title: item.title || '',
    cid: item.cid ? String(item.cid) : null,
    placeId: null,
    domain: item.domain ? cleanDomain(item.domain) : null,
    url: item.url || null,
    ...rating(item),
    category: null,
    description: item.description || null,
    distanceKm: parseDistanceKm(item.description),
    isPaid: Boolean(item.is_paid),
    rankAbsolute: item.rank_absolute ?? null,
  };
}

const itemsOf = (task) => (task && task.result && task.result[0] && task.result[0].items) || [];

/** Parse an organic Live Advanced task into the parts we track. */
export function parseOrganic(task) {
  const items = itemsOf(task).slice().sort((a, b) => (a.rank_absolute ?? 0) - (b.rank_absolute ?? 0));
  const packAll = items.filter((i) => i.type === 'local_pack').map(localListing);
  const pack = packAll.filter((l) => !l.isPaid);
  const packAds = packAll.filter((l) => l.isPaid);

  let single = null;
  if (pack.length === 1) single = pack[0];
  if (!pack.length) {
    const kg = items.find((i) => i.type === 'knowledge_graph' && i.cid);
    if (kg) single = { ...localListing(kg), title: kg.title || '' };
  }

  const ads = [
    ...items.filter((i) => i.type === 'paid').map((i) => ({ title: i.title || i.website_name || '', domain: cleanDomain(i.domain), where: 'search' })),
    ...items
      .filter((i) => i.type === 'local_services')
      .flatMap((i) => i.items || [])
      .map((e) => ({ title: e.title || '', domain: cleanDomain(e.domain), where: 'local_services' })),
    ...packAds.map((l) => ({ title: l.title, domain: l.domain, where: 'map_pack' })),
  ];

  const aioItem = items.find((i) => i.type === 'ai_overview');
  let aio = null;
  if (aioItem) {
    const parts = aioItem.items || [];
    const markdown = (aioItem.markdown || parts.map((p) => p.markdown || p.text || '').join('\n\n') || '').slice(0, AIO_MAX_CHARS);
    const refs = [...(aioItem.references || []), ...parts.flatMap((p) => p.references || [])];
    const seen = new Set();
    const references = [];
    for (const r of refs) {
      const key = r.url || `${r.domain}|${r.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const domain = cleanDomain(r.domain) || cleanDomain(r.url);
      references.push({ source: r.source || null, domain, url: domain ? r.url || null : null, title: r.title || null });
      if (references.length >= 25) break;
    }
    aio = { markdown, references, async: Boolean(aioItem.asynchronous_ai_overview) };
  }

  const organic = items
    .filter((i) => i.type === 'organic')
    .map((i) => ({ rank: i.rank_group, domain: cleanDomain(i.domain), url: i.url || null, title: i.title || '' }));

  return { pack, single, ads, aio, organic };
}

/** Parse a Local Finder Live Advanced task: organic listings re-ranked without ads, plus the ads. */
export function parseFinder(task) {
  const all = itemsOf(task)
    .filter((i) => i.type === 'local_pack')
    .sort((a, b) => (a.rank_absolute ?? 0) - (b.rank_absolute ?? 0))
    .map(localListing);
  let n = 0;
  const list = [];
  const ads = [];
  for (const l of all) {
    if (l.isPaid) ads.push(l);
    else list.push({ ...l, rank: ++n });
  }
  return { list, ads };
}

/** Combine organic + finder into one visible ranking and the per-point record. */
export function combine(organic, finder, target) {
  // Visible ranking: pack (or the single business), then Local Finder continuation.
  const listings = [];
  const keyOf = (l) => l.cid || l.title.toLowerCase();
  const seen = new Set();
  const push = (l) => {
    const k = keyOf(l);
    if (seen.has(k)) return;
    seen.add(k);
    listings.push({ ...l, rank: listings.length + 1 });
  };
  if (organic.single) push(organic.single);
  else organic.pack.forEach(push);
  if (finder) finder.list.forEach(push);

  const hit = listings.find((l) => matchesTarget(l, target));
  const packHit = organic.pack.findIndex((l) => matchesTarget(l, target));
  const singleIsTarget = organic.single ? matchesTarget(organic.single, target) : false;
  const finderHit = finder ? finder.list.find((l) => matchesTarget(l, target)) : null;

  let rankFrom = null;
  if (hit) rankFrom = singleIsTarget ? 'single' : packHit >= 0 ? 'pack' : 'finder';

  // Ads above you in the Local Finder (if fetched), otherwise ads on the results page.
  let adsAboveYou;
  if (finder) {
    const yourAbs = finderHit ? finderHit.rankAbsolute : Infinity;
    adsAboveYou = finder.ads.filter((a) => (a.rankAbsolute ?? 0) < yourAbs).length;
  } else {
    adsAboveYou = organic.ads.length;
  }
  const ads = [...organic.ads, ...(finder ? finder.ads.map((a) => ({ title: a.title, domain: a.domain, where: 'local_finder' })) : [])];

  const targetDomain = cleanDomain(target.domain);
  const organicHit = targetDomain ? organic.organic.find((o) => o.domain === targetDomain) : null;

  return {
    rank: hit ? hit.rank : null,
    rankFrom,
    packSize: organic.single ? 1 : organic.pack.length,
    single: organic.single ? { title: organic.single.title, cid: organic.single.cid, isTarget: singleIsTarget } : null,
    noLocal: !organic.single && organic.pack.length === 0,
    finderRank: finderHit ? finderHit.rank : null,
    distanceKm: hit && hit.distanceKm != null ? hit.distanceKm : null, // Google's displayed distance
    organicRank: organicHit ? organicHit.rank : null,
    listings: listings.slice(0, 20).map(({ rankAbsolute, isPaid, ...l }) => l),
    ads,
    adsAboveYou,
    aio: organic.aio,
  };
}

export const searchEngine = {
  id: 'google_search',
  label: 'Google Search (map pack + AI Overview)',
  description: 'Map pack, single-business results, AI Overview, ads and Local Finder rank on the results page',
  costs: { base: 0.002, aio: 0.002, finderMobile: 0.004, finderDesktop: 0.002 },
  costPerPoint({ aio = true, finder = true, device = 'mobile' } = {}) {
    let c = this.costs.base;
    if (aio) c += this.costs.aio; // refunded by DataForSEO when no AI Overview loads
    if (finder) c += device === 'mobile' ? this.costs.finderMobile : this.costs.finderDesktop; // 20 results
    return Math.round(c * 10000) / 10000;
  },

  async evaluatePoint(p, { demo, env }) {
    const opts = p.options || {};
    let organic;
    let finder = null;
    if (demo) {
      const m = await mock.searchSerp(p);
      organic = m.organic;
      finder = opts.finder ? m.finder : null;
      if (!opts.aio) organic.aio = null;
    } else {
      const organicTask = postLiveTask(env, ORGANIC, {
        keyword: p.keyword,
        location_coordinate: `${p.lat},${p.lng},200`,
        language_code: p.languageCode,
        device: p.device,
        depth: 10,
        load_async_ai_overview: Boolean(opts.aio),
      });
      const finderTask = opts.finder
        ? postLiveTask(env, FINDER, {
            keyword: p.keyword,
            location_coordinate: `${p.lat},${p.lng},${Math.min(18, Math.max(4, p.zoom))}z`,
            language_code: p.languageCode,
            device: p.device,
            depth: 20,
          })
        : null;
      const [o, f] = await Promise.all([organicTask, finderTask]);
      organic = parseOrganic(o);
      finder = f ? parseFinder(f) : null;
    }
    return combine(organic, finder, p.target);
  },

  matchesTarget,
};
