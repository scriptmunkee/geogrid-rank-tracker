// Engine registry. Every engine runs over the same grid.
//
// Engine contract:
//   id, label, description, costs, costPerPoint(options)
//   evaluatePoint(params, { demo, env }) -> Promise<{ rank, listings, ...extras }>
//   matchesTarget(listing, target) -> boolean

import { mapsEngine } from './maps.js';
import { searchEngine } from './search.js';

const engines = { [mapsEngine.id]: mapsEngine, [searchEngine.id]: searchEngine };

export function getEngine(id) {
  const engine = engines[id];
  if (!engine) throw new Error(`Unknown engine: ${id}`);
  return engine;
}

export function listEngines() {
  return Object.values(engines).map(({ id, label, description, costs }) => ({ id, label, description, costs }));
}
