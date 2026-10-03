/**
 * A room owns one match: its map, its karts (human and bot), the mystery
 * boxes, and every projectile in flight. Everything here is authoritative —
 * clients only ever send button presses.
 */

import {
  MAX_HP, SPAWN_INVULN, SIM_DT,
  DEATH_CAM_SECONDS, RESPAWN_COUNTDOWN, AUTO_RESPAWN_SECONDS, BOT_RESPAWN_JITTER,
  DEFAULT_MAP_ID, clampMaxPlayers, unpackInput, KART_COLORS,
  CHEAT, CHEAT_DURATION, CHEAT_HOP_SPEED, CHEAT_COOLDOWN, ROOM_STATUS,
  DEFAULT_MATCH_SECONDS, ROUND_OVER_SECONDS, RESULTS_SECONDS,
} from '../shared/constants.js';
import { createKartState, createInput, stepKart, resolveKartPair, applyImpulse, KART } from '../shared/physics.js';
import { getMap, getSpawn, applyEnvironment } from '../shared/maps/index.js';
import { createAiBrain, driveAi, DEFAULT_DIFFICULTY, isDifficulty } from '../shared/ai/index.js';
import {
  WEAPONS, rollWeapon, spawnProjectiles, stepProjectiles, applySelfWeapon,
  isTimedWeapon, chargesOf, slotBadge,
} from '../shared/weapons.js';
import {
  CHARACTER_IDS, KART_IDS, validCharacter, validKart,
} from '../shared/cosmetics.js';

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
    /**
     * Room clock at which the current match ends.
     *
     * A quick-play room is born already running, so it never passes through
     * `startMatch` and has to start its own clock here. Leaving this at 0 gave
     * public matches a timer frozen at 0:00 that never ended a round.
     */
    endsAt: isPrivate ? 0 : DEFAULT_MATCH_SECONDS,
    /** Room clock at which "ROUND OVER" gives way to the winners. */
    roundOverUntil: 0,
    /** Room clock at which the winners screen gives way to the next match. */
    resultsUntil: 0,
    /** Standings frozen at the final whistle, so they cannot drift on screen. */
    standings: null,
    /** Everyone on the top score at the whistle; empty if nobody scored. */
    winners: [],
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

/** Bots get a random look so a field of them is not eight identical karts. */
function randomLook() {
  return {
    character: CHARACTER_IDS[Math.floor(Math.random() * CHARACTER_IDS.length)],
    kart: KART_IDS[Math.floor(Math.random() * KART_IDS.length)],
  };
}

export function createPlayer(room, { name, isAi, socketId, character, kart }) {
  const index = room.players.size;
  const spawn = getSpawn(room.mapId, index);
  const p = {
    id: `p${nextPlayerId++}`,
    name: name || (isAi ? claimBotName(room) : 'Racer'),
    isAi: !!isAi,
    socketId: socketId || null,
    color: KART_COLORS[room.nextColor++ % KART_COLORS.length],
    // Cosmetic only — nothing here touches physics, so a kart that looks like
    // a monster truck handles exactly like one that looks like a pod.
    character: isAi ? randomLook().character : validCharacter(character),
    kart: isAi ? randomLook().kart : validKart(kart),

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
    // ── While wrecked (see DEATH_CAM_SECONDS in shared/constants.js) ──
    /** Room clock from which a respawn request is honoured. */
    respawnAt: 0,
    /** Room clock at which a human who never asks is put back anyway. */
    autoRespawnAt: 0,
    /** Who wrecked us, for the spectate camera; null for falls and self-kills. */
    killerId: null,
    /** A respawn request arrived and was accepted; acted on next step. */
    wantsRespawn: false,
    /** A bot's extra wait, so bots caught in one blast do not reappear together. */
    botJitter: 0,
    /**
     * Sitting out between rounds: a new round has started without this human,
     * and they drop in when they say so ("Press Space to join").
     */
    awaitingJoin: false,
    invulnTime: SPAWN_INVULN,
    shieldTime: 0,
    /** Cheat-only: hides the kart from everyone else while it runs. */
    invisTime: 0,
    /** Per-cheat cooldown stamps, so a held key cannot spam an effect. */
    cheatReady: {},

    // ── The weapon slot ──
    /** Weapon id or null. Kept as a bare id: the AI and the snapshot read it. */
    weapon: null,
    /** Presses (or rounds, for a held weapon) left in the slot. */
    ammo: 0,
    /** Seconds left on a timed weapon once switched on; 0 = not running. */
    timer: 0,
    /** Spike-ball victims this activation: id → clock before which to skip them. */
    orbitHits: new Map(),
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
  p.autoRespawnAt = 0;
  p.killerId = null;
  p.wantsRespawn = false;
  p.awaitingJoin = false;
  // Anyone dropping back in while the winners are up keeps the bubble the
  // rest of the field is wearing, rather than losing it three seconds in.
  p.invulnTime = room.status === ROOM_STATUS.RESULTS
    ? Math.max(SPAWN_INVULN, room.resultsUntil - room.clock)
    : SPAWN_INVULN;
  p.shieldTime = 0;
  p.invisTime = 0;
  clearSlot(p);
  // The key that brought you back is very likely still down — "Press Any
  // Key" invites exactly that — and it must not also fire the first thing
  // you pick up. Fire stays latched until it is released.
  p.firePressed = true;
  p.queue.length = 0;
  if (p.brain) p.brain = createAiBrain(room.difficulty);
}

/** Take a human out of a freshly started round until they ask to join it. */
function sitOut(p) {
  p.alive = false;
  p.awaitingJoin = true;
  p.wantsRespawn = false;
  p.killerId = null;
  p.respawnAt = 0;
  p.autoRespawnAt = Infinity;
}

/** Fill the weapon slot with a fresh pickup. */
function loadSlot(p, id) {
  clearSlot(p);
  p.weapon = id;
  p.ammo = chargesOf(WEAPONS[id]);
}

function clearSlot(p) {
  p.weapon = null;
  p.ammo = 0;
  p.timer = 0;
  p.stream = null;
  p.orbitHits.clear();
}

/**
 * Put a weapon straight into a player's slot, as if they had driven through a
 * crate. For tests and tools; matches never call it.
 */
export function giveWeapon(room, p, id) {
  if (!WEAPONS[id]) return false;
  loadSlot(p, id);
  return true;
}

/**
 * Deal damage. Returns what happened, so callers that need to know (the
 * spike balls) can tell a kill from a shrug: 'blocked', 'hit', 'killed', or
 * null when nothing could happen at all.
 */
function damage(room, target, amount, sourceId, opts = {}) {
  if (!target.alive || amount < 0) return null;
  const isVoid = opts.weapon === 'void';
  const live = room.status === ROOM_STATUS.PLAYING;
  // Outside a live round nothing hurts and nothing scores, so the standings on
  // screen are the standings that count. Falling off the world is the one
  // exception: there is nowhere to put a kart that has left the arena except
  // back at a spawn point.
  if (!live && !isVoid) return null;

  // No shield holds you up in mid-air. Letting it block the fall left a
  // protected kart dropping through the void until the protection ran out.
  const shielded = !isVoid && (target.shieldTime > 0 || target.invulnTime > 0);

  // The freeze ray takes half of what you have left, so it always hurts and
  // never kills — it is a control weapon, not a finisher. Rounded down so the
  // last point of health can only be taken by something else.
  if (opts.halveHealth) amount = Math.max(0, Math.floor(target.hp / 2));

  if (!shielded && opts.knockback) {
    applyImpulse(target.state, opts.knockback.x, opts.knockback.y, opts.knockback.z);
  }
  if (shielded) {
    room.events.push({ t: 'block', i: target.id });
    return 'blocked';
  }
  if (opts.stun) target.state.stunTime = Math.max(target.state.stunTime, opts.stun);

  const dealt = Math.min(target.hp, amount);
  target.hp -= dealt;
  room.events.push({
    t: 'hit', i: target.id, by: sourceId, d: Math.round(dealt), w: opts.weapon || null,
  });

  if (target.hp > 0) return 'hit';

  target.hp = 0;
  target.alive = false;
  if (live) target.deaths++;
  clearSlot(target);
  // Scores only ever go up. Driving into someone, or dropping off the edge,
  // costs you the respawn wait and nothing else — the same deal Smash Karts
  // gives you. Points come strictly from knocking others out with a weapon.
  const killer = sourceId && sourceId !== target.id ? room.players.get(sourceId) : null;
  if (killer) {
    killer.kills++;
    killer.score += 1;
  }

  // Death cam, then the countdown over the killer, then you may come back.
  target.respawnAt = room.clock + DEATH_CAM_SECONDS + RESPAWN_COUNTDOWN;
  target.autoRespawnAt = room.clock + AUTO_RESPAWN_SECONDS;
  target.killerId = killer ? killer.id : null;
  target.wantsRespawn = false;
  target.botJitter = target.isAi ? Math.random() * BOT_RESPAWN_JITTER : 0;

  room.events.push({
    t: 'kill',
    i: target.id,
    by: killer ? killer.id : null,
    // What did it, for the death message: a weapon id, or 'void' for a fall.
    w: opts.weapon || null,
    self: sourceId && sourceId === target.id ? 1 : 0,
    x: target.state.x, y: target.state.y, z: target.state.z,
  });
  return 'killed';
}

/**
 * A player asked to be put back in (EVENT.RESPAWN). Honoured only for someone
 * sitting out between rounds, or for a wreck whose death cam and countdown
 * are both over; anything earlier is dropped rather than remembered, so a key
 * pressed during the countdown does not cut it short the moment it ends.
 * Returns whether the request was accepted.
 */
export function requestRespawn(room, p) {
  if (!p || p.alive) return false;
  if (!p.awaitingJoin && respawnWait(room, p) > 0) return false;
  p.wantsRespawn = true;
  return true;
}

/**
 * Seconds before a wreck may ask to come back; 0 once it may. The snapshot's
 * `rt` and the request gate both read this, so the moment a client sees 0
 * and shows "Press Any Key" is exactly the moment a press is accepted — a
 * press in a gap between the two would simply be lost. The epsilon absorbs
 * the float error of a clock built from 1/60 s steps.
 */
function respawnWait(room, p) {
  const left = p.respawnAt - room.clock;
  return left > 1e-6 ? left : 0;
}

/** Should this wrecked (or sitting-out) player come back on this step? */
function readyToRespawn(room, p) {
  if (p.awaitingJoin) return p.wantsRespawn;
  if (respawnWait(room, p) > 0) return false;
  if (p.isAi) return room.clock >= p.respawnAt + p.botJitter;
  return p.wantsRespawn || room.clock >= p.autoRespawnAt;
}

/**
 * Apply one hidden cheat to a player. Authoritative like everything else, so
 * the client only ever asks; the effects themselves reuse the same state the
 * normal weapons drive, which is why they survive reconciliation unchanged.
 */
/**
 * `opts.weapon` asks POWERUP for a particular weapon instead of a random roll,
 * so every weapon can be tried on demand (scripts/weapontest.mjs does exactly
 * that). Anything that is not a real weapon id falls back to the roll.
 */
export function applyCheat(room, p, code, opts = {}) {
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
      loadSlot(p, Object.hasOwn(WEAPONS, opts.weapon ?? '') ? opts.weapon : rollWeapon());
      room.events.push({ t: 'pickup', i: p.id, w: p.weapon, x: p.state.x, y: p.state.y, z: p.state.z });
      break;
    default:
      return false;
  }
  room.events.push({ t: 'cheat', i: p.id, c: code });
  return true;
}

function tryFire(room, p) {
  if (!p.input.fire) {
    p.firePressed = false;
    // Letting go ends a held weapon's burst; whatever rounds are left stay in
    // the slot for the next squeeze.
    p.stream = null;
    return;
  }
  // Edge-triggered so holding the button does not empty the inventory. A
  // `hold` weapon is the exception, and the press only starts its stream;
  // stepRoom keeps it firing for as long as the button stays down.
  if (p.firePressed || p.fireCooldown > 0) return;
  p.firePressed = true;

  const id = p.weapon;
  if (!id) return;
  const def = WEAPONS[id];
  if (!def) { clearSlot(p); return; }

  if (isTimedWeapon(def)) {
    // Already running: the slot stays locked until it wears off, and pressing
    // again does nothing.
    if (p.timer > 0) return;
    p.timer = def.duration;
    if (def.shield) p.shieldTime = def.duration;
    p.orbitHits.clear();
  } else if (def.hold) {
    p.stream = { w: id, next: 0 };
  } else {
    p.ammo -= 1;
    if (def.kind === 'self') applySelfWeapon(def, p);
    else room.projectiles.push(...spawnProjectiles(def, p, [...room.players.values()]));
    if (p.ammo <= 0) clearSlot(p);
  }
  p.fireCooldown = 0.25;
  room.events.push({ t: 'fire', i: p.id, w: id });
}

function tickPickups(room) {
  for (const box of room.boxes) {
    if (!box.alive) {
      if (room.clock >= box.respawnAt) {
        box.alive = true;
        room.events.push({ t: 'boxUp', x: box.x, y: box.y, z: box.z });
      }
      continue;
    }
    for (const p of room.players.values()) {
      // A slot still holding anything — unused, half-spent or still running —
      // is not empty, so you drive straight through the crate.
      if (!p.alive || p.weapon) continue;
      const dx = p.state.x - box.x;
      const dz = p.state.z - box.z;
      if (dx * dx + dz * dz > (KART.radius + 1.1) ** 2) continue;
      if (Math.abs(p.state.y - box.y) > 2.2) continue;
      box.alive = false;
      box.respawnAt = room.clock + BOX_RESPAWN;
      loadSlot(p, rollWeapon());
      room.events.push({ t: 'pickup', i: p.id, w: p.weapon, x: box.x, y: box.y, z: box.z });
      break;
    }
  }
}

/**
 * Spike balls: anything that touches the ring around a kart running them is
 * wrecked. Contact is tested against the whole circle the balls sweep rather
 * than their exact angles — with four balls going round several times a
 * second, any kart that reaches the ring is struck within a fraction of a
 * second anyway, and it means the client can draw the balls at any phase
 * without ever showing a "hit" that the server did not count. Other karts
 * cannot get inside the ring (bumping keeps them 1.7 m from its centre, and
 * the balls reach in further than that), so the test is a plain disc.
 */
function tickOrbits(room, list) {
  for (const p of list) {
    if (!p.alive || p.timer <= 0) continue;
    const def = WEAPONS[p.weapon];
    if (def?.kind !== 'orbit') continue;
    const reach = def.radius + def.ballRadius + KART.radius;
    for (const k of list) {
      if (k === p || !k.alive) continue;
      const dx = k.state.x - p.state.x;
      const dz = k.state.z - p.state.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > reach * reach) continue;
      if (Math.abs(k.state.y - p.state.y) > KART.height) continue;
      // Each victim is struck at most once per activation. A shield that
      // shrugs it off is tried again half a second later rather than every
      // step, so it does not flood clients with block events, and so a
      // shield that runs out mid-contact still leaves you exposed.
      if ((p.orbitHits.get(k.id) ?? 0) > room.clock) continue;
      const d = Math.sqrt(d2) || 1;
      const result = damage(room, k, def.damage, p.id, {
        weapon: def.id,
        knockback: { x: (dx / d) * def.knockback, y: 4, z: (dz / d) * def.knockback },
      });
      if (result) p.orbitHits.set(k.id, result === 'blocked' ? room.clock + 0.5 : Infinity);
    }
  }
}

/** Advance the whole room by one fixed simulation step. */
/** Ticks of input a human can bank to absorb a hitch: ~170 ms at 60 Hz. */
const CMD_CREDIT_MAX = 10;
/** Queued commands beyond this are dropped: the client is running fast. */
const MAX_CMD_BACKLOG = 12;

/** One simulation step of one kart: its weapon, then its physics. */
function stepPlayer(room, p, list, live, dt) {
  const map = room.map;
  if (live) {
    tryFire(room, p);

    // ── Held weapons (machine gun): a fixed rate for as long as the trigger
    // stays down, until the rounds run out ──
    if (p.stream) {
      const def = WEAPONS[p.stream.w];
      p.stream.next -= dt;
      while (p.stream.next <= 0 && p.ammo > 0) {
        p.stream.next += def.interval;
        p.ammo -= 1;
        room.projectiles.push(...spawnProjectiles(def, p, list));
      }
      if (p.ammo <= 0) clearSlot(p);
    }
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

export function stepRoom(room, dt = SIM_DT) {
  room.clock += dt;
  const map = room.map;
  const list = [...room.players.values()];
  // Outside a live round the arena keeps moving — karts drive, collide and
  // can fall off — but nothing fires, nothing is picked up and nobody scores.
  const live = room.status === ROOM_STATUS.PLAYING;

  for (const p of list) {
    if (p.invulnTime > 0) p.invulnTime = Math.max(0, p.invulnTime - dt);
    if (p.shieldTime > 0) p.shieldTime = Math.max(0, p.shieldTime - dt);
    if (p.invisTime > 0) p.invisTime = Math.max(0, p.invisTime - dt);
    if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    if (p.timer > 0) {
      p.timer = Math.max(0, p.timer - dt);
      // The shield bubble is the timed weapon running, so it lasts exactly
      // as long as the slot's countdown says it does.
      if (WEAPONS[p.weapon]?.shield) p.shieldTime = p.timer;
      if (p.timer === 0) clearSlot(p);
    }

    if (!p.alive) {
      // Keep acknowledging a dead player's input. The client goes on sending
      // commands while it waits, and if they are never acked it replays an
      // ever-growing backlog against every snapshot and drifts away from the
      // wreck. Only the newest command matters: it is what is held down now.
      if (!p.isAi) {
        const last = p.queue.at(-1);
        if (last) {
          p.lastCmd = last;
          p.ackSeq = last.seq;
          unpackInput(last.bits, p.input);
        }
        p.queue.length = 0;
      }
      if (readyToRespawn(room, p)) {
        respawn(room, p);
        room.events.push({
          t: 'respawn', i: p.id, x: p.state.x, y: p.state.y, z: p.state.z,
          // Facing, so the client can put its camera straight behind the kart
          // instead of swinging round from wherever it was looking.
          a: r3(p.state.yaw),
        });
      }
      continue;
    }

    if (p.isAi) {
      driveAi(p, list, map, p.input, dt, room.boxes, room.crateField);
      stepPlayer(room, p, list, live, dt);
      continue;
    }

    // ── A human: exactly one step per command they sent ──
    //
    // The client predicts its own kart by running every command it sends
    // through the same physics, so the server must run each of them exactly
    // once too. It used to take one command per tick whatever happened: when
    // the queue ran dry it re-ran the last command (a step the client never
    // took), and when more than eight piled up it threw the extras away (steps
    // the client did take). Both left the two simulations a step or two apart,
    // which the client then had to correct every snapshot — at speed that is
    // most of a metre, and it showed as the kart rubber-banding.
    //
    // Commands are paid for with credit earned at one per tick, banked up to
    // CMD_CREDIT_MAX. A burst after a hitch on the client or the network is
    // spent straight away, so nothing is lost, while a client sending faster
    // than real time still only gets one step per tick on average.
    p.cmdCredit = Math.min(CMD_CREDIT_MAX, (p.cmdCredit ?? 0) + 1);
    while (p.cmdCredit >= 1 && p.queue.length && p.alive) {
      const cmd = p.queue.shift();
      p.cmdCredit -= 1;
      p.lastCmd = cmd;
      p.ackSeq = cmd.seq;
      unpackInput(cmd.bits, p.input);
      stepPlayer(room, p, list, live, dt);
    }
    if (!p.queue.length && p.cmdCredit >= CMD_CREDIT_MAX && p.lastCmd && p.alive) {
      // Silent for a while (a backgrounded tab, a stalled connection): keep
      // the kart physical on its last input rather than freezing it in mid
      // air. These steps are ours, not the client's, so nothing is acked.
      stepPlayer(room, p, list, live, dt);
    }
    // A backlog this deep is no longer a hiccup but a client running ahead of
    // real time; trim it rather than let its input lag grow without limit.
    if (p.queue.length > MAX_CMD_BACKLOG) p.queue.splice(0, p.queue.length - MAX_CMD_BACKLOG);
  }

  // ── Kart-on-kart bumping ──
  const alive = list.filter((p) => p.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      resolveKartPair(alive[i].state, alive[j].state);
    }
  }

  if (live) tickOrbits(room, list);

  const combatKarts = list.map((p) => ({ id: p.id, state: p.state, alive: p.alive, ref: p }));
  const fx = stepProjectiles(room.projectiles, combatKarts, map, dt, (k, amount, src, opts) => {
    damage(room, k.ref, amount, src, opts);
  });
  if (fx.length) room.events.push(...fx);

  if (live) tickPickups(room);
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
    i: p.id, n: p.name, ai: p.isAi, c: p.color, ch: p.character, kt: p.kart,
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
      .map((p) => ({
        i: p.id, n: p.name, c: p.color, ch: p.character, kt: p.kart,
        host: p.id === room.hostId,
      })),
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
  room.winners = [];
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

/**
 * Final standings, highest score first.
 *
 * Ranks are competition ranks ("1, 1, 3"): players on the same score share a
 * place. Score is only ever earned one kill at a time, so it always equals
 * kills and there is no honest tie-break — giving one of two players on 9 a
 * silver medal would be picking a winner at random. Kills still order the
 * list, for the day score and kills come apart.
 */
export function standingsOf(room) {
  const players = [...room.players.values()];
  return players
    .sort((a, b) => b.score - a.score || b.kills - a.kills)
    .map((p) => ({
      i: p.id, n: p.name, ai: p.isAi, c: p.color, sc: p.score, k: p.kills,
      rank: 1 + players.filter((o) => o.score > p.score).length,
    }));
}

/** Everyone on the top score, or nobody if nobody scored at all. */
export function winnersOf(standings) {
  const top = standings.length ? standings[0].sc : 0;
  if (top <= 0) return [];
  return standings.filter((s) => s.sc === top).map((s) => s.i);
}

/**
 * Blow the final whistle: "ROUND OVER" over the live arena, then the winners.
 *
 * Standings are captured here rather than read live on the client, because the
 * arena keeps running underneath — karts still drive and collide — and a
 * leaderboard that reshuffled itself while players were reading it would make
 * the winner ambiguous. Nothing in flight is allowed to land after the
 * whistle either: it could not score, so it is simply cleared.
 */
function endMatch(room) {
  room.status = ROOM_STATUS.ROUND_OVER;
  room.standings = standingsOf(room);
  room.winners = winnersOf(room.standings);
  room.roundOverUntil = room.clock + ROUND_OVER_SECONDS;
  room.resultsUntil = room.roundOverUntil + RESULTS_SECONDS;
  room.projectiles.length = 0;
  for (const p of room.players.values()) p.stream = null;
}

/**
 * "ROUND OVER" gives way to the winners. Everyone still driving gets the
 * green spawn bubble for the rest of the break, as in the original — nothing
 * can hurt them now anyway, and it marks the arena as out of play.
 */
function showWinners(room) {
  room.status = ROOM_STATUS.RESULTS;
  for (const p of room.players.values()) {
    if (p.alive) p.invulnTime = Math.max(p.invulnTime, room.resultsUntil - room.clock);
  }
}

/**
 * The winners screen is over: wipe the slate and run it again.
 *
 * Bots are reseated and go straight back in. Humans sit the new round out
 * until they say they are ready (EVENT.RESPAWN, "Press Space to join"), the
 * way the original does it — someone who has wandered off from the keyboard
 * is not dropped into a fight they cannot see.
 */
function restartMatch(room) {
  room.status = ROOM_STATUS.PLAYING;
  room.standings = null;
  room.winners = [];
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
    if (!p.isAi) sitOut(p);
  }
  room.rosterDirty = true;
}

/**
 * Advance the match clock. Returns 'ended' (the whistle: "ROUND OVER"),
 * 'winners' (the winners screen) or 'restarted' on the tick the phase
 * changes, so the caller can tell clients, and null otherwise.
 */
export function tickMatchClock(room) {
  if (room.status === ROOM_STATUS.PLAYING && room.endsAt && room.clock >= room.endsAt) {
    endMatch(room);
    return 'ended';
  }
  if (room.status === ROOM_STATUS.ROUND_OVER && room.clock >= room.roundOverUntil) {
    showWinners(room);
    return 'winners';
  }
  if (room.status === ROOM_STATUS.RESULTS && room.clock >= room.resultsUntil) {
    restartMatch(room);
    return 'restarted';
  }
  return null;
}

/**
 * Seconds left in whatever phase the room is in. Between rounds — "ROUND
 * OVER" and the winners alike — that is the time until the next round
 * starts, which is the only countdown anyone is shown then.
 */
export function timeLeft(room) {
  if (room.status === ROOM_STATUS.PLAYING) return Math.max(0, room.endsAt - room.clock);
  if (room.status === ROOM_STATUS.ROUND_OVER || room.status === ROOM_STATUS.RESULTS) {
    return Math.max(0, room.resultsUntil - room.clock);
  }
  return 0;
}

/**
 * What EVENT.MATCH_OVER carries, as seen from right now: sent to everyone at
 * the whistle, and to anyone who arrives while the round is over so they see
 * the same screen as everybody else rather than a blank HUD. Both countdowns
 * run from the moment it is sent: `roundOverSeconds` until the winners are
 * named (0 once they are), `nextIn` until the next round starts. Null while a
 * round is being played.
 */
export function matchOverPayload(room) {
  if (room.status !== ROOM_STATUS.ROUND_OVER && room.status !== ROOM_STATUS.RESULTS) return null;
  if (!room.standings) return null;
  return {
    standings: room.standings,
    winners: room.winners,
    roundOverSeconds: Math.round(Math.max(0, room.roundOverUntil - room.clock) * 10) / 10,
    nextIn: Math.round(timeLeft(room) * 10) / 10,
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

/** One kart's line in a snapshot. */
function playerSnapshot(room, p) {
  const def = p.weapon ? WEAPONS[p.weapon] : null;
  // Sitting out between rounds is not being wrecked: there is no killer to
  // watch and no countdown to run, just an invitation to join.
  const wrecked = !p.alive && !p.awaitingJoin;
  return {
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
    /** Slot badge: presses or rounds left, or whole seconds on a timed weapon; 0 = none. */
    wn: slotBadge(def, p.ammo, p.timer),
    /** 1 while a timed weapon (shield, spike balls) is switched on. */
    wt: isTimedWeapon(def) && p.timer > 0 ? 1 : 0,
    sh: p.shieldTime > 0 ? 1 : 0,
    iv: p.invulnTime > 0 ? 1 : 0,
    /** Spawn-protection seconds left, so the bubble can blink as it ends. */
    ivt: r1(p.invulnTime),
    iz: p.invisTime > 0 ? 1 : 0,
    al: p.alive ? 1 : 0,
    /**
     * Seconds until a respawn request is honoured; 0 once it is, and while
     * alive. Rounded up, never to the nearest, so 0 is never shown early.
     */
    rt: wrecked ? Math.ceil(respawnWait(room, p) * 10 - 1e-6) / 10 : 0,
    /** Who wrecked us, while wrecked: the kart the spectate camera follows. */
    kb: wrecked ? p.killerId : null,
    /** 0 while sitting out a new round, until asking to join it. */
    jn: p.awaitingJoin ? 0 : 1,
    q: p.ackSeq,
  };
}

export function snapshot(room) {
  const dead = [];
  room.boxes.forEach((b, i) => { if (!b.alive) dead.push(i); });

  return {
    t: Date.now(),
    /**
     * Phase and seconds left, so clients can run the countdown themselves.
     * Between rounds ('roundOver', 'results') `tl` counts to the next round.
     */
    ph: room.status,
    tl: r1(timeLeft(room)),
    p: [...room.players.values()].map((p) => playerSnapshot(room, p)),
    r: room.projectiles.map((p) => ({
      i: p.id, w: p.w, x: r2(p.x), y: r2(p.y), z: r2(p.z), a: r2(p.yaw),
    })),
    b: dead,
  };
}
