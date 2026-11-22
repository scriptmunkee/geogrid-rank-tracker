// Builds the full scan report: rank metrics, competitors, winning radius, affluence-weighted SoLV,
// and for the Google Search engine: single-business results, AI Overview names and citations, ads.

import { summarise } from './metrics.js';
import { nameKey, cleanDomain, matchesTarget } from './engines/match.js';

const DIRECTORY_DOMAINS = new Set([
  'yell.com', 'checkatrade.com', 'trustatrade.com', 'bark.com', 'ratedpeople.com', 'mybuilder.com', 'facebook.com',
  'instagram.com', 'linkedin.com', 'yelp.com', 'yelp.co.uk', 'tripadvisor.com', 'tripadvisor.co.uk', 'thomsonlocal.com',
  'freeindex.co.uk', 'cylex-uk.co.uk', 'scoot.co.uk', 'trustpilot.com', 'google.com', 'reddit.com', 'youtube.com',
  'nextdoor.co.uk', 'nextdoor.com', 'houzz.co.uk', 'which.co.uk', 'clutch.co', 'sortlist.co.uk', 'designrush.com',
  'angi.com', 'thumbtack.com', 'bbb.org', 'wikipedia.org', 'gov.uk',
]);

const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (a, b) => (b ? round((a / b) * 100, 1) : null);

function km(a, b) {
  const dy = (a.lat - b.lat) * 111.32;
  const dx = (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

const keyOf = (l) => l.cid || nameKey(l.title);

/** Weight a point by how many better-off residents it represents (England only). */
function affluenceWeight(p) {
  const a = p.area;
  if (!a || !a.population || !a.incomeDecile) return null;
  return a.population * a.incomeDecile;
}

// ---------- AI Overview text analysis ----------

export const REPORT_VERSION = 3;

const PLATFORMS = new Set(['youtube', 'google', 'reddit', 'facebook', 'linkedin', 'wikipedia', 'instagram', 'tiktok', 'twitter', 'quora', 'medium', 'x', 'yelp', 'yell', 'trustpilot', 'gov uk']);
const FILLER = new Set(['uk', 'local', 'best', 'top', 'near', 'me', 'the', 'and', 'services', 'service', 'company', 'specialist', 'specialists', 'expert', 'experts', 'in', 'of', 'for']);

/** Plain text of an AI Overview, split into sentence-like segments (names never span two). */
export function aioSegments(markdown) {
  const plain = String(markdown || '')
    .replace(/\[\[\d+\]\]\([^)]*\)/g, ' ') // citation markers
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
    .replace(/[`*#>_]/g, ' ');
  return plain
    .split(/[.!?;:\n()|]+/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Find which businesses an AI Overview names, in the order it names them.
 * knownNames: Map(nameKey -> title) of every business seen in the local results.
 * sources: AI Overview reference source names (catches businesses that aren't in the local results).
 * keyword: the scan keyword; a name made only of keyword words must match with exact capitalisation.
 */
export function namedInAio(markdown, knownNames, { sources = [], keyword = '' } = {}) {
  const segs = aioSegments(markdown);
  const segKeys = segs.map((x) => ` ${nameKey(x)} `);
  const kwTokens = new Set(nameKey(keyword).split(' ').filter(Boolean));
  const found = new Map();

  const locate = (title, key) => {
    const tokens = key.split(' ').filter(Boolean);
    const generic = tokens.every((t) => kwTokens.has(t) || FILLER.has(t));
    for (let i = 0; i < segs.length; i++) {
      if (generic) {
        const j = segs[i].indexOf(title.replace(/\s+/g, ' ').trim());
        if (j >= 0) return i * 10000 + j;
      } else {
        const j = segKeys[i].indexOf(` ${key} `);
        if (j >= 0) return i * 10000 + j;
      }
    }
    return -1;
  };

  for (const [key, title] of knownNames) {
    if (key.length < 4 || found.has(key)) continue;
    const pos = locate(title, key);
    if (pos >= 0) found.set(key, { title, pos, local: true });
  }
  for (const src of sources) {
    const key = nameKey(src);
    if (!key || key.length < 4 || PLATFORMS.has(key) || found.has(key)) continue;
    if ([...found.keys()].some((k) => k.includes(key) || key.includes(k))) continue;
    const pos = locate(src, key);
    if (pos >= 0) found.set(key, { title: src, pos, local: false });
  }
  return [...found.entries()].sort((a, b) => a[1].pos - b[1].pos).map(([key, v]) => ({ key, title: v.title, local: v.local }));
}

const compact = (s) => nameKey(s).replace(/ /g, '');

/** Does a website look like it belongs to this business name? (ukaiseoconsultant.co.uk ~ "UK AI SEO Consultant") */
function domainMatchesName(domain, title) {
  const base = String(domain || '').split('.')[0].replace(/[^a-z0-9]/g, '');
  if (base.length < 5) return false;
  const raw = String(title || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  return [compact(title), raw].some((name) => name.length >= 5 && (base === name || base.startsWith(name) || name.startsWith(base)));
}

function domainCategory(domain, targetDomain, competitorDomains, { targetTitle, competitorTitles = [] } = {}) {
  if (!domain) return 'other';
  if (targetDomain && (domain === targetDomain || domain.endsWith(`.${targetDomain}`))) return 'you';
  if (targetTitle && domainMatchesName(domain, targetTitle)) return 'you';
  if (DIRECTORY_DOMAINS.has(domain) || [...DIRECTORY_DOMAINS].some((d) => domain.endsWith(`.${d}`))) return 'directory';
  if (competitorDomains.has(domain)) return 'competitor';
  if (competitorTitles.some((t) => domainMatchesName(domain, t))) return 'competitor';
  return 'other';
}

// ---------- Report ----------

export function buildReport(scan, points, engine) {
  const depth = scan.depth;
  const target = scan.target;
  const isSearch = scan.engine === 'google_search';
  const valid = points.filter((p) => !p.error);
  const n = valid.length;
  const origin = target.lat != null && target.lng != null ? target : scan.grid;

  for (const p of points) p.distFromBusinessKm = round(km(p, origin));

  const summary = summarise(points, depth);
  const rankOf = (p) => p.rank;

  // Rank distribution
  const distribution = { first: 0, top3: 0, top10: 0, beyond: 0, notFound: 0 };
  for (const p of valid) {
    const r = rankOf(p);
    if (r == null) distribution.notFound++;
    else if (r === 1) distribution.first++;
    else if (r <= 3) distribution.top3++;
    else if (r <= 10) distribution.top10++;
    else distribution.beyond++;
  }

  // Who holds #1
  const firstCounts = new Map();
  for (const p of valid) {
    const top = p.listings && p.listings[0];
    if (!top) continue;
    const k = keyOf(top);
    const row = firstCounts.get(k) || { title: top.title, points: 0, isTarget: matchesTarget(top, target) };
    row.points++;
    firstCounts.set(k, row);
  }
  const holdsFirst = [...firstCounts.values()].sort((a, b) => b.points - a.points).slice(0, 10);

  // Competitor table
  const byKey = new Map();
  const weights = valid.map(affluenceWeight);
  const totalWeight = weights.reduce((s, w) => s + (w || 0), 0);
  const areaCoverage = weights.filter((w) => w != null).length;
  valid.forEach((p, i) => {
    for (const l of p.listings || []) {
      const k = keyOf(l);
      if (!byKey.has(k)) {
        byKey.set(k, {
          key: k,
          title: l.title,
          cid: l.cid || null,
          domain: l.domain ? cleanDomain(l.domain) : null,
          rating: l.rating ?? null,
          votes: l.votes ?? null,
          category: l.category || null,
          isTarget: matchesTarget(l, target),
          ranks: [],
          top3Weight: 0,
        });
      }
      const c = byKey.get(k);
      c.ranks.push(l.rank);
      if (l.rank <= 3 && weights[i]) c.top3Weight += weights[i];
    }
  });

  // Winning radius: how far out the target holds the top 3 without a break
  const byDistance = valid
    .map((p) => ({ km: p.distFromBusinessKm, rank: rankOf(p), row: p.row, col: p.col }))
    .sort((a, b) => a.km - b.km);
  let winningKm = null;
  for (const d of byDistance) {
    if (d.rank != null && d.rank <= 3) winningKm = d.km;
    else break;
  }

  // Affluence-weighted SoLV (England: population x income decile of each point's area)
  let affluence = null;
  if (n && areaCoverage >= Math.ceil(n / 2) && totalWeight > 0) {
    const won = valid.reduce((s, p, i) => s + (p.rank != null && p.rank <= 3 && weights[i] ? weights[i] : 0), 0);
    const deciles = valid.map((p) => p.area && p.area.imdDecile).filter(Boolean);
    affluence = {
      weightedSolv: round((won / totalWeight) * 100, 1),
      solv: summary.solv,
      coverage: areaCoverage,
      avgImdDecile: deciles.length ? round(deciles.reduce((s, d) => s + d, 0) / deciles.length, 1) : null,
      areas: new Set(valid.map((p) => p.area && p.area.lsoa).filter(Boolean)).size,
    };
  }

  const report = {
    version: REPORT_VERSION,
    engine: scan.engine,
    summary,
    distribution,
    holdsFirst,
    competitors: [],
    radius: { winningKm, byDistance },
    affluence,
    search: null,
    insights: [],
  };

  // ---------- Google Search engine extras ----------
  let ai = null;
  if (isSearch) {
    // Single-business results ("1-Box") and no-local points
    const singlePoints = valid.filter((p) => p.single);
    const holders = new Map();
    for (const p of singlePoints) {
      const k = p.single.cid || nameKey(p.single.title);
      const row = holders.get(k) || { title: p.single.title, points: 0, isTarget: p.single.isTarget };
      row.points++;
      holders.set(k, row);
    }

    // Ads
    const advertisers = new Map();
    let adPoints = 0;
    let adsAboveSum = 0;
    for (const p of valid) {
      if ((p.ads || []).length) adPoints++;
      adsAboveSum += p.adsAboveYou || 0;
      const seenHere = new Set();
      for (const a of p.ads || []) {
        const k = nameKey(a.title) || a.domain;
        if (!k) continue;
        const row = advertisers.get(k) || { title: a.title || a.domain, domain: a.domain || null, points: 0, where: new Set(), isTarget: matchesTarget({ title: a.title }, target) };
        if (!seenHere.has(k)) row.points++;
        seenHere.add(k);
        row.where.add(a.where);
        advertisers.set(k, row);
      }
    }

    // Organic position of the target's website
    const organicRanks = valid.map((p) => p.organicRank).filter((r) => r != null);

    // AI Overview analysis
    const known = new Map();
    for (const p of valid) {
      for (const l of p.listings || []) known.set(nameKey(l.title), l.title);
      if (p.single) known.set(nameKey(p.single.title), p.single.title);
    }
    if (target.title) known.set(nameKey(target.title), target.title);
    const targetKey = nameKey(target.title);
    const targetDomain = cleanDomain(target.domain);
    const competitorDomains = new Set([...byKey.values()].filter((c) => !c.isTarget && c.domain).map((c) => c.domain));
    const competitorTitles = [...byKey.values()].filter((c) => !c.isTarget).map((c) => c.title);

    const aiNamed = new Map();
    const cited = new Map();
    let shownAt = 0;
    let namedAt = 0;
    let citedAt = 0;
    let top3At = 0;
    let firstAt = 0;
    const places = [];

    for (const p of valid) {
      if (!p.aio) {
        p.ai = { shown: false };
        continue;
      }
      shownAt++;
      const refs = p.aio.references || [];
      const named = namedInAio(p.aio.markdown, known, { sources: refs.map((r) => r.source).filter(Boolean), keyword: scan.keyword });
      // A source is its website, or its name when Google only gave a redirect link
      const sourceMap = new Map();
      for (const r of refs) {
        const label = cleanDomain(r.domain) || (r.source ? r.source.trim().replace(/^(https?:\/\/)?www\./i, '') : null);
        if (label && !sourceMap.has(label)) sourceMap.set(label, { label, domain: cleanDomain(r.domain), name: r.source || null });
      }
      const sources = [...sourceMap.keys()];
      const placeIdx = named.findIndex((x) => x.key === targetKey);
      const targetCited = [...sourceMap.values()].some(
        (x) => (targetDomain && x.domain && (x.domain === targetDomain || x.domain.endsWith(`.${targetDomain}`))) || (x.name && nameKey(x.name) === targetKey),
      );
      p.ai = {
        shown: true,
        named: named.map((x) => x.title),
        targetNamed: placeIdx >= 0,
        targetPlace: placeIdx >= 0 ? placeIdx + 1 : null,
        targetCited,
        sources,
      };
      if (placeIdx >= 0) {
        namedAt++;
        places.push(placeIdx + 1);
        if (placeIdx < 3) top3At++;
        if (placeIdx === 0) firstAt++;
      }
      if (targetCited) citedAt++;
      named.forEach((x, i) => {
        const row = aiNamed.get(x.key) || { key: x.key, title: x.title, points: 0, firstAt: 0, placeSum: 0, local: x.local, isTarget: x.key === targetKey };
        row.points++;
        row.placeSum += i + 1;
        if (i === 0) row.firstAt++;
        aiNamed.set(x.key, row);
      });
      for (const x of sourceMap.values()) {
        let category = domainCategory(x.domain, targetDomain, competitorDomains, { targetTitle: target.title, competitorTitles });
        if (!x.domain && x.name) {
          const k = nameKey(x.name);
          category = k === targetKey ? 'you' : known.has(k) ? 'competitor' : PLATFORMS.has(k) ? 'directory' : 'other';
        }
        const row = cited.get(x.label) || { domain: x.label, isDomain: Boolean(x.domain), points: 0, category };
        row.points++;
        cited.set(x.label, row);
      }
    }

    // Order businesses by AI presence, then compare with their order in the local leaderboard
    const aiRows = [...aiNamed.values()]
      .map((r) => ({ ...r, avgPlace: round(r.placeSum / r.points, 1) }))
      .sort((a, b) => b.points - a.points || a.avgPlace - b.avgPlace);

    ai = shownAt || (scan.options && scan.options.aio)
      ? {
          shownAt,
          namedAt,
          citedAt,
          top3At,
          firstAt,
          avgPlace: places.length ? round(places.reduce((s, x) => s + x, 0) / places.length, 1) : null,
          triggerRate: pct(shownAt, n),
          namedRate: pct(namedAt, shownAt),
          sources: [...cited.values()].sort((a, b) => b.points - a.points).slice(0, 30),
          sourceCount: cited.size,
          named: aiRows.slice(0, 30).map(({ placeSum, key, ...r }) => r),
          aiRows,
        }
      : null;

    report.search = {
      singleBusiness: {
        count: singlePoints.length,
        youAt: singlePoints.filter((p) => p.single.isTarget).length,
        holders: [...holders.values()].sort((a, b) => b.points - a.points),
      },
      noLocal: valid.filter((p) => p.noLocal).length,
      ads: {
        pointsWithAds: adPoints,
        avgAdsAboveYou: n ? round(adsAboveSum / n, 1) : null,
        advertisers: [...advertisers.values()]
          .map((a) => ({ ...a, where: [...a.where] }))
          .sort((a, b) => b.points - a.points)
          .slice(0, 15),
      },
      organic: { found: organicRanks.length, avgRank: organicRanks.length ? round(organicRanks.reduce((s, r) => s + r, 0) / organicRanks.length, 1) : null },
      ai: ai ? { ...ai, aiRows: undefined } : null,
    };
  }

  // Finish competitor rows (needs AI counts)
  const notFoundRank = depth + 1;
  const aiByKey = ai ? new Map(ai.aiRows.map((r) => [r.key, r])) : new Map();
  const citedByDomain = ai ? new Map(ai.sources.map((s) => [s.domain, s.points])) : new Map();
  const rows = [...byKey.values()].map((c) => {
    const top3 = c.ranks.filter((r) => r <= 3).length;
    const total = c.ranks.reduce((s, r) => s + r, 0) + (n - c.ranks.length) * notFoundRank;
    const aiRow = aiByKey.get(nameKey(c.title));
    return {
      title: c.title,
      cid: c.cid,
      domain: c.domain,
      rating: c.rating,
      votes: c.votes,
      category: c.category,
      isTarget: c.isTarget,
      found: c.ranks.length,
      top3,
      first: c.ranks.filter((r) => r === 1).length,
      best: Math.min(...c.ranks),
      arp: round(c.ranks.reduce((s, r) => s + r, 0) / c.ranks.length),
      atrp: n ? round(total / n) : null,
      solv: n ? round((top3 / n) * 100) : 0,
      affluenceShare: affluence ? round((c.top3Weight / totalWeight) * 100, 1) : null,
      aiNamedAt: aiRow ? aiRow.points : ai ? 0 : null,
      aiCitedAt: c.domain && citedByDomain.has(c.domain) ? citedByDomain.get(c.domain) : ai ? 0 : null,
    };
  });
  rows.sort((a, b) => b.solv - a.solv || a.atrp - b.atrp);
  report.competitors = rows.slice(0, 50);
  const targetRow = rows.find((r) => r.isTarget);
  if (targetRow && !report.competitors.includes(targetRow)) report.competitors.push(targetRow);

  // AI order vs local order
  if (report.search && report.search.ai) {
    const localOrder = new Map(rows.map((r, i) => [nameKey(r.title), i + 1]));
    report.search.ai.named = report.search.ai.named.map((r, i) => {
      const lo = localOrder.get(nameKey(r.title));
      return { ...r, localPosition: lo ?? null, aiPosition: i + 1, delta: lo != null ? lo - (i + 1) : null };
    });
  }

  report.insights = buildInsights(scan, report, rows);
  return report;
}

function buildInsights(scan, report, rows) {
  const s = report.summary;
  const name = scan.target.title || 'This business';
  const out = [];
  const n = s.scanned;
  if (!n) return out;

  out.push({ kind: 'visibility', layer: 'rank', text: `${name} is in the top 3 at ${s.top3} of ${n} points (${Math.round(s.solv)}%), and #1 at ${report.distribution.first}.` });
  if (report.distribution.notFound) out.push({ kind: 'visibility', layer: 'rank', text: `It does not appear in the top ${scan.depth} at ${report.distribution.notFound} points.` });

  const rival = rows.find((r) => !r.isTarget);
  const me = rows.find((r) => r.isTarget);
  if (rival && (!me || rival.top3 > me.top3)) {
    out.push({ kind: 'competitor', layer: 'rank', text: `${rival.title} is in the top 3 at more points (${rival.top3}) than ${name} (${me ? me.top3 : 0}).` });
  }

  const unit = scan.grid.unit === 'mi' ? 'mi' : 'km';
  const conv = (k) => (unit === 'mi' ? k / 1.609344 : k);
  if (report.radius.winningKm != null && report.radius.winningKm > 0) {
    out.push({ kind: 'radius', layer: 'rank', text: `It holds the top 3 without a break out to about ${conv(report.radius.winningKm).toFixed(1)} ${unit} from the business.` });
  } else {
    out.push({ kind: 'radius', layer: 'rank', text: 'It is not top 3 at the point closest to the business yet.' });
  }

  if (report.affluence) {
    const a = report.affluence;
    const diff = round(a.weightedSolv - a.solv, 1);
    out.push({
      kind: 'affluence',
      layer: 'affluence',
      text:
        Math.abs(diff) < 3
          ? `Its top-3 points match the grid's spread of affluence: ${Math.round(a.solv)}% of points and ${Math.round(a.weightedSolv)}% of the affluence-weighted grid.`
          : diff > 0
            ? `Its top-3 points cover better-off areas than their number suggests: ${Math.round(a.solv)}% of points but ${Math.round(a.weightedSolv)}% of the affluence-weighted grid.`
            : `Its top-3 points sit in less affluent areas: ${Math.round(a.solv)}% of points but only ${Math.round(a.weightedSolv)}% of the affluence-weighted grid.`,
    });
  }

  const sx = report.search;
  if (sx) {
    if (sx.singleBusiness.count) {
      out.push({ kind: 'single', layer: 'rank', text: `At ${sx.singleBusiness.count} of ${n} points Google showed one business and no map pack. ${name} held ${sx.singleBusiness.youAt} of them.` });
    }
    if (sx.ads.pointsWithAds) {
      out.push({ kind: 'ads', layer: 'ads', text: `Ads appear at ${sx.ads.pointsWithAds} of ${n} points, with about ${sx.ads.avgAdsAboveYou} above ${name} on average.` });
    }
    if (sx.ai) {
      const a = sx.ai;
      if (a.shownAt) {
        out.push({
          kind: 'ai',
          layer: 'ai',
          text: `An AI Overview appeared at ${a.shownAt} of ${n} points; ${name} was named at ${a.namedAt}${a.namedAt ? `, first at ${a.firstAt}, average place #${a.avgPlace}` : ''}. Its website was cited as a source at ${a.citedAt}.`,
        });
        const outsider = a.named.find((r) => !r.isTarget && r.localPosition == null);
        if (outsider) out.push({ kind: 'ai', layer: 'ai', text: `${outsider.title} is named in the AI Overview at ${outsider.points} points without showing in the local results.` });
      } else {
        out.push({ kind: 'ai', layer: 'ai', text: 'No AI Overview appeared at any point for this keyword.' });
      }
    }
  }
  return out;
}
