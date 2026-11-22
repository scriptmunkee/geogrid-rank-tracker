// Google Maps engine: one Maps SERP per grid point.

import { postLiveTask } from '../dataforseo.js';
import * as mock from '../mock.js';
import { matchesTarget } from './match.js';

export { matchesTarget };

const PATH = '/serp/google/maps/live/advanced';

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

export function itemsFromTask(task) {
  const result = task.result && task.result[0];
  const items = (result && result.items) || [];
  return items.filter((i) => i.type === 'maps_search').map(normalise);
}

export const mapsEngine = {
  id: 'google_maps',
  label: 'Google Maps',
  description: 'Rank in Google Maps results',
  costs: { base: 0.002 },
  costPerPoint() {
    return 0.002; // Live mode, per SERP of up to 100 results
  },

  /** Search Maps at one grid point. Returns { rank, listings }. */
  async evaluatePoint(p, { demo, env }) {
    const listings = demo
      ? await mock.searchPoint(p)
      : itemsFromTask(
          await postLiveTask(env, PATH, {
            keyword: p.keyword,
            location_coordinate: `${p.lat},${p.lng},${p.zoom}z`,
            language_code: p.languageCode,
            device: p.device,
            depth: p.depth,
          }),
        );
    const top = listings.slice(0, p.depth);
    const hit = top.find((l) => matchesTarget(l, p.target));
    return { rank: hit ? hit.rank : null, listings: top };
  },

  /** Find candidate businesses for the picker. */
  async findBusiness({ query, lat, lng, locationName, languageCode }, { demo, env }) {
    if (demo) return mock.findBusiness({ query, lat, lng });
    const task = { keyword: query, language_code: languageCode, depth: 20 };
    if (Number.isFinite(lat) && Number.isFinite(lng)) task.location_coordinate = `${lat},${lng},13z`;
    else task.location_name = locationName;
    return itemsFromTask(await postLiveTask(env, PATH, task));
  },

  matchesTarget,
};
