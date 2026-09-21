/**
 * Room / player entity management for Kart Combat.
 */

import {
  DEFAULT_ROOM_ID,
  DEFAULT_MAP_ID,
  MAP_IDS,
  MAX_PLAYERS,
  DEFAULT_MAX_PLAYERS,
  clampMaxPlayers,
  getSpawn,
  MAP_SPAWNS,
  MAP_ARENA_RADIUS,
} from './protocol.js';

const RIDE_HEIGHT = 0.35;
const AI_NAMES = [
  'BoltBot', 'DriftKing', 'RubberDuck', 'NitroNina', 'ZoomZed',
  'Kartastrophe', 'Wheely', 'TurboTim', 'SkidMark', 'BananaBot',
  'PitStop', 'GearHead', 'LapDog', 'Fender', 'Axle',
];

let nextId = 1;

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {{ name?: string, isAi?: boolean, socketId?: string|null, index?: number, mapId?: string }} opts
 */
export function createPlayer({ name, isAi, socketId, index = 0, mapId = DEFAULT_MAP_ID }) {
  const spawn = getSpawn(mapId, index, MAX_PLAYERS);
  const groundY = typeof spawn.y === 'number' ? spawn.y : RIDE_HEIGHT;
  return {
    id: `p${nextId++}`,
    name: name || (isAi ? AI_NAMES[index % AI_NAMES.length] : 'Racer'),
    x: spawn.x,
    y: groundY,
    z: spawn.z,
    rotY: spawn.rotY,
    hp: 100,
    score: 0,
    currentWeapon: null,
    isFrozen: false,
    isShrunk: false,
    isInvincible: false,
    gravityAnchored: false,
    isAi: !!isAi,
    vx: 0,
    vz: 0,
    socketId: socketId || null,
    groundY,
    mapId,
    input: {
      forward: false,
      back: false,
      left: false,
      right: false,
      drift: false,
      fire: false,
      seq: 0,
    },
    // internal timers (seconds)
    _freezeTimer: 0,
    _shrinkTimer: 0,
    _invincibleTimer: 0,
    _anchorTimer: 0,
    _fireCooldown: 0,
    _aiRetargetTimer: 0,
    _aiWobbleTimer: 0,
    _aiWobble: 0,
    _aiTargetId: null,
    _aiFireTimer: 0.4 + Math.random() * 1.2,
  };
}

/** @deprecated use getSpawn — kept for callers expecting circle spawn */
export function spawnOnCircle(index, total = MAX_PLAYERS, mapId = DEFAULT_MAP_ID) {
  const s = getSpawn(mapId, index, total);
  return { x: s.x, y: s.y, z: s.z, rotY: s.rotY };
}

export function statusEffectsFromFlags(p) {
  const effects = [];
  if (p.isFrozen) {
    effects.push({ type: 'frozen', remaining: Math.max(0.05, p._freezeTimer || 0.25) });
  }
  if (p.isShrunk) {
    effects.push({ type: 'shrink', remaining: Math.max(0.05, p._shrinkTimer || 0.25) });
  }
  if (p.isInvincible) {
    effects.push({ type: 'invincible', remaining: Math.max(0.05, p._invincibleTimer || 0.25) });
  }
  if (p.gravityAnchored) {
    effects.push({ type: 'anchor', remaining: Math.max(0.05, p._anchorTimer || 0.25) });
  }
  return effects;
}

export function toSnapshot(p) {
  return {
    id: p.id,
    name: p.name,
    x: round3(p.x),
    y: round3(p.y),
    z: round3(p.z),
    yaw: round3(p.rotY),
    rotY: round3(p.rotY),
    vx: round2(p.vx),
    vz: round2(p.vz),
    hp: p.hp,
    score: p.score,
    statusEffects: statusEffectsFromFlags(p),
    weapon: p.currentWeapon,
    currentWeapon: p.currentWeapon,
    isAi: p.isAi,
    isFrozen: p.isFrozen,
    isShrunk: p.isShrunk,
    isInvincible: p.isInvincible,
    gravityAnchored: p.gravityAnchored,
  };
}

export function createRoom(roomId = DEFAULT_ROOM_ID, mapId = DEFAULT_MAP_ID, maxPlayers = DEFAULT_MAX_PLAYERS) {
  const resolvedMap = MAP_IDS.includes(mapId) ? mapId : DEFAULT_MAP_ID;
  return {
    id: roomId || DEFAULT_ROOM_ID,
    mapId: resolvedMap,
    maxPlayers: clampMaxPlayers(maxPlayers),
    players: new Map(), // id -> player
  };
}

export function humanCount(room) {
  let n = 0;
  for (const p of room.players.values()) if (!p.isAi) n++;
  return n;
}

export function aiCount(room) {
  let n = 0;
  for (const p of room.players.values()) if (p.isAi) n++;
  return n;
}

export function roomCounts(room) {
  const ai = aiCount(room);
  const humans = humanCount(room);
  return { count: humans + ai, max: room.maxPlayers, aiCount: ai, humans };
}

export function removeOneAi(room) {
  for (const [id, p] of room.players) {
    if (p.isAi) {
      room.players.delete(id);
      return p;
    }
  }
  return null;
}

export function fillAiToCapacity(room) {
  while (room.players.size < room.maxPlayers) {
    const index = room.players.size;
    const bot = createPlayer({ isAi: true, index, mapId: room.mapId });
    room.players.set(bot.id, bot);
  }
}

export function trimAiToCapacity(room) {
  while (room.players.size > room.maxPlayers) {
    if (!removeOneAi(room)) break;
  }
}

/** Reposition all AI onto current map spawns (used when empty room map changes). */
export function respawnAiOnMap(room) {
  let i = 0;
  for (const p of room.players.values()) {
    if (!p.isAi) continue;
    const spawn = getSpawn(room.mapId, i, room.maxPlayers);
    p.x = spawn.x;
    p.y = spawn.y;
    p.z = spawn.z;
    p.rotY = spawn.rotY;
    p.vx = 0;
    p.vz = 0;
    p.groundY = spawn.y;
    p.mapId = room.mapId;
    p._aiTargetId = null;
    i++;
  }
}

export function allSnapshots(room) {
  return [...room.players.values()].map(toSnapshot);
}

export {
  DEFAULT_ROOM_ID,
  DEFAULT_MAP_ID,
  MAP_IDS,
  MAX_PLAYERS,
  DEFAULT_MAX_PLAYERS,
  clampMaxPlayers,
  RIDE_HEIGHT,
  getSpawn,
  MAP_SPAWNS,
  MAP_ARENA_RADIUS,
};
