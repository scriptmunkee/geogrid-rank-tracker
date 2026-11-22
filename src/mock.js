// Demo data: realistic-looking Maps results with no API calls.
// Stateless: the target and scan centre are passed in, so it works across Worker isolates.
// The target ranks well near its location and fades with distance; competitors cluster in different spots.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const NAMES = [
  'Northern Lights', 'Riverside', 'Castle View', 'Peninsula', 'Harbour', 'Wearside', 'Coastline', 'Cathedral',
  'Market Square', 'Old Mill', 'Hilltop', 'Station Road', 'Parkside', 'Bridge End', 'Meadow', 'Quayside',
  'Front Street', 'Abbey', 'Moorland', 'Valley', 'Seaview', 'Victoria', 'Kingsway', 'Fenwick', 'Oakwood',
  'Elmfield', 'Greenside', 'Ashbrook', 'Redhill', 'Whitburn',
];

export const DEMO_TARGET_CID = '999999999999';

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function competitorsAround(centre, keyword) {
  const noun = (keyword || 'Services').replace(/\b(near me|best|top)\b/gi, '').trim() || 'Services';
  const label = titleCase(noun);
  return NAMES.map((n, i) => ({
    title: `${n} ${label}`,
    cid: String(1000000000000 + hash(n)),
    placeId: `ChIJdemo${hash(n).toString(36)}`,
    domain: `${n.toLowerCase().replace(/\s+/g, '')}.co.uk`,
    rating: Math.round((3.6 + rand(hash(n + 'r')) * 1.4) * 10) / 10,
    votes: Math.floor(5 + rand(hash(n + 'v')) * 400),
    category: label,
    address: `${1 + (i % 80)} ${n} Road`,
    lat: centre.lat + (rand(hash(n + 'lat')) - 0.5) * 0.12,
    lng: centre.lng + (rand(hash(n + 'lng')) - 0.5) * 0.2,
    strength: rand(hash(n + 's')),
  }));
}

function km(aLat, aLng, bLat, bLng) {
  const dy = (aLat - bLat) * 111.32;
  const dx = (aLng - bLng) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

export async function searchPoint({ keyword, lat, lng, depth, centre, target }) {
  const list = competitorsAround(centre, keyword);
  if (target) {
    list.push({
      ...target,
      lat: target.lat ?? centre.lat,
      lng: target.lng ?? centre.lng,
      strength: 0.75,
    });
  }
  const scored = list.map((b) => ({
    b,
    score: km(lat, lng, b.lat, b.lng) * 1.6 - b.strength * 3 + rand(hash(`${b.cid}|${lat}|${lng}`)) * 2.5,
  }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, depth).map(({ b }, i) => {
    const { strength, ...rest } = b;
    return { ...rest, rank: i + 1, url: rest.domain ? `https://${rest.domain}/` : null, isClaimed: true };
  });
}

export async function findBusiness({ query, lat, lng }) {
  const centre = { lat: Number.isFinite(lat) ? lat : 54.7761, lng: Number.isFinite(lng) ? lng : -1.5733 };
  const target = {
    title: titleCase(query.trim() || 'Demo Business'),
    cid: DEMO_TARGET_CID,
    placeId: 'ChIJdemoTarget',
    domain: 'example.co.uk',
    rating: 4.8,
    votes: 37,
    category: 'Demo listing',
    address: 'Demo address (demo mode)',
    lat: Math.round((centre.lat + 0.004) * 1e7) / 1e7,
    lng: Math.round((centre.lng - 0.006) * 1e7) / 1e7,
  };
  const others = competitorsAround(centre, 'Services')
    .slice(0, 4)
    .map(({ strength, ...b }) => b);
  return [target, ...others].map((b, i) => ({ ...b, rank: i + 1 }));
}
