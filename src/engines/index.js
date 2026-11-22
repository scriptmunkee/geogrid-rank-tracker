// Engine registry. Every engine runs over the same grid.
//
// Engine contract:
//   id, label, costPerPoint
//   searchPoint(params, { demo, env }) -> Promise<Array<listing>>   (rank-ordered)
//   matchesTarget(listing, target) -> boolean
//
// Phase 2 adds `google_ai_overview` here: organic live/advanced with
// location_coordinate + load_async_ai_overview, returning AIO references as the "listings".

import { mapsEngine } from './maps.js';

const engines = { [mapsEngine.id]: mapsEngine };

export function getEngine(id) {
  const engine = engines[id];
  if (!engine) throw new Error(`Unknown engine: ${id}`);
  return engine;
}

export function listEngines() {
  return Object.values(engines).map(({ id, label, costPerPoint }) => ({ id, label, costPerPoint }));
}
