/**
 * Kart Combat — multiplayer server (Express + Socket.io)
 *
 * Run: npm start  →  node server.js  (localhost:3000)
 *
 * Dual broadcast: player:state + stateUpdate @ 30Hz
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import EVENT, {
  DEFAULT_ROOM_ID,
  DEFAULT_MAP_ID,
  MAP_IDS,
  DEFAULT_MAX_PLAYERS,
  clampMaxPlayers,
  TICK_MS,
  MAP_ARENA_RADIUS,
} from './server/protocol.js';

import {
  createPlayer,
  createRoom,
  allSnapshots,
  roomCounts,
  removeOneAi,
  fillAiToCapacity,
  trimAiToCapacity,
  respawnAiOnMap,
  getSpawn,
} from './server/rooms.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const FIXED_DT = TICK_MS / 1000;

const PHYS = {
  maxSpeed: 40,
  accel: 28,
  brake: 36,
  reverseMax: 14,
  steerRate: 2.4,
  driftSteerBoost: 1.5,
  drag: 0.985,
  fireRange: 10,
  fireCone: 0.5,
  fireDamage: 12,
  fireCooldown: 0.85,
  freezeDuration: 0.32,
  spawnInvuln: 3.0,
};

// ─── Express + Socket.io ─────────────────────────────────

const app = express();
app.use(express.static(join(__dirname, 'public')));
app.use('/src', express.static(join(__dirname, 'src')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

/** @type {Map<string, ReturnType<typeof createRoom>>} */
const rooms = new Map();

/** socket.id → { roomId, playerId } */
const socketIndex = new Map();

function getOrCreateRoom(roomId, mapId, maxPlayers = DEFAULT_MAX_PLAYERS) {
  const id = roomId || DEFAULT_ROOM_ID;
  const requestedMaxPlayers = clampMaxPlayers(maxPlayers);
  let room = rooms.get(id);
  if (!room) {
    room = createRoom(id, mapId || DEFAULT_MAP_ID, requestedMaxPlayers);
    fillAiToCapacity(room);
    rooms.set(id, room);
  } else if (mapId && MAP_IDS.includes(mapId) && roomCounts(room).humans === 0) {
    room.mapId = mapId;
    room.maxPlayers = requestedMaxPlayers;
    trimAiToCapacity(room);
    fillAiToCapacity(room);
    respawnAiOnMap(room);
  }
  return room;
}

function emitRoomUpdate(room) {
  const c = roomCounts(room);
  io.to(room.id).emit(EVENT.ROOM_UPDATE, {
    count: c.count,
    max: room.maxPlayers,
    maxPlayers: room.maxPlayers,
    aiCount: c.aiCount,
  });
}

function broadcastState(room) {
  const snaps = allSnapshots(room);
  io.to(room.id).emit(EVENT.PLAYER_STATE, snaps);
  io.to(room.id).emit('stateUpdate', snaps);
}

function arenaRadius(mapId) {
  return MAP_ARENA_RADIUS[mapId] ?? MAP_ARENA_RADIUS[DEFAULT_MAP_ID];
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ─── Physics / AI / Combat ───────────────────────────────

function applyInputPhysics(p, dt) {
  const groundY = typeof p.groundY === 'number' ? p.groundY : p.y;

  if (p.isFrozen) {
    p.vx *= 0.85;
    p.vz *= 0.85;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.y = groundY;
    return;
  }

  const inp = p.input;
  let steer = 0;
  if (inp.left) steer += 1;
  if (inp.right) steer -= 1;
  const steerMul = inp.drift ? PHYS.driftSteerBoost : 1;

  const speed = Math.hypot(p.vx, p.vz);
  if (Math.abs(steer) > 0 && speed > 0.5) {
    p.rotY += steer * PHYS.steerRate * steerMul * dt;
  }

  const forwardX = Math.sin(p.rotY);
  const forwardZ = Math.cos(p.rotY);

  if (inp.forward) {
    p.vx += forwardX * PHYS.accel * dt;
    p.vz += forwardZ * PHYS.accel * dt;
  }
  if (inp.back) {
    p.vx -= forwardX * PHYS.brake * dt;
    p.vz -= forwardZ * PHYS.brake * dt;
  }

  p.vx *= PHYS.drag;
  p.vz *= PHYS.drag;

  let sp = Math.hypot(p.vx, p.vz);
  const max = inp.back && !inp.forward ? PHYS.reverseMax : PHYS.maxSpeed;
  if (sp > max) {
    p.vx = (p.vx / sp) * max;
    p.vz = (p.vz / sp) * max;
  }

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.y = groundY;
}

/**
 * Smash-Karts-style bot AI: chase nearest human (or nearest kart ahead),
 * steer with light wobble, drift on sharp turns, fire in forward cone,
 * soft-turn back when outside arena radius.
 */
function updateAi(p, room, dt) {
  p._aiRetargetTimer = (p._aiRetargetTimer || 0) - dt;
  p._aiWobbleTimer = (p._aiWobbleTimer || 0) - dt;
  p._aiFireTimer = (p._aiFireTimer || 0) - dt;

  if (p._aiWobbleTimer <= 0) {
    p._aiWobbleTimer = 0.35 + Math.random() * 0.55;
    p._aiWobble = (Math.random() - 0.5) * 0.35;
  }

  // Pick / refresh chase target
  if (p._aiRetargetTimer <= 0 || !p._aiTargetId || !room.players.has(p._aiTargetId)) {
    p._aiRetargetTimer = 0.7 + Math.random() * 0.9;
    p._aiTargetId = pickAiTarget(p, room);
  }

  const target = p._aiTargetId ? room.players.get(p._aiTargetId) : null;
  let desiredYaw = p.rotY;

  const radius = arenaRadius(room.mapId);
  const distFromCenter = Math.hypot(p.x, p.z);
  const outside = distFromCenter > radius;

  if (outside) {
    // Face back toward center
    desiredYaw = Math.atan2(-p.x, -p.z);
  } else if (target) {
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    desiredYaw = Math.atan2(dx, dz) + (p._aiWobble || 0);
  } else {
    // Mild wander toward slight wobble heading
    desiredYaw = p.rotY + (p._aiWobble || 0) * 0.5;
  }

  const err = angleDiff(desiredYaw, p.rotY);
  const absErr = Math.abs(err);

  p.input.forward = true;
  p.input.back = false;
  p.input.left = err > 0.08;
  p.input.right = err < -0.08;
  // Drift on sharp turns while moving
  const speed = Math.hypot(p.vx, p.vz);
  p.input.drift = absErr > 0.55 && speed > 8;
  p.input.fire = false;

  // Fire when target roughly in forward cone and in range (skip spawn-invuln)
  if (target && !target.isInvincible && p._aiFireTimer <= 0) {
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.01 && dist <= PHYS.fireRange * 1.05) {
      const fx = Math.sin(p.rotY);
      const fz = Math.cos(p.rotY);
      const dot = (dx / dist) * fx + (dz / dist) * fz;
      if (dot >= Math.cos(PHYS.fireCone * 1.15)) {
        p.input.fire = true;
        p._aiFireTimer = 1.1 + Math.random() *  1.4;
      }
    }
    if (!p.input.fire && p._aiFireTimer <= 0) {
      // retry soon if not lined up
      p._aiFireTimer = 1.1 + Math.random() *  1.4;
    }
  }
}

function pickAiTarget(self, room) {
  let bestHuman = null;
  let bestHumanDist = Infinity;
  let bestAhead = null;
  let bestAheadScore = -Infinity;
  let bestAny = null;
  let bestAnyDist = Infinity;

  const fx = Math.sin(self.rotY);
  const fz = Math.cos(self.rotY);

  for (const other of room.players.values()) {
    if (other.id === self.id) continue;
    const dx = other.x - self.x;
    const dz = other.z - self.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) continue;

    if (!other.isAi && dist < bestHumanDist) {
      bestHumanDist = dist;
      bestHuman = other;
    }

    if (dist < bestAnyDist) {
      bestAnyDist = dist;
      bestAny = other;
    }

    const ndx = dx / dist;
    const ndz = dz / dist;
    const dot = ndx * fx + ndz * fz;
    // Prefer karts ahead (positive forward alignment)
    const score = dot * 12 - dist * 0.15;
    if (dot > 0.15 && score > bestAheadScore) {
      bestAheadScore = score;
      bestAhead = other;
    }
  }

  // Prefer chase nearest human, else nearest other kart ahead, else nearest anyone
  const chosen = bestHuman || bestAhead || bestAny;
  return chosen ? chosen.id : null;
}

function decayTimers(p, dt) {
  if (p._freezeTimer > 0) {
    p._freezeTimer -= dt;
    if (p._freezeTimer <= 0) {
      p._freezeTimer = 0;
      p.isFrozen = false;
    }
  }
  if (p._shrinkTimer > 0) {
    p._shrinkTimer -= dt;
    if (p._shrinkTimer <= 0) {
      p._shrinkTimer = 0;
      p.isShrunk = false;
    }
  }
  if (p._invincibleTimer > 0) {
    p._invincibleTimer -= dt;
    if (p._invincibleTimer <= 0) {
      p._invincibleTimer = 0;
      p.isInvincible = false;
    }
  }
  if (p._anchorTimer > 0) {
    p._anchorTimer -= dt;
    if (p._anchorTimer <= 0) {
      p._anchorTimer = 0;
      p.gravityAnchored = false;
    }
  }
  if (p._fireCooldown > 0) p._fireCooldown -= dt;
}

function tryFire(room, shooter) {
  if (shooter._fireCooldown > 0) return;
  if (!shooter.input.fire) return;
  shooter.input.fire = false;
  shooter._fireCooldown = PHYS.fireCooldown;

  const fx = Math.sin(shooter.rotY);
  const fz = Math.cos(shooter.rotY);

  let best = null;
  let bestDist = PHYS.fireRange;

  for (const target of room.players.values()) {
    if (target.id === shooter.id) continue;
    if (target.isInvincible) continue;

    const dx = target.x - shooter.x;
    const dz = target.z - shooter.z;
    const dist = Math.hypot(dx, dz);
    if (dist > PHYS.fireRange || dist < 0.01) continue;

    const ndx = dx / dist;
    const ndz = dz / dist;
    const dot = ndx * fx + ndz * fz;
    if (dot < Math.cos(PHYS.fireCone)) continue;

    if (dist < bestDist) {
      bestDist = dist;
      best = target;
    }
  }

  if (!best) return;

  best.hp = Math.max(0, best.hp - PHYS.fireDamage);
  best.isFrozen = true;
  best._freezeTimer = PHYS.freezeDuration;
  shooter.score += 1;

  const hitPayload = {
    targetId: best.id,
    fromId: shooter.id,
    damage: PHYS.fireDamage,
    effect: 'frozen',
  };
  io.to(room.id).emit(EVENT.PLAYER_HIT, hitPayload);
}


function grantSpawnInvuln(p, seconds = PHYS.spawnInvuln) {
  if (!p) return;
  p.isInvincible = true;
  p._invincibleTimer = seconds;
}

function respawnPlayer(room, p) {
  if (!room || !p) return;
  const humans = [...room.players.values()].filter((x) => !x.isAi);
  const index = Math.max(0, humans.findIndex((x) => x.id === p.id));
  const spawn = getSpawn(room.mapId, index, room.maxPlayers);
  p.x = spawn.x;
  p.y = spawn.y;
  p.z = spawn.z;
  p.rotY = spawn.rotY;
  p.vx = 0;
  p.vz = 0;
  p.hp = 100;
  p.isFrozen = false;
  p._freezeTimer = 0;
  p.groundY = spawn.y;
  p.currentWeapon = null;
  grantSpawnInvuln(p);
}


function clampInArena(p, room) {
  const limit = (arenaRadius(room.mapId) || 40) - 0.5;
  if (!(limit > 1)) return;
  if (room.mapId === 'beybladeArena' || room.mapId === 'skyPinball') {
    const r = Math.hypot(p.x, p.z);
    if (r > limit && r > 1e-6) {
      const s = limit / r;
      p.x *= s;
      p.z *= s;
      const radial = (p.vx * p.x + p.vz * p.z) / (limit * limit);
      if (radial > 0) {
        p.vx -= p.x * radial;
        p.vz -= p.z * radial;
      }
    }
  } else {
    // gravelPit (and default): square soft walls
    if (p.x > limit) { p.x = limit; if (p.vx > 0) p.vx *= -0.2; }
    else if (p.x < -limit) { p.x = -limit; if (p.vx < 0) p.vx *= -0.2; }
    if (p.z > limit) { p.z = limit; if (p.vz > 0) p.vz *= -0.2; }
    else if (p.z < -limit) { p.z = -limit; if (p.vz < 0) p.vz *= -0.2; }
  }
  // Keep on ground plane (no sky voyage)
  if (p.y > p.groundY + 8) p.y = p.groundY + 8;
  if (p.y < p.groundY - 2) p.y = p.groundY;
}

// ─── Tick loop ───────────────────────────────────────────

function tick(dt) {
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      decayTimers(p, dt);
      if (p.isAi) updateAi(p, room, dt);
      applyInputPhysics(p, dt);
      clampInArena(p, room);
      tryFire(room, p);
      if (p.hp <= 0) respawnPlayer(room, p);
    }
    broadcastState(room);
  }
}

setInterval(() => {
  tick(FIXED_DT);
}, TICK_MS);

// ─── Socket handlers ─────────────────────────────────────

io.on('connection', (socket) => {
  socket.on(EVENT.PLAYER_JOIN, (payload = {}) => {
    try {
      // Already in a room? leave first
      if (socketIndex.has(socket.id)) {
        leaveSocket(socket, false);
      }

      const roomId = payload.roomId || DEFAULT_ROOM_ID;
      const mapId = payload.mapId && MAP_IDS.includes(payload.mapId)
        ? payload.mapId
        : DEFAULT_MAP_ID;
      const raw = payload.maxPlayers ?? payload.playerCount;
      const maxPlayers = clampMaxPlayers(raw);
      const name = (payload.name && String(payload.name).slice(0, 24)) || 'Racer';

      const room = getOrCreateRoom(roomId, mapId, maxPlayers);

      // Free a slot for the human if at capacity
      if (room.players.size >= room.maxPlayers) {
        const removed = removeOneAi(room);
        if (!removed && room.players.size >= room.maxPlayers) {
          socket.emit(EVENT.ERROR, { message: 'Room full' });
          return;
        }
      }

      const index = room.players.size;
      const player = createPlayer({
        name,
        isAi: false,
        socketId: socket.id,
        index,
        mapId: room.mapId,
      });
      const spawn = { x: player.x, y: player.y, z: player.z, rotY: player.rotY };
      room.players.set(player.id, player);
      grantSpawnInvuln(player);
      fillAiToCapacity(room);

      socket.join(room.id);
      socketIndex.set(socket.id, { roomId: room.id, playerId: player.id });

      socket.emit(EVENT.PLAYER_WELCOME, {
        playerId: player.id,
        roomId: room.id,
        mapId: room.mapId,
        spawn,
        max: room.maxPlayers,
        maxPlayers: room.maxPlayers,
        players: allSnapshots(room),
      });

      emitRoomUpdate(room);
      broadcastState(room);
    } catch (err) {
      console.error('player:join error', err);
      socket.emit(EVENT.ERROR, { message: 'Join failed' });
    }
  });

  socket.on(EVENT.PLAYER_INPUT, (payload = {}) => {
    const ref = socketIndex.get(socket.id);
    if (!ref) return;
    const room = rooms.get(ref.roomId);
    if (!room) return;
    const player = room.players.get(ref.playerId);
    if (!player || player.isAi) return;

    const inp = player.input;
    if (typeof payload.seq === 'number') inp.seq = payload.seq;
    if (typeof payload.forward === 'boolean') inp.forward = payload.forward;
    if (typeof payload.back === 'boolean') inp.back = payload.back;
    if (typeof payload.left === 'boolean') inp.left = payload.left;
    if (typeof payload.right === 'boolean') inp.right = payload.right;
    if (typeof payload.drift === 'boolean') inp.drift = payload.drift;
    if (payload.fire) inp.fire = true;
  });

  socket.on(EVENT.PLAYER_LEAVE, () => {
    leaveSocket(socket, true);
  });

  socket.on('disconnect', () => {
    leaveSocket(socket, true);
  });
});

function leaveSocket(socket, refill) {
  const ref = socketIndex.get(socket.id);
  if (!ref) return;
  socketIndex.delete(socket.id);

  const room = rooms.get(ref.roomId);
  if (!room) return;

  const player = room.players.get(ref.playerId);
  if (player) {
    room.players.delete(ref.playerId);
    io.to(room.id).emit(EVENT.PLAYER_LEAVE, { playerId: ref.playerId });
  }

  socket.leave(room.id);

  if (refill) {
    fillAiToCapacity(room);
  }

  emitRoomUpdate(room);
  broadcastState(room);

  // Drop empty rooms that have only AI and no recent humans? Keep default with AI.
  if (room.id !== DEFAULT_ROOM_ID) {
    let humans = 0;
    for (const p of room.players.values()) if (!p.isAi) humans++;
    if (humans === 0) rooms.delete(room.id);
  }
}

// ─── Listen ──────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Kart Combat server listening on http://127.0.0.1:${PORT}`);
});

export { app, io, httpServer };
