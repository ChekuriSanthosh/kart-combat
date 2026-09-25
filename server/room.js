/**
 * A room owns one match: its map, its karts (human and bot), the mystery
 * boxes, and every projectile in flight. Everything here is authoritative —
 * clients only ever send button presses.
 */

import {
  MAX_HP, RESPAWN_DELAY, SPAWN_INVULN, SIM_DT,
  DEFAULT_MAP_ID, clampMaxPlayers, unpackInput, KART_COLORS,
  CHEAT, CHEAT_DURATION, CHEAT_HOP_SPEED, CHEAT_COOLDOWN, ROOM_STATUS,
  DEFAULT_MATCH_SECONDS, RESULTS_SECONDS,
} from '../shared/constants.js';
import { createKartState, createInput, stepKart, resolveKartPair, applyImpulse, KART } from '../shared/physics.js';
import { getMap, getSpawn, applyEnvironment } from '../shared/maps/index.js';
import { createAiBrain, driveAi, DEFAULT_DIFFICULTY, isDifficulty } from '../shared/ai/index.js';
import {
  WEAPONS, rollWeapon, spawnProjectiles, stepProjectiles, applySelfWeapon,
} from '../shared/weapons.js';

const BOX_RESPAWN = 6.0;
const BOT_NAMES = [
  'BoltBot', 'DriftKing', 'RubberDuck', 'NitroNina', 'ZoomZed',
  'Kartastrophe', 'Wheely', 'TurboTim', 'SkidMark', 'BananaBot',
  'PitStop', 'GearHead', 'LapDog', 'Fender', 'Axle',
  'Clutch', 'Nitro', 'Sparky', 'Torque', 'Rusty',
];

/** Bots come and go as humans join, so names are claimed rather than indexed. */
function claimBotName(room) {
  const taken = new Set([...room.players.values()].map((p) => p.name));
  for (const n of BOT_NAMES) if (!taken.has(n)) return n;
  for (let i = 2; ; i++) {
    for (const n of BOT_NAMES) {
      const candidate = `${n} ${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}

let nextPlayerId = 1;

export function createRoom(id, mapId, maxPlayers, { isPrivate = false, difficulty } = {}) {
  const map = getMap(mapId || DEFAULT_MAP_ID);
  return {
    id,
    /** Shown to players and used in invite links. Private rooms only. */
    code: id,
    /** Private rooms are reachable by code only, never by quick match. */
    isPrivate,
    /**
     * Private rooms gather first so the host can see who arrived; quick-play
     * rooms are live from the moment they exist.
     */
    status: isPrivate ? ROOM_STATUS.LOBBY : ROOM_STATUS.PLAYING,
    /** Host's choice in the waiting room: fill empty seats with bots? */
    fillWithBots: true,
    /** How long each match runs, in seconds. */
    matchSeconds: DEFAULT_MATCH_SECONDS,
    /** Room clock at which the current match ends. */
    endsAt: 0,
    /** Room clock at which the results screen gives way to the next match. */
    resultsUntil: 0,
    /** Standings frozen at the final whistle, so they cannot drift on screen. */
    standings: null,
    /** How sharp the bots are: 'low' | 'medium' | 'high'. */
    difficulty: isDifficulty(difficulty) ? difficulty : DEFAULT_DIFFICULTY,
    /** Crate flow field, rebuilt by the AI only when the live crate set moves. */
    crateField: { key: -1, field: null },
    /** Whoever opened the room; they get to change the map. */
    hostId: null,
    mapId: map.id,
    map,
    maxPlayers: clampMaxPlayers(maxPlayers),
    players: new Map(),
    projectiles: [],
    boxes: map.boxes.map((b) => ({ x: b.x, y: b.y, z: b.z, alive: true, respawnAt: 0 })),
    events: [],
    rosterDirty: true,
    clock: 0,
    nextColor: 0,
  };
}

export function createPlayer(room, { name, isAi, socketId }) {
  const index = room.players.size;
  const spawn = getSpawn(room.mapId, index);
  const p = {
    id: `p${nextPlayerId++}`,
    name: name || (isAi ? claimBotName(room) : 'Racer'),
    isAi: !!isAi,
    socketId: socketId || null,
    color: KART_COLORS[room.nextColor++ % KART_COLORS.length],

    state: createKartState(spawn),
    input: createInput(),
    queue: [],
    lastCmd: { seq: 0, bits: 0 },
    ackSeq: 0,

    hp: MAX_HP,
    score: 0,
    kills: 0,
    deaths: 0,
    alive: true,
    respawnAt: 0,
    invulnTime: SPAWN_INVULN,
    shieldTime: 0,
    /** Cheat-only: hides the kart from everyone else while it runs. */
    invisTime: 0,
    /** Per-cheat cooldown stamps, so a held key cannot spam an effect. */
    cheatReady: {},

    weapon: null,
    stream: null,
    fireCooldown: 0,
    firePressed: false,

    brain: isAi ? createAiBrain(room.difficulty) : null,
  };
  room.players.set(p.id, p);
  room.rosterDirty = true;
  return p;
}

export function fillBots(room) {
  while (room.players.size < room.maxPlayers) createPlayer(room, { isAi: true });
}

export function removeOneBot(room) {
  for (const [id, p] of room.players) {
    if (p.isAi) {
      room.players.delete(id);
      room.rosterDirty = true;
      return p;
    }
  }
  return null;
}

export function trimBots(room) {
  while (room.players.size > room.maxPlayers && removeOneBot(room)) { /* keep trimming */ }
}

export function humanCount(room) {
  let n = 0;
  for (const p of room.players.values()) if (!p.isAi) n++;
  return n;
}

/** Move a room to a different arena and reseat everyone. */
export function setMap(room, mapId) {
  const map = getMap(mapId);
  room.map = map;
  room.mapId = map.id;
  room.projectiles.length = 0;
  room.boxes = map.boxes.map((b) => ({ x: b.x, y: b.y, z: b.z, alive: true, respawnAt: 0 }));
  let i = 0;
  for (const p of room.players.values()) respawn(room, p, i++);
}

function respawn(room, p, indexOverride) {
  const index = indexOverride ?? [...room.players.keys()].indexOf(p.id);
  const spawn = getSpawn(room.mapId, index < 0 ? 0 : index);
  p.state = createKartState(spawn);
  p.hp = MAX_HP;
  p.alive = true;
  p.respawnAt = 0;
  p.invulnTime = SPAWN_INVULN;
  p.shieldTime = 0;
  p.invisTime = 0;
  p.weapon = null;
  p.stream = null;
  p.queue.length = 0;
  if (p.brain) p.brain = createAiBrain(room.difficulty);
}

function damage(room, target, amount, sourceId, opts = {}) {
  if (!target.alive || amount < 0) return;
  const shielded = target.shieldTime > 0 || target.invulnTime > 0;

  // The freeze ray takes half of what you have left, so it always hurts and
  // never kills — it is a control weapon, not a finisher. Rounded down so the
  // last point of health can only be taken by something else.
  if (opts.halveHealth) amount = Math.max(0, Math.floor(target.hp / 2));

  if (!shielded && opts.knockback) {
    applyImpulse(target.state, opts.knockback.x, opts.knockback.y, opts.knockback.z);
  }
  if (shielded) {
    room.events.push({ t: 'block', i: target.id });
    return;
  }
  if (opts.stun) target.state.stunTime = Math.max(target.state.stunTime, opts.stun);

  const dealt = Math.min(target.hp, amount);
  target.hp -= dealt;
  room.events.push({
    t: 'hit', i: target.id, by: sourceId, d: Math.round(dealt), w: opts.weapon || null,
  });

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    target.respawnAt = room.clock + RESPAWN_DELAY;
    target.weapon = null;
    target.stream = null;
    // Scores only ever go up. Driving into someone, or dropping off the edge,
    // costs you the respawn wait and nothing else — the same deal Smash Karts
    // gives you. Points come strictly from knocking others out with a weapon.
    const killer = sourceId && sourceId !== target.id ? room.players.get(sourceId) : null;
    if (killer) {
      killer.kills++;
      killer.score += 1;
    }
    room.events.push({
      t: 'kill', i: target.id, by: killer ? killer.id : null,
      x: target.state.x, y: target.state.y, z: target.state.z,
    });
  }
}

/**
 * Apply one hidden cheat to a player. Authoritative like everything else, so
 * the client only ever asks; the effects themselves reuse the same state the
 * normal weapons drive, which is why they survive reconciliation unchanged.
 */
export function applyCheat(room, p, code) {
  if (!p.alive) return false;
  const now = room.clock;
  if ((p.cheatReady[code] ?? 0) > now) return false;
  p.cheatReady[code] = now + CHEAT_COOLDOWN;

  switch (code) {
    case CHEAT.INVINCIBLE:
      p.invulnTime = Math.max(p.invulnTime, CHEAT_DURATION);
      break;
    case CHEAT.INVISIBLE:
      p.invisTime = Math.max(p.invisTime, CHEAT_DURATION);
      break;
    case CHEAT.HOP:
      // One-shot vertical kick. Going through applyImpulse clears `grounded`,
      // so the kart leaves the floor properly instead of being glued to it.
      applyImpulse(p.state, 0, CHEAT_HOP_SPEED, 0);
      break;
    case CHEAT.SPEED:
      p.state.boostTime = Math.max(p.state.boostTime, CHEAT_DURATION);
      break;
    case CHEAT.POWERUP:
      p.weapon = rollWeapon();
      room.events.push({ t: 'pickup', i: p.id, w: p.weapon, x: p.state.x, y: p.state.y, z: p.state.z });
      break;
    default:
      return false;
  }
  room.events.push({ t: 'cheat', i: p.id, c: code });
  return true;
}

function tryFire(room, p) {
  if (!p.alive || p.fireCooldown > 0) return;
  if (!p.input.fire) { p.firePressed = false; return; }
  // Edge-triggered so holding the button does not empty the inventory.
  if (p.firePressed) return;
  p.firePressed = true;

  const id = p.weapon;
  if (!id) return;
  const def = WEAPONS[id];
  if (!def) { p.weapon = null; return; }

  p.weapon = null;
  p.fireCooldown = 0.25;
  room.events.push({ t: 'fire', i: p.id, w: id });

  if (def.kind === 'self') {
    applySelfWeapon(def, p);
    return;
  }
  if (def.kind === 'stream') {
    p.stream = { w: id, remaining: def.duration, next: 0 };
    return;
  }
  const rivals = [...room.players.values()];
  room.projectiles.push(...spawnProjectiles(def, p, rivals));
}

function tickPickups(room, dt) {
  for (const box of room.boxes) {
    if (!box.alive) {
      if (room.clock >= box.respawnAt) {
        box.alive = true;
        room.events.push({ t: 'boxUp', x: box.x, y: box.y, z: box.z });
      }
      continue;
    }
    for (const p of room.players.values()) {
      if (!p.alive || p.weapon || p.stream) continue;
      const dx = p.state.x - box.x;
      const dz = p.state.z - box.z;
      if (dx * dx + dz * dz > (KART.radius + 1.1) ** 2) continue;
      if (Math.abs(p.state.y - box.y) > 2.2) continue;
      box.alive = false;
      box.respawnAt = room.clock + BOX_RESPAWN;
      p.weapon = rollWeapon();
      room.events.push({ t: 'pickup', i: p.id, w: p.weapon, x: box.x, y: box.y, z: box.z });
      break;
    }
  }
  void dt;
}

/** Advance the whole room by one fixed simulation step. */
export function stepRoom(room, dt = SIM_DT) {
  room.clock += dt;
  const map = room.map;
  const list = [...room.players.values()];

  for (const p of list) {
    if (p.invulnTime > 0) p.invulnTime = Math.max(0, p.invulnTime - dt);
    if (p.shieldTime > 0) p.shieldTime = Math.max(0, p.shieldTime - dt);
    if (p.invisTime > 0) p.invisTime = Math.max(0, p.invisTime - dt);
    if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt);

    if (!p.alive) {
      if (room.clock >= p.respawnAt) {
        respawn(room, p);
        room.events.push({ t: 'respawn', i: p.id, x: p.state.x, y: p.state.y, z: p.state.z });
      }
      continue;
    }

    // ── Gather this step's input ──
    if (p.isAi) {
      driveAi(p, list, map, p.input, dt, room.boxes, room.crateField);
    } else {
      let cmd = p.queue.shift();
      // If the client ran ahead, burn the backlog so we do not drift behind.
      while (p.queue.length > 8) cmd = p.queue.shift();
      if (!cmd) cmd = p.lastCmd;
      p.lastCmd = cmd;
      p.ackSeq = cmd.seq;
      unpackInput(cmd.bits, p.input);
    }

    tryFire(room, p);

    // ── Machine-gun style sustained fire ──
    if (p.stream) {
      const def = WEAPONS[p.stream.w];
      p.stream.remaining -= dt;
      p.stream.next -= dt;
      while (p.stream.next <= 0 && p.stream.remaining > 0) {
        p.stream.next += def.interval;
        room.projectiles.push(...spawnProjectiles(def, p, list));
      }
      if (p.stream.remaining <= 0) p.stream = null;
    }

    const force = applyEnvironment(map, p.state);
    stepKart(p.state, p.input, {
      solids: map.solids,
      floorY: map.floorY,
      externalAx: force.ax,
      externalAz: force.az,
      externalYawRate: force.yawRate,
    }, dt);

    if (p.state.y < map.killY) {
      damage(room, p, MAX_HP, null, { weapon: 'void' });
    }
  }

  // ── Kart-on-kart bumping ──
  const alive = list.filter((p) => p.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      resolveKartPair(alive[i].state, alive[j].state);
    }
  }

  const combatKarts = list.map((p) => ({ id: p.id, state: p.state, alive: p.alive, ref: p }));
  const fx = stepProjectiles(room.projectiles, combatKarts, map, dt, (k, amount, src, opts) => {
    damage(room, k.ref, amount, src, opts);
  });
  if (fx.length) room.events.push(...fx);

  tickPickups(room, dt);
}

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Change bot skill mid-room; existing bots pick it up immediately. */
export function setDifficulty(room, difficulty) {
  if (!isDifficulty(difficulty) || difficulty === room.difficulty) return;
  room.difficulty = difficulty;
  for (const p of room.players.values()) {
    if (p.brain) p.brain = createAiBrain(difficulty);
  }
}

export function roster(room) {
  return [...room.players.values()].map((p) => ({
    i: p.id, n: p.name, ai: p.isAi, c: p.color,
  }));
}

/**
 * Everything the waiting room needs to draw itself. Deliberately separate from
 * `snapshot`: a room that has not started has no meaningful kart state, and
 * sending 20 of those a second to people staring at a list of names would be
 * pure waste.
 */
export function lobbyState(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    mapId: room.mapId,
    difficulty: room.difficulty,
    maxPlayers: room.maxPlayers,
    fillWithBots: room.fillWithBots,
    matchSeconds: room.matchSeconds,
    humans: humanCount(room),
    players: [...room.players.values()]
      .filter((p) => !p.isAi)
      .map((p) => ({ i: p.id, n: p.name, c: p.color, host: p.id === room.hostId })),
  };
}

/**
 * Take a gathered room live.
 *
 * Everyone present is reseated from scratch so nobody starts the match halfway
 * through the arena or carrying a weapon they picked up while waiting, and the
 * bots the host asked for are added only now — a lobby full of bots would make
 * it impossible to see who had actually turned up.
 */
export function startMatch(room) {
  if (room.status === ROOM_STATUS.PLAYING) return false;
  room.status = ROOM_STATUS.PLAYING;
  room.clock = 0;
  room.projectiles.length = 0;
  room.events.length = 0;
  room.standings = null;
  room.endsAt = room.matchSeconds;
  room.boxes = room.map.boxes.map((b) => ({ x: b.x, y: b.y, z: b.z, alive: true, respawnAt: 0 }));

  if (room.fillWithBots) fillBots(room);

  let i = 0;
  for (const p of room.players.values()) {
    p.score = 0;
    p.kills = 0;
    p.deaths = 0;
    respawn(room, p, i++);
  }
  room.rosterDirty = true;
  return true;
}

/** Final standings, highest score first, ties broken by kills. */
export function standingsOf(room) {
  return [...room.players.values()]
    .sort((a, b) => b.score - a.score || b.kills - a.kills)
    .map((p, i) => ({
      i: p.id, n: p.name, ai: p.isAi, c: p.color, sc: p.score, k: p.kills, rank: i + 1,
    }));
}

/**
 * Blow the final whistle.
 *
 * Standings are captured here rather than read live on the client, because the
 * arena keeps running underneath the results screen — karts still collide,
 * mines already in the ground still go off — and a leaderboard that reshuffled
 * itself while players were reading it would make the winner ambiguous.
 */
function endMatch(room) {
  room.status = ROOM_STATUS.RESULTS;
  room.standings = standingsOf(room);
  room.resultsUntil = room.clock + RESULTS_SECONDS;
}

/** Results are over: wipe the slate and run it again. */
function restartMatch(room) {
  room.status = ROOM_STATUS.PLAYING;
  room.standings = null;
  room.endsAt = room.clock + room.matchSeconds;
  room.projectiles.length = 0;
  room.boxes = room.map.boxes.map((b) => ({ x: b.x, y: b.y, z: b.z, alive: true, respawnAt: 0 }));
  // Late arrivals joined during the last match or its results screen; seat
  // everyone together so nobody starts the new one mid-arena.
  if (room.fillWithBots) fillBots(room);
  let i = 0;
  for (const p of room.players.values()) {
    p.score = 0;
    p.kills = 0;
    p.deaths = 0;
    respawn(room, p, i++);
  }
  room.rosterDirty = true;
}

/**
 * Advance the match clock. Returns 'ended' or 'restarted' on the tick the
 * phase changes, so the caller can tell clients, and null otherwise.
 */
export function tickMatchClock(room) {
  if (room.status === ROOM_STATUS.PLAYING && room.endsAt && room.clock >= room.endsAt) {
    endMatch(room);
    return 'ended';
  }
  if (room.status === ROOM_STATUS.RESULTS && room.clock >= room.resultsUntil) {
    restartMatch(room);
    return 'restarted';
  }
  return null;
}

/** Seconds left in whatever phase the room is in. */
export function timeLeft(room) {
  if (room.status === ROOM_STATUS.PLAYING) return Math.max(0, room.endsAt - room.clock);
  if (room.status === ROOM_STATUS.RESULTS) return Math.max(0, room.resultsUntil - room.clock);
  return 0;
}

export function snapshot(room) {
  const dead = [];
  room.boxes.forEach((b, i) => { if (!b.alive) dead.push(i); });

  return {
    t: Date.now(),
    /** Phase and seconds left, so clients can run the countdown themselves. */
    ph: room.status,
    tl: Math.round(timeLeft(room) * 10) / 10,
    p: [...room.players.values()].map((p) => ({
      i: p.id,
      x: r2(p.state.x),
      y: r2(p.state.y),
      z: r2(p.state.z),
      a: r3(p.state.yaw),
      vx: r2(p.state.vx),
      vy: r2(p.state.vy),
      vz: r2(p.state.vz),
      yr: r2(p.state.yawRate),
      sp: r2(p.state.speed),
      g: p.state.grounded ? 1 : 0,
      dr: p.state.drifting ? 1 : 0,
      bt: r2(p.state.boostTime),
      st: r2(p.state.stunTime),
      h: Math.round(p.hp),
      sc: p.score,
      k: p.kills,
      w: p.weapon,
      sh: p.shieldTime > 0 ? 1 : 0,
      iv: p.invulnTime > 0 ? 1 : 0,
      iz: p.invisTime > 0 ? 1 : 0,
      al: p.alive ? 1 : 0,
      q: p.ackSeq,
    })),
    r: room.projectiles.map((p) => ({
      i: p.id, w: p.w, x: r2(p.x), y: r2(p.y), z: r2(p.z), a: r2(p.yaw),
    })),
    b: dead,
  };
}
