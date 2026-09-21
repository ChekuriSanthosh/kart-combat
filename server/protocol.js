/**
 * Socket.io event name constants — locked client↔server contract.
 */

export const EVENT = Object.freeze({
  // Inbound (client → server)
  PLAYER_JOIN: 'player:join',
  PLAYER_INPUT: 'player:input',
  PLAYER_LEAVE: 'player:leave',

  // Outbound (server → client)
  PLAYER_WELCOME: 'player:welcome',
  PLAYER_STATE: 'player:state',
  PLAYER_HIT: 'player:hit',
  // PLAYER_LEAVE also used outbound as { playerId }
  ROOM_UPDATE: 'room:update',
  ERROR: 'error',
});

export const MAP_IDS = Object.freeze(['gravelPit', 'skyPinball', 'beybladeArena']);
export const DEFAULT_MAP_ID = 'gravelPit';
export const DEFAULT_ROOM_ID = 'default';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 15;
export const DEFAULT_MAX_PLAYERS = 8;
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;

export function clampMaxPlayers(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(v)));
}

/**
 * Soft arena radii for AI bounds (XZ distance from origin).
 * Matches MapManager playable footprints roughly.
 */
export const MAP_ARENA_RADIUS = Object.freeze({
  gravelPit: 42, // floorSize 92 / berm half ~45
  skyPinball: 34, // scaled tier footprint
  beybladeArena: 44, // MapManager ARENA_RADIUS 45 soft edge
});

/**
 * Plain-JS spawnRing matching MapManager.js (no Three).
 * rotationY = atan2(-x, -z) faces center.
 */
export function spawnRing(count, radius, y, teams) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    pts.push({
      x,
      y,
      z,
      rotationY: Math.atan2(-x, -z),
      team: teams ? teams[i % teams.length] : undefined,
    });
  }
  return pts;
}

/**
 * Per-map spawn lists mirrored from MapManager.js.
 * gravelPit: primary ring of 8 @ r16 + second ring of 7 @ r12 for 15 slots.
 * beybladeArena: ring of 8 @ r5 (cycle for >8).
 * skyPinball: tier rings with offsets from MapManager ~423–438.
 */
function buildMapSpawns() {
  // Mirrored from scaled MapManager.js spawnPoints
  const gravelPit = [
    ...spawnRing(8, 28, 1.2, ['A', 'B']),
    ...spawnRing(7, 20, 1.2, ['A', 'B']),
  ];

  const beybladeArena = spawnRing(8, 9, 1.0, ['red', 'blue']);

  const skyPinball = [
    ...spawnRing(4, 12, 1.15, ['tier0']),
    ...spawnRing(2, 6, 6.9, ['tier1']).map((p) => ({
      ...p,
      x: p.x - 18,
      z: p.z + 6,
      y: 6.9,
    })),
    ...spawnRing(2, 5.5, 7.4, ['tier1']).map((p) => ({
      ...p,
      x: p.x + 16,
      z: p.z - 7,
      y: 7.4,
    })),
    ...spawnRing(3, 5, 12.9, ['tier2']).map((p) => ({
      ...p,
      z: p.z - 3,
      y: 12.9,
    })),
  ];

  // Recompute facing after offset remaps so karts face map center
  for (const p of skyPinball) {
    p.rotationY = Math.atan2(-p.x, -p.z);
  }

  return Object.freeze({
    gravelPit: Object.freeze(gravelPit),
    beybladeArena: Object.freeze(beybladeArena),
    skyPinball: Object.freeze(skyPinball),
  });
}

export const MAP_SPAWNS = buildMapSpawns();

/**
 * Pick spawn for player index on a map. Cycles if list shorter than needed.
 * @param {string} mapId
 * @param {number} index
 * @param {number} [total=15] unused besides API parity; indexing cycles on list length
 */
export function getSpawn(mapId, index, total = MAX_PLAYERS) {
  void total;
  const list = MAP_SPAWNS[mapId] || MAP_SPAWNS[DEFAULT_MAP_ID];
  const i = ((index % list.length) + list.length) % list.length;
  const s = list[i];
  return {
    x: s.x,
    y: s.y,
    z: s.z,
    rotY: s.rotationY,
    rotationY: s.rotationY,
  };
}

export default EVENT;
