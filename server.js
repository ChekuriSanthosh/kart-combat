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
import { existsSync } from 'fs';

import {
  EVENT, SIM_DT, SIM_HZ, SNAPSHOT_MS,
  MAP_IDS, DEFAULT_MAP_ID, JOIN_MODE,
  ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode,
  DEFAULT_MAX_PLAYERS, clampMaxPlayers, CHEAT_CODES, ROOM_STATUS,
  clampMatchSeconds,
} from './shared/constants.js';
import { getMap } from './shared/maps/index.js';
import {
  createRoom, createPlayer, fillBots, removeOneBot, trimBots,
  humanCount, setMap, setDifficulty, stepRoom, snapshot, roster, applyCheat,
  lobbyState, startMatch, tickMatchClock, requestRespawn, matchOverPayload,
} from './server/room.js';
import { DEFAULT_DIFFICULTY, isDifficulty, getNavGrid } from './shared/ai/index.js';
import { validCharacter, validKart } from './shared/cosmetics.js';

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

/**
 * What the menu's arena picker shows: each arena's name, how many people are
 * driving it in public matches right now, and its thumbnail if one has been
 * rendered into public/img/arenas. Listing the thumbnail only when the file
 * exists lets the page skip the request instead of logging a 404 per card.
 * Only humans count — every arena is always full of bots.
 */
app.get('/api/arenas', (_req, res) => {
  const players = Object.fromEntries(MAP_IDS.map((id) => [id, 0]));
  for (const room of rooms.values()) {
    // A private match is not somewhere Play can take you.
    if (room.isPrivate) continue;
    players[room.mapId] = (players[room.mapId] || 0) + humanCount(room);
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    arenas: MAP_IDS.map((id) => ({
      id,
      name: getMap(id).name,
      players: players[id],
      thumb: existsSync(join(__dirname, 'public', 'img', 'arenas', `${id}.jpg`))
        ? `/img/arenas/${id}.jpg`
        : null,
    })),
  });
});

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

function openRoom(mapId, maxPlayers, isPrivate, difficulty, setup = {}) {
  const room = createRoom(newRoomCode(), mapId, maxPlayers, { isPrivate, difficulty });
  // Chosen in the menu's Create dialog; the host can still change them in the
  // waiting room. Validated like the waiting room's CONFIG.
  if (setup.matchSeconds !== undefined) room.matchSeconds = clampMatchSeconds(setup.matchSeconds);
  if (typeof setup.fillWithBots === 'boolean') room.fillWithBots = setup.fillWithBots;
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
function findRoom({ mode, code, mapId, maxPlayers, difficulty, setup }) {
  if (mode === JOIN_MODE.PRIVATE) return openRoom(mapId, maxPlayers, true, difficulty, setup);

  if (mode === JOIN_MODE.CODE) {
    const room = rooms.get(normalizeRoomCode(code));
    if (!room) return { error: 'No match with that code. Check it and try again.' };
    if (!hasSpace(room)) return { error: 'That match is full.' };
    return room;
  }

  let best = null;
  for (const room of rooms.values()) {
    if (room.isPrivate || !hasSpace(room)) continue;
    // Quick play means "put me in a match now". A room between rounds counts:
    // the next one is seconds away, the newcomer sees the same winners screen
    // as everyone else, and sending them off to a fresh room of bots instead
    // would split up the people who are actually playing.
    if (room.status === ROOM_STATUS.LOBBY) continue;
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

/**
 * Wrap a socket handler so a throw inside it cannot take the process down.
 *
 * Socket.io invokes handlers from its own async context, so an exception in
 * one becomes an uncaught exception and kills the whole server — every room,
 * every match, for everyone. That is exactly what a missing import in the
 * customise handler did: one player changing their kart ended every game in
 * progress. A bad packet should cost the packet, not the server.
 */
function safe(label, fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (err) {
      console.error(`${label} handler failed:`, err);
    }
  };
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

      const found = findRoom({
        mode, code: payload.code, mapId, maxPlayers, difficulty,
        setup: { matchSeconds: payload.matchSeconds, fillWithBots: payload.fillWithBots },
      });
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

      const player = createPlayer(room, {
        name, isAi: false, socketId: socket.id,
        character: payload.character, kart: payload.kart,
      });
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
      // Arriving after the whistle: show the same round-over / winners screen
      // everyone else is looking at, counting down from where it is now.
      const over = matchOverPayload(room);
      if (over) socket.emit(EVENT.MATCH_OVER, over);
    } catch (err) {
      console.error('join failed', err);
      socket.emit(EVENT.ERROR, { message: 'Join failed' });
    }
  });

  socket.on(EVENT.INPUT, safe('input', (cmd) => {
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
  }));

  /** Look up the caller's room, and the player record, only if they host it. */
  function asHost(socket) {
    const ref = index.get(socket.id);
    if (!ref) return null;
    const room = rooms.get(ref.roomId);
    if (!room || room.hostId !== ref.playerId) return null;
    return room;
  }

  socket.on(EVENT.START, safe('start', () => {
    const room = asHost(socket);
    // Only the host, only a room that has not already started. Everyone else
    // asking is ignored rather than errored — a second click on a laggy
    // connection is not worth a message.
    if (!room || room.status !== ROOM_STATUS.LOBBY) return;
    startMatch(room);
    io.to(room.id).emit('roster', roster(room));
    io.to(room.id).emit(EVENT.STARTED, { mapId: room.mapId, difficulty: room.difficulty });
  }));

  socket.on(EVENT.CONFIG, safe('config', (payload = {}) => {
    const room = asHost(socket);
    // Settings are the host's to change, and only while people are still
    // gathering — swapping the arena mid-race would teleport everyone.
    if (!room || room.status !== ROOM_STATUS.LOBBY) return;

    if (typeof payload.fillWithBots === 'boolean') room.fillWithBots = payload.fillWithBots;
    if (payload.matchSeconds !== undefined) room.matchSeconds = clampMatchSeconds(payload.matchSeconds);
    if (payload.maxPlayers !== undefined) {
      const next = clampMaxPlayers(payload.maxPlayers);
      // Never shrink below the people already standing in the room.
      room.maxPlayers = Math.max(next, humanCount(room));
    }
    if (MAP_IDS.includes(payload.mapId) && payload.mapId !== room.mapId) setMap(room, payload.mapId);
    if (isDifficulty(payload.difficulty)) setDifficulty(room, payload.difficulty);

    broadcastLobby(room);
  }));

  socket.on(EVENT.RENAME, safe('rename', (payload = {}) => {
    const ref = index.get(socket.id);
    if (!ref) return;
    const room = rooms.get(ref.roomId);
    const player = room?.players.get(ref.playerId);
    if (!player) return;

    // Someone arriving on an invite link never sees the lobby, so this is the
    // only chance they get to be anything other than "Racer". Sanitised the
    // same way the join payload is.
    const name = String(payload.name || '').slice(0, 18).trim();
    if (!name || name === player.name) return;
    player.name = name;

    room.rosterDirty = true;
    io.to(room.id).emit('roster', roster(room));
    broadcastLobby(room);
  }));

  socket.on(EVENT.CUSTOMIZE, safe('customize', (payload = {}) => {
    const ref = index.get(socket.id);
    if (!ref) return;
    const room = rooms.get(ref.roomId);
    const player = room?.players.get(ref.playerId);
    if (!player) return;

    // Purely cosmetic, so this is allowed at any time — including mid-match,
    // where the change simply shows up on everyone's next roster update.
    if (payload.character !== undefined) player.character = validCharacter(payload.character);
    if (payload.kart !== undefined) player.kart = validKart(payload.kart);

    room.rosterDirty = true;
    io.to(room.id).emit('roster', roster(room));
    broadcastLobby(room);
  }));

  socket.on(EVENT.RESPAWN, safe('respawn', () => {
    const ref = index.get(socket.id);
    if (!ref) return;
    const room = rooms.get(ref.roomId);
    const player = room?.players.get(ref.playerId);
    if (!player) return;
    // The room decides whether it is too early; a refused request is simply
    // dropped, and the client asks again on the next key press.
    requestRespawn(room, player);
  }));

  socket.on(EVENT.CHEAT, safe('cheat', (payload) => {
    const ref = index.get(socket.id);
    if (!ref) return;
    const room = rooms.get(ref.roomId);
    const player = room?.players.get(ref.playerId);
    if (!player) return;
    const code = Number(payload?.code);
    if (!CHEAT_CODES.includes(code)) return;
    applyCheat(room, player, code, { weapon: typeof payload?.w === 'string' ? payload.w : undefined });
  }));

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
      // at spawn and will be reseated the moment the host starts anyway. A
      // room between rounds keeps running underneath "ROUND OVER" and the
      // winners, so the arena behind them is alive rather than frozen —
      // though nothing in it can fire or score (see stepRoom).
      if (room.status === ROOM_STATUS.LOBBY) continue;
      stepRoom(room, SIM_DT);

      // 'winners' needs no message of its own: the snapshot's phase flips
      // from 'roundOver' to 'results', and MATCH_OVER already said when.
      const change = tickMatchClock(room);
      if (change === 'ended') {
        io.to(room.id).emit(EVENT.MATCH_OVER, matchOverPayload(room));
      } else if (change === 'restarted') {
        io.to(room.id).emit('roster', roster(room));
        io.to(room.id).emit(EVENT.MATCH_START, { seconds: room.matchSeconds });
      }
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
      // get lobby updates when something actually changes instead. Results
      // rooms still stream, so the countdown and the arena behind the
      // leaderboard keep moving.
      if (room.status === ROOM_STATUS.LOBBY) continue;
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
