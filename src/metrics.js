// Scan scoring: ARP, ATRP, SoLV and the competitor table.

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {Array<{rank:number|null, error?:string}>} points target rank per point (null = not found)
 * @param {number} depth ranks tracked (not found counts as depth + 1)
 */
export function summarise(points, depth) {
  const valid = points.filter((p) => !p.error);
  const found = valid.filter((p) => p.rank != null);
  const notFoundRank = depth + 1;
  const arp = found.length ? found.reduce((s, p) => s + p.rank, 0) / found.length : null;
  const atrp = valid.length ? valid.reduce((s, p) => s + (p.rank ?? notFoundRank), 0) / valid.length : null;
  const top3 = valid.filter((p) => p.rank != null && p.rank <= 3).length;
  return {
    points: points.length,
    scanned: valid.length,
    errors: points.length - valid.length,
    found: found.length,
    top3,
    arp: arp == null ? null : round2(arp),
    atrp: atrp == null ? null : round2(atrp),
    solv: valid.length ? round2((top3 / valid.length) * 100) : null,
  };
}

/** Aggregate every business seen across the grid. */
export function competitors(gridResults, depth, matchesTarget, target, limit = 25) {
  const valid = gridResults.filter((p) => !p.error);
  const byKey = new Map();
  for (const point of valid) {
    for (const l of point.listings) {
      const key = l.cid || l.placeId || l.title.toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, {
          title: l.title,
          cid: l.cid,
          domain: l.domain,
          rating: l.rating,
          votes: l.votes,
          category: l.category,
          isTarget: matchesTarget(l, target),
          ranks: [],
        });
      }
      byKey.get(key).ranks.push(l.rank);
    }
  }
  const notFoundRank = depth + 1;
  const rows = [...byKey.values()].map(({ ranks, ...c }) => {
    const top3 = ranks.filter((r) => r <= 3).length;
    const total = ranks.reduce((s, r) => s + r, 0) + (valid.length - ranks.length) * notFoundRank;
    return {
      ...c,
      found: ranks.length,
      arp: round2(ranks.reduce((s, r) => s + r, 0) / ranks.length),
      atrp: valid.length ? round2(total / valid.length) : null,
      solv: valid.length ? round2((top3 / valid.length) * 100) : 0,
    };
  });
  rows.sort((a, b) => b.solv - a.solv || a.atrp - b.atrp);
  const top = rows.slice(0, limit);
  const targetRow = rows.find((r) => r.isTarget);
  if (targetRow && !top.includes(targetRow)) top.push(targetRow);
  return top;
}
