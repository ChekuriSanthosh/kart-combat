/**
 * Map registry — aliases loaders from MapManager + createMapById.
 *
 *   import { createMapById, gravelPit, skyPinball, beybladeArena } from '/js/maps/index.js';
 *   import { loadGravelPit, loadSkyPinball, loadBeybladeArena } from '/js/maps/MapManager.js';
 */
import {
  loadGravelPit,
  loadSkyPinball,
  loadBeybladeArena,
  loadMap,
  LOADERS,
} from './MapManager.js';

/** Registry entries — aliases to the MapManager loaders */
export const gravelPit = loadGravelPit;
export const skyPinball = loadSkyPinball;
export const beybladeArena = loadBeybladeArena;

export const MAPS = {
  gravelPit: loadGravelPit,
  skyPinball: loadSkyPinball,
  beybladeArena: loadBeybladeArena,
};

export const MAP_IDS = Object.keys(MAPS);

/**
 * @param {string} id — 'gravelPit' | 'skyPinball' | 'beybladeArena'
 * @param {any} THREE
 */
export function createMapById(id, THREE) {
  const loader = MAPS[id] || LOADERS[id];
  if (!loader) {
    throw new Error(`Unknown map id "${id}". Available: ${MAP_IDS.join(', ')}`);
  }
  return loader(THREE);
}

export function listMaps() {
  return [
    { id: 'gravelPit', name: 'Gravel Pit' },
    { id: 'skyPinball', name: 'Sky Pinball' },
    { id: 'beybladeArena', name: 'Beyblade Arena' },
  ];
}

export {
  loadGravelPit,
  loadSkyPinball,
  loadBeybladeArena,
  loadMap,
  LOADERS,
};

export default {
  gravelPit,
  skyPinball,
  beybladeArena,
  MAPS,
  MAP_IDS,
  createMapById,
  listMaps,
  loadGravelPit,
  loadSkyPinball,
  loadBeybladeArena,
};
