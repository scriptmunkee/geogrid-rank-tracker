// Demo data: realistic-looking Maps results with no API calls.
// The target ranks well near the centre and fades with distance; competitors cluster in different spots.

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

let centre = { lat: 54.7761, lng: -1.5733 };
let target = null;

function businesses(keyword) {
  const noun = (keyword || 'Services').replace(/\b(near me|best|top)\b/gi, '').trim() || 'Services';
  const label = noun.replace(/\b\w/g, (c) => c.toUpperCase());
  const list = NAMES.map((n, i) => {
    const r1 = rand(hash(n + 'lat'));
    const r2 = rand(hash(n + 'lng'));
    return {
      title: `${n} ${label}`,
      cid: String(1000000000000 + hash(n)),
      placeId: `ChIJdemo${hash(n).toString(36)}`,
      domain: `${n.toLowerCase().replace(/\s+/g, '')}.co.uk`,
      rating: Math.round((3.6 + rand(hash(n + 'r')) * 1.4) * 10) / 10,
      votes: Math.floor(5 + rand(hash(n + 'v')) * 400),
      category: label,
      address: `${1 + (i % 80)} ${n} Road`,
      lat: centre.lat + (r1 - 0.5) * 0.12,
      lng: centre.lng + (r2 - 0.5) * 0.2,
      strength: rand(hash(n + 's')),
    };
  });
  if (target) list.push({ ...target, strength: 0.75 });
  return list;
}

function km(aLat, aLng, bLat, bLng) {
  const dy = (aLat - bLat) * 111.32;
  const dx = (aLng - bLng) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

async function searchPoint({ keyword, lat, lng, depth }) {
  await new Promise((r) => setTimeout(r, 40));
  const scored = businesses(keyword).map((b) => {
    const noise = rand(hash(`${b.cid}|${lat}|${lng}`)) * 2.5;
    return { b, score: km(lat, lng, b.lat, b.lng) * 1.6 - b.strength * 3 + noise };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, depth).map(({ b }, i) => {
    const { strength, ...rest } = b;
    return { ...rest, rank: i + 1, url: `https://${b.domain}/`, isClaimed: true };
  });
}

async function findBusiness({ query, lat, lng }) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) centre = { lat, lng };
  const title = query.trim() || 'Demo Business';
  target = {
    title: title.replace(/\b\w/g, (c) => c.toUpperCase()),
    cid: '999999999999',
    placeId: 'ChIJdemoTarget',
    domain: 'example.co.uk',
    rating: 4.8,
    votes: 37,
    category: 'Demo listing',
    address: 'Demo address (demo mode)',
    lat: centre.lat + 0.004,
    lng: centre.lng - 0.006,
  };
  const others = businesses('Services').slice(0, 4).map(({ strength, ...b }) => b);
  return [target, ...others].map((b, i) => ({ ...b, rank: i + 1 }));
}

module.exports = { searchPoint, findBusiness };
