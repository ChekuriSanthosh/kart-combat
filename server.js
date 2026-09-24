/**
 * Kart Combat — authoritative game server.
 *
 * Simulation runs at a fixed 60 Hz using the same module the browser uses to
 * predict, and snapshots go out at 20 Hz. Clients send button presses only.
 *
 *   npm start   →   http://localhost:3000
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  EVENT, SIM_DT, SIM_HZ, SNAPSHOT_MS,
  MAP_IDS, DEFAULT_MAP_ID, JOIN_MODE,
  ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode,
  DEFAULT_MAX_PLAYERS, clampMaxPlayers, CHEAT_CODES, ROOM_STATUS,
} from './shared/constants.js';
import { getMap } from './shared/maps/index.js';
import {
  createRoom, createPlayer, fillBots, removeOneBot, trimBots,
  humanCount, setMap, setDifficulty, stepRoom, snapshot, roster, applyCheat,
  lobbyState, startMatch,
} from './server/room.js';
import { DEFAULT_DIFFICULTY, isDifficulty, getNavGrid } from './shared/ai/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(join(__dirname, 'public')));
// The browser imports the same simulation modules the server runs.
app.use('/shared', express.static(join(__dirname, 'shared')));
// Three.js is vendored rather than pulled from a CDN so the game runs offline.
app.use('/vendor/three', express.static(join(__dirname, 'node_modules/three/build')));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

/** @type {Map<string, ReturnType<typeof createRoom>>} */
const rooms = new Map();
/** socket.id → { roomId, playerId } */
const index = new Map();

function newRoomCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  // Astronomically unlikely with a 30-character alphabet, but never hand back
  // a code that is already in use.
  return `${Date.now().toString(36).toUpperCase()}`;
}

function openRoom(mapId, maxPlayers, isPrivate, difficulty) {
  const room = createRoom(newRoomCode(), mapId, maxPlayers, { isPrivate, difficulty });
  // A private room is still gathering, and filling it with bots up front would
  // hide the only thing its host wants to see: who has actually arrived.
  if (room.status === ROOM_STATUS.PLAYING) fillBots(room);
  rooms.set(room.id, room);
  return room;
}

/** Free seats for humans; bots give up their place when someone real arrives. */
function hasSpace(room) {
  return humanCount(room) < room.maxPlayers;
}

/**
 * Place a player into a match.
 *
 * Quick play drops you into any public room that still has space, preferring
 * the busiest one so matches fill up instead of everyone sitting alone with
 * bots. A code takes you to one specific room and fails loudly if it has gone.
 */
function findRoom({ mode, code, mapId, maxPlayers, difficulty }) {
  if (mode === JOIN_MODE.PRIVATE) return openRoom(mapId, maxPlayers, true, difficulty);

  if (mode === JOIN_MODE.CODE) {
    const room = rooms.get(normalizeRoomCode(code));
    if (!room) return { error: 'No match with that code. Check it and try again.' };
    if (!hasSpace(room)) return { error: 'That match is full.' };
    return room;
  }

  let best = null;
  for (const room of rooms.values()) {
    if (room.isPrivate || !hasSpace(room)) continue;
    // Quick play means "put me in a match now", so only live ones qualify.
    if (room.status !== ROOM_STATUS.PLAYING) continue;
    if (mapId && room.mapId !== mapId) continue;
    // Someone who asked for hard bots should not be dropped into an easy room.
    if (difficulty && room.difficulty !== difficulty) continue;
    if (!best || humanCount(room) > humanCount(best)) best = room;
  }
  return best || openRoom(mapId, maxPlayers, false, difficulty);
}

/** An empty room adopts the next arrival's choice of map, size and bot skill. */
function adoptSettings(room, mapId, maxPlayers, difficulty) {
  if (humanCount(room) !== 0) return;
  room.maxPlayers = clampMaxPlayers(maxPlayers);
  trimBots(room);
  if (room.status === ROOM_STATUS.PLAYING) fillBots(room);
  if (mapId && MAP_IDS.includes(mapId) && mapId !== room.mapId) setMap(room, mapId);
  setDifficulty(room, difficulty);
}

/** Push the waiting-room state to everyone still gathering in it. */
function broadcastLobby(room) {
  if (room.status !== ROOM_STATUS.LOBBY) return;
  io.to(room.id).emit(EVENT.LOBBY, lobbyState(room));
}

io.on('connection', (socket) => {
  socket.on(EVENT.JOIN, (payload = {}) => {
    try {
      if (index.has(socket.id)) leave(socket);

      const mapId = MAP_IDS.includes(payload.mapId) ? payload.mapId : DEFAULT_MAP_ID;
      const maxPlayers = clampMaxPlayers(payload.maxPlayers ?? DEFAULT_MAX_PLAYERS);
      const name = String(payload.name || 'Racer').slice(0, 18).trim() || 'Racer';
      const mode = Object.values(JOIN_MODE).includes(payload.mode) ? payload.mode : JOIN_MODE.QUICK;
      const difficulty = isDifficulty(payload.difficulty) ? payload.difficulty : DEFAULT_DIFFICULTY;

      const found = findRoom({ mode, code: payload.code, mapId, maxPlayers, difficulty });
      if (found.error) {
        socket.emit(EVENT.ERROR, { message: found.error });
        return;
      }
      const room = found;
      clearTimeout(room.reaper);
      adoptSettings(room, mapId, maxPlayers, difficulty);

      if (room.players.size >= room.maxPlayers && !removeOneBot(room)) {
        socket.emit(EVENT.ERROR, { message: 'That match is full.' });
        return;
      }

      const player = createPlayer(room, { name, isAi: false, socketId: socket.id });
      if (!room.hostId) room.hostId = player.id;
      if (room.status === ROOM_STATUS.PLAYING) fillBots(room);

      socket.join(room.id);
      index.set(socket.id, { roomId: room.id, playerId: player.id });

      const map = getMap(room.mapId);
      socket.emit(EVENT.WELCOME, {
        id: player.id,
        roomId: room.id,
        // Only private rooms have a code worth showing. Quick play hands out no
        // invite because there is nothing to invite anyone *to* — the next
        // person to press Play lands in whichever public room is busiest.
        code: room.isPrivate ? room.code : null,
        isPrivate: room.isPrivate,
        status: room.status,
        difficulty: room.difficulty,
        isHost: room.hostId === player.id,
        mapId: room.mapId,
        color: player.color,
        maxPlayers: room.maxPlayers,
        spawn: { x: player.state.x, y: player.state.y, z: player.state.z, yaw: player.state.yaw },
        boxes: map.boxes.map((b) => ({ x: b.x, y: b.y, z: b.z })),
        roster: roster(room),
      });
      io.to(room.id).emit('roster', roster(room));
      room.rosterDirty = false;
      broadcastLobby(room);
    } catch (err) {
      console.error('join failed', err);
      socket.emit(EVENT.ERROR, { message: 'Join failed' });
    }
  });

  socket.on(EVENT.INPUT, (cmd) => {
    const ref = index.get(socket.id);
    if (!ref || !cmd) return;
    const room = rooms.get(ref.roomId);
    const player = room?.players.get(ref.playerId);
    if (!player) return;
    // Clients batch a few commands per network packet.
    const batch = Array.isArray(cmd) ? cmd : [cmd];
    for (const c of batch) {
      if (typeof c?.seq !== 'number' || typeof c?.bits !== 'number') continue;
      if (c.seq <= player.lastCmd.seq && player.queue.length === 0) continue;
      player.queue.push({ seq: c.seq, bits: c.bits & 0x3f });
      if (player.queue.length > 60) player.queue.shift();
    }
  });

  /** Look up the caller's room, and the player record, only if they host it. */
  function asHost(socket) {
    const ref = index.get(socket.id);
    if (!ref) return null;
    const room = rooms.get(ref.roomId);
    if (!room || room.hostId !== ref.playerId) return null;
    return room;
  }

  socket.on(EVENT.START, () => {
    const room = asHost(socket);
    // Only the host, only a room that has not already started. Everyone else
    // asking is ignored rather than errored — a second click on a laggy
    // connection is not worth a message.
    if (!room || room.status !== ROOM_STATUS.LOBBY) return;
    startMatch(room);
    io.to(room.id).emit('roster', roster(room));
    io.to(room.id).emit(EVENT.STARTED, { mapId: room.mapId, difficulty: room.difficulty });
  });

  socket.on(EVENT.CONFIG, (payload = {}) => {
    const room = asHost(socket);
    // Settings are the host's to change, and only while people are still
    // gathering — swapping the arena mid-race would teleport everyone.
    if (!room || room.status !== ROOM_STATUS.LOBBY) return;

    if (typeof payload.fillWithBots === 'boolean') room.fillWithBots = payload.fillWithBots;
    if (payload.maxPlayers !== undefined) {
      const next = clampMaxPlayers(payload.maxPlayers);
      // Never shrink below the people already standing in the room.
      room.maxPlayers = Math.max(next, humanCount(room));
    }
    if (MAP_IDS.includes(payload.mapId) && payload.mapId !== room.mapId) setMap(room, payload.mapId);
    if (isDifficulty(payload.difficulty)) setDifficulty(room, payload.difficulty);

    broadcastLobby(room);
  });

  socket.on(EVENT.CHEAT, (payload) => {
    const ref = index.get(socket.id);
    if (!ref) return;
    const room = rooms.get(ref.roomId);
    const player = room?.players.get(ref.playerId);
    if (!player) return;
    const code = Number(payload?.code);
    if (!CHEAT_CODES.includes(code)) return;
    applyCheat(room, player, code);
  });

  socket.on(EVENT.LEAVE, () => leave(socket));
  socket.on('disconnect', () => leave(socket));
});

function leave(socket) {
  const ref = index.get(socket.id);
  if (!ref) return;
  index.delete(socket.id);
  const room = rooms.get(ref.roomId);
  if (!room) return;

  room.players.delete(ref.playerId);
  socket.leave(room.id);

  // Hand the room to whoever is left rather than leaving it hostless.
  if (room.hostId === ref.playerId) {
    const next = [...room.players.values()].find((p) => !p.isAi);
    room.hostId = next ? next.id : null;
  }

  if (room.status === ROOM_STATUS.PLAYING) fillBots(room);
  io.to(room.id).emit('roster', roster(room));
  // Someone leaving the waiting room changes who is listed in it, and may have
  // handed the host badge to somebody else.
  broadcastLobby(room);

  // Rooms are cheap; an abandoned one is just bots burning CPU. Keep a private
  // room alive briefly so a host who refreshes does not lose their invite code.
  if (humanCount(room) === 0) {
    clearTimeout(room.reaper);
    room.reaper = setTimeout(() => {
      if (humanCount(room) === 0) rooms.delete(room.id);
    }, room.isPrivate ? 120_000 : 15_000).unref();
  }
}

// ─── Fixed-step loop ────────────────────────────────────────────────────
// A catch-up accumulator keeps simulation time honest even when the event
// loop stalls, which stops karts from teleporting after a hitch.

let last = process.hrtime.bigint();
let accumulator = 0;
let sinceSnapshot = 0;
const MAX_CATCHUP = SIM_DT * 5;

setInterval(() => {
  const now = process.hrtime.bigint();
  let elapsed = Number(now - last) / 1e9;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25;

  accumulator += elapsed;
  let steps = 0;
  while (accumulator >= SIM_DT && steps < 5) {
    for (const room of rooms.values()) {
      // A room still gathering has nothing to simulate: its karts are parked
      // at spawn and will be reseated the moment the host starts anyway.
      if (room.status !== ROOM_STATUS.PLAYING) continue;
      stepRoom(room, SIM_DT);
    }
    accumulator -= SIM_DT;
    steps++;
  }
  if (accumulator > MAX_CATCHUP) accumulator = 0;

  sinceSnapshot += elapsed * 1000;
  if (sinceSnapshot >= SNAPSHOT_MS) {
    sinceSnapshot = 0;
    for (const room of rooms.values()) {
      // Nobody in a waiting room needs twenty kart snapshots a second. They
      // get lobby updates when something actually changes instead.
      if (room.status !== ROOM_STATUS.PLAYING) continue;
      if (room.rosterDirty) {
        io.to(room.id).emit('roster', roster(room));
        room.rosterDirty = false;
      }
      const snap = snapshot(room);
      if (room.events.length) {
        snap.e = room.events.splice(0, room.events.length);
      }
      io.to(room.id).emit(EVENT.SNAPSHOT, snap);
    }
  }
}, 1000 / SIM_HZ);

httpServer.listen(PORT, () => {
  // Bot pathfinding grids take about 100 ms per arena to build and never
  // change. Doing it now keeps the first tick of the first match smooth.
  const t0 = Date.now();
  for (const id of MAP_IDS) getNavGrid(getMap(id));
  console.log(`Nav grids ready for ${MAP_IDS.length} arenas in ${Date.now() - t0}ms`);
  console.log(`Kart Combat running at http://localhost:${PORT}`);
});

export { app, io, httpServer };
