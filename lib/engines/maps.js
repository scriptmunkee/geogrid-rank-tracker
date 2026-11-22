// Google Maps engine: one Maps SERP per grid point.

const { postLiveTask } = require('../dataforseo');
const mock = require('../mock');

const PATH = '/serp/google/maps/live/advanced';
const COST_PER_POINT = 0.002; // Live mode, per SERP of up to 100 results

function normalise(item) {
  return {
    rank: item.rank_group,
    title: item.title || '',
    cid: item.cid ? String(item.cid) : null,
    placeId: item.place_id || null,
    domain: item.domain || null,
    url: item.url || null,
    rating: item.rating ? item.rating.value : null,
    votes: item.rating ? item.rating.votes_count : null,
    category: item.category || null,
    address: item.address || null,
    lat: item.latitude ?? null,
    lng: item.longitude ?? null,
    isClaimed: item.is_claimed ?? null,
  };
}

function itemsFromTask(task) {
  const result = task.result && task.result[0];
  const items = (result && result.items) || [];
  return items.filter((i) => i.type === 'maps_search').map(normalise);
}

/** Search Maps at one grid point. Returns normalised listings in rank order. */
async function searchPoint({ keyword, lat, lng, zoom, depth, languageCode, device }, { demo }) {
  if (demo) return mock.searchPoint({ keyword, lat, lng, depth });
  const task = await postLiveTask(PATH, {
    keyword,
    location_coordinate: `${lat},${lng},${zoom}z`,
    language_code: languageCode,
    device,
    depth,
  });
  return itemsFromTask(task);
}

/** Find candidate businesses for the picker. */
async function findBusiness({ query, lat, lng, locationName, languageCode }, { demo }) {
  if (demo) return mock.findBusiness({ query, lat, lng });
  const task = { keyword: query, language_code: languageCode, depth: 20 };
  if (Number.isFinite(lat) && Number.isFinite(lng)) task.location_coordinate = `${lat},${lng},13z`;
  else task.location_name = locationName;
  return itemsFromTask(await postLiveTask(PATH, task));
}

/** Does this listing belong to the target business? CID first, then place ID, then exact name. */
function matchesTarget(listing, target) {
  if (target.cid && listing.cid) return listing.cid === String(target.cid);
  if (target.placeId && listing.placeId) return listing.placeId === target.placeId;
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(listing.title) !== '' && norm(listing.title) === norm(target.title);
}

module.exports = {
  id: 'google_maps',
  label: 'Google Maps',
  costPerPoint: COST_PER_POINT,
  searchPoint,
  findBusiness,
  matchesTarget,
  itemsFromTask,
};
