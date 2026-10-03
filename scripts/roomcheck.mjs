/**
 * Headless check of the match rules.
 *
 * Runs the room exactly as the server does — the real room module, stepped at
 * the fixed rate with the match clock ticked after every step — but with no
 * sockets and no browser, so a broken rule shows up here in a second instead
 * of as a confusing moment in a play test. Each scenario gets a fresh room
 * and stages its fight on an open, flat patch of a real arena.
 *
 *   node scripts/roomcheck.mjs
 */

import {
  createRoom, createPlayer, stepRoom, tickMatchClock, timeLeft, snapshot,
  requestRespawn, giveWeapon, standingsOf, winnersOf, matchOverPayload,
} from '../server/room.js';
import {
  MAP_IDS, ROOM_STATUS, SIM_DT, MAX_HP, KEY,
  DEATH_CAM_SECONDS, RESPAWN_COUNTDOWN, AUTO_RESPAWN_SECONDS, BOT_RESPAWN_JITTER,
  SPAWN_INVULN, ROUND_OVER_SECONDS, RESULTS_SECONDS,
} from '../shared/constants.js';
import { WEAPONS, WEAPON_IDS, rollWeapon } from '../shared/weapons.js';
import { getMap } from '../shared/maps/index.js';
import { pointInSolid, sampleGround } from '../shared/collision.js';
import { createKartState, KART } from '../shared/physics.js';

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const check = (cond, msg, detail = '') => (cond ? ok(msg) : fail(detail ? `${msg} (${detail})` : msg));
const near = (a, b, tol = SIM_DT * 1.5) => Math.abs(a - b) <= tol;

const DEATH_WAIT = DEATH_CAM_SECONDS + RESPAWN_COUNTDOWN;

// ── Where to stage things ────────────────────────────────────────────────
// Scenery belongs to the arenas and may move, so rather than trusting fixed
// coordinates, find a patch of level floor with nothing standing on it and no
// crate nearby, spiralling out from the middle of the first arena that has one.

function findPatch(radius = 14) {
  for (const mapId of ['harvestHollow', ...MAP_IDS]) {
    const map = getMap(mapId);
    if (map.spin) continue; // a turning floor would carry the karts away
    for (let ring = 0; ring <= 60; ring += 4) {
      for (let a = 0; a < (ring ? 16 : 1); a++) {
        const cx = Math.round(Math.sin((a / 16) * Math.PI * 2) * ring);
        const cz = Math.round(Math.cos((a / 16) * Math.PI * 2) * ring);
        const y0 = sampleGround(map.solids, cx, cz, 30, map.floorY);
        if (!Number.isFinite(y0) || y0 < map.killY) continue;
        if (map.boxes.some((b) => Math.hypot(b.x - cx, b.z - cz) < radius + 3)) continue;
        let clear = true;
        for (let dx = -radius; dx <= radius && clear; dx += 1.5) {
          for (let dz = -radius; dz <= radius && clear; dz += 1.5) {
            if (Math.hypot(dx, dz) > radius) continue;
            const y = sampleGround(map.solids, cx + dx, cz + dz, 30, map.floorY);
            if (!Number.isFinite(y) || Math.abs(y - y0) > 0.01) { clear = false; break; }
            for (const h of [0.3, 0.75, 1.4]) {
              if (pointInSolid(map.solids, cx + dx, y + h, cz + dz)) clear = false;
            }
          }
        }
        if (clear) return { mapId, x: cx, y: y0, z: cz };
      }
    }
  }
  return null;
}

/**
 * Somewhere to fall off. Arenas with a ground plane catch everything, so falls
 * are staged on one without: just past its edge, a little above the kill
 * plane, where nothing is underneath.
 */
function findVoid() {
  for (const mapId of MAP_IDS) {
    const map = getMap(mapId);
    if (map.floorY > -900) continue;
    for (const r of [1.5, 2, 3]) {
      const x = (map.arenaRadius || 60) * r;
      const below = sampleGround(map.solids, x, 0, map.killY + 50, map.floorY);
      if (!(below > map.killY)) return { mapId, x, y: map.killY + 0.3, z: 0 };
    }
  }
  return null;
}

const patch = findPatch();
const drop = findVoid();
if (!patch || !drop) {
  console.log(`  FAIL  ${!patch ? 'no open, level patch' : 'no edge to fall off'} found on any arena to stage the checks on`);
  process.exit(1);
}
console.log(`Staging fights on ${getMap(patch.mapId).name} around (${patch.x}, ${patch.z}),`
  + ` falls off the edge of ${getMap(drop.mapId).name}.`);

// ── Helpers ──────────────────────────────────────────────────────────────

let roomSeq = 0;

/** A live quick-play room with the given humans in it and no bots. */
function setup(names = ['Ann', 'Ben'], mapId = patch.mapId) {
  const room = createRoom(`CHK${roomSeq++}`, mapId, 15);
  const players = names.map((name) => {
    const p = createPlayer(room, { name, isAi: false });
    // Spawn protection would swallow every staged hit.
    p.invulnTime = 0;
    p.testSeq = 0;
    return p;
  });
  return { room, players };
}

/** Put a kart at (dx, dz) metres from the patch centre, facing `yaw`, at rest. */
function place(p, dx, dz, yaw = 0) {
  p.state = createKartState({ x: patch.x + dx, y: patch.y, z: patch.z + dz, yaw });
}

/** Put a kart over the void (in a room on `drop.mapId`); it is gone within a few steps. */
function overTheEdge(p) {
  p.state = createKartState({ x: drop.x, y: drop.y, z: drop.z });
}

/**
 * Hold these buttons on a human's client from now on. A real client sends one
 * command every tick for as long as a button is down, and the server runs each
 * command exactly once (it no longer repeats the last one by itself), so the
 * stepping helpers below feed the held buttons in once per step.
 */
function send(p, bits) {
  p.testHeld = bits;
  feed(p);
}

/** Enqueue one tick's command for a human holding buttons. */
function feed(p) {
  if (p.testHeld === undefined) return;
  p.testSeq++;
  p.queue.push({ seq: p.testSeq, bits: p.testHeld });
}

/** Every human in the room sends this tick's command, as their client would. */
function feedAll(room) {
  for (const p of room.players.values()) if (!p.isAi && p.queue.length === 0) feed(p);
}

/**
 * Step the room the way the server loop does, collecting every event and
 * every phase change with the room clock it happened at.
 */
function run(room, seconds, each = null) {
  const events = [];
  const phases = [];
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    if (each) each(i);
    feedAll(room);
    stepRoom(room, SIM_DT);
    const change = tickMatchClock(room);
    if (change) phases.push({ change, at: room.clock });
    events.push(...room.events.splice(0));
  }
  return { events, phases };
}

/** Run until `cond()` holds or `limit` seconds pass; returns the time taken or null. */
function runUntil(room, cond, limit) {
  const start = room.clock;
  const steps = Math.round(limit / SIM_DT);
  for (let i = 0; i < steps; i++) {
    feedAll(room);
    stepRoom(room, SIM_DT);
    tickMatchClock(room);
    room.events.length = 0;
    if (cond()) return room.clock - start;
  }
  return null;
}

const snapOf = (room, p) => snapshot(room).p.find((s) => s.i === p.id);

/** Tap fire: press for one step, then let go. */
function tapFire(room, p) {
  send(p, KEY.FIRE);
  const a = run(room, SIM_DT);
  send(p, 0);
  const b = run(room, SIM_DT);
  return [...a.events, ...b.events];
}

/**
 * Wreck `victim` with a rocket from `shooter` 10 m ahead, stopping on the step
 * it lands. Returns the kill event, with the room clock it happened at as `at`.
 */
function rocketKill(room, shooter, victim, weapon = 'rocket') {
  place(shooter, 0, 0, 0);
  place(victim, 0, 10, 0);
  giveWeapon(room, shooter, weapon);
  const events = tapFire(room, shooter);
  for (let i = 0; i < 60 && victim.alive; i++) events.push(...run(room, SIM_DT).events);
  const kill = events.find((e) => e.t === 'kill' && e.i === victim.id);
  return kill ? { ...kill, at: room.clock } : null;
}

// ── Weapon definitions ───────────────────────────────────────────────────
console.log('\n=== Weapon definitions ===');
{
  const missing = WEAPON_IDS.filter((id) => !WEAPONS[id].killName);
  check(!missing.length, 'every weapon names itself for the death message', `no killName: ${missing.join(', ')}`);
  const expected = {
    rocket: 'rocket', tripleRocket: 'rockets', machineGun: 'machine gun', bomb: 'bomb',
    mine: 'mine', freezeRay: 'freeze ray', spikes: 'spike balls',
  };
  const wrong = Object.entries(expected).filter(([id, n]) => WEAPONS[id]?.killName !== n);
  check(!wrong.length, 'kill names read as the death message expects', wrong.map(([id]) => id).join(', '));

  const s = WEAPONS.spikes;
  check(s && s.kind === 'orbit' && s.radius === 2.6 && s.count === 4 && s.duration === 6 && s.spin > 0,
    'spike balls: 4 balls orbiting at 2.6 m for 6 s, with a spin rate for the renderer');
  check(WEAPONS.mine.uses === 3, 'mines come three to a pickup');
  check(WEAPONS.machineGun.ammo === 20 && WEAPONS.machineGun.hold === true, 'machine gun: 20 rounds, fired while held');
  check(WEAPONS.shield.kind === 'timed' && WEAPONS.shield.duration === 6.5, 'shield is timed, 6.5 s');
  check(Math.abs(WEAPONS.spikes.rarity - WEAPONS.bomb.rarity) <= 1, 'spike balls are about as common as bombs');

  let seen = 0;
  let r = 0;
  const rng = () => { r = (r + 0.6180339887) % 1; return r; };
  for (let i = 0; i < 2000; i++) if (rollWeapon(rng) === 'spikes') seen++;
  check(seen > 0, 'crates can roll spike balls', `${seen}/2000`);
}

// ── Kills name the weapon ────────────────────────────────────────────────
console.log('\n=== Kill events ===');
{
  const { room, players: [a, b] } = setup();
  const kill = rocketKill(room, a, b);
  check(!!kill, 'a rocket 10 m ahead wrecks the target');
  if (kill) {
    check(kill.by === a.id && kill.w === 'rocket' && kill.self === 0,
      'kill event carries killer, weapon and self flag', JSON.stringify(kill));
    check([kill.x, kill.y, kill.z].every(Number.isFinite), 'kill event carries where it happened');
  }
  check(a.score === 1 && a.kills === 1 && b.deaths === 1, 'the killer scores, the victim counts a death',
    `score ${a.score}, deaths ${b.deaths}`);
}
{
  const { room, players: [a, b] } = setup();
  const kill = rocketKill(room, a, b, 'tripleRocket');
  check(kill?.w === 'tripleRocket', 'a triple-rocket kill is credited to the triple rocket, not one rocket',
    JSON.stringify(kill));
}
{
  const { room, players: [a] } = setup(['Ann'], drop.mapId);
  overTheEdge(a);
  const { events } = run(room, 0.5);
  const kill = events.find((e) => e.t === 'kill' && e.i === a.id);
  check(kill?.w === 'void' && kill.by === null && kill.self === 0, 'a fall is a kill with weapon "void" and no killer',
    JSON.stringify(kill));
  check(a.score === 0 && a.deaths === 1, 'nobody scores from a fall; it counts as a death');
}
{
  // A shield used to block the fall itself, leaving a protected kart dropping
  // through the void until the protection ran out.
  const { room, players: [a] } = setup(['Ann'], drop.mapId);
  a.shieldTime = 5;
  a.invulnTime = 5;
  overTheEdge(a);
  run(room, 0.5);
  check(!a.alive, 'no shield or spawn bubble holds a kart up over the void');
}

// ── Explosives spare their own shooter ───────────────────────────────────
console.log('\n=== Self-damage ===');
{
  const { room, players: [a, b] } = setup();
  place(a, 0, 0, 0);
  place(b, 0, 3.5, 0);
  giveWeapon(room, a, 'rocket');
  const events = [...tapFire(room, a), ...run(room, 1).events];
  const blast = events.find((e) => e.t === 'blast');
  const blastDist = blast ? Math.hypot(blast.x - a.state.x, blast.z - a.state.z) : Infinity;
  check(!!blast && blastDist < 4.5 + KART.radius + 2, 'a point-blank rocket goes off within the shooter\'s reach',
    `blast ${blastDist.toFixed(1)} m away`);
  check(!b.alive, 'it wrecks the target');
  check(a.alive && a.hp === MAX_HP, 'it does not damage the shooter', `alive ${a.alive}, hp ${a.hp}`);
  check(!events.some((e) => e.t === 'hit' && e.i === a.id), 'no hit is reported on the shooter');
}
{
  const { room, players: [a, b] } = setup();
  place(a, 0, 0, 0);
  giveWeapon(room, a, 'mine');
  check(snapOf(room, a).wn === 3, 'a fresh mine pickup shows 3 on the slot badge', `wn ${snapOf(room, a).wn}`);
  tapFire(room, a);
  run(room, 0.3);
  check(a.weapon === 'mine' && snapOf(room, a).wn === 2, 'dropping one mine leaves two', `wn ${snapOf(room, a).wn}`);
  const mine = room.projectiles.find((p) => p.w === 'mine');
  run(room, WEAPONS.mine.armTime + 0.2);
  // Park the owner right on top of their own armed mine.
  a.state = createKartState({ x: mine.x, y: patch.y, z: mine.z, yaw: 0 });
  run(room, 1);
  check(a.alive && room.projectiles.includes(mine), 'an armed mine ignores its owner parked on it');
  // A rival rolls up beside it with the owner still in the blast.
  place(b, mine.x - patch.x + 2, mine.z - patch.z, 0);
  const { events } = run(room, 0.5);
  check(!b.alive, 'the same mine wrecks a rival who rolls up to it');
  check(a.alive && a.hp === MAX_HP, 'its owner, inside the blast, is shoved but unhurt', `hp ${a.hp}`);
  check(events.find((e) => e.t === 'kill' && e.i === b.id)?.w === 'mine', 'the kill is credited to the mine');
  tapFire(room, a);
  run(room, 0.3);
  tapFire(room, a);
  check(a.weapon === null && snapOf(room, a).wn === 0, 'the third drop empties the slot');
}

// ── Death, spectate, respawn ─────────────────────────────────────────────
console.log('\n=== Death → spectate → respawn ===');
{
  const { room, players: [a, b] } = setup();
  const diedAt = rocketKill(room, a, b).at;
  let s = snapOf(room, b);
  check(s.al === 0 && s.kb === a.id, 'while wrecked the snapshot names the killer to spectate', JSON.stringify({ al: s.al, kb: s.kb }));
  check(s.rt === DEATH_WAIT, `rt starts at ${DEATH_WAIT}s (death cam + countdown)`, `rt ${s.rt}`);

  // The client keeps sending input while dead; every command must be acked.
  let lagging = 0;
  run(room, 1, () => {
    send(b, KEY.FORWARD);
    if (b.ackSeq !== b.testSeq - 1 && b.testSeq > 1) lagging++;
  });
  check(lagging === 0 && b.queue.length === 0 && b.ackSeq === b.testSeq,
    'a dead player\'s input is acked every step, not left to pile up',
    `ack ${b.ackSeq} of ${b.testSeq}, queue ${b.queue.length}`);
  check(snapOf(room, b).q === b.testSeq, 'the snapshot carries the latest ack while dead');

  check(requestRespawn(room, b) === false, 'a respawn request during the countdown is refused');
  // Step through the rest of the countdown asking every step: the snapshot
  // must show rt 0 exactly when a request would be accepted, never earlier,
  // or a player pressing the moment "Press Any Key" appears is ignored.
  let mismatches = 0;
  let firstAccepted = null;
  while (room.clock < diedAt + DEATH_WAIT + 0.2) {
    run(room, SIM_DT);
    const shownReady = snapOf(room, b).rt === 0;
    const accepted = requestRespawn(room, b);
    b.wantsRespawn = false; // only probing
    if (shownReady !== accepted) mismatches++;
    if (accepted && firstAccepted === null) firstAccepted = room.clock - diedAt;
  }
  check(mismatches === 0, 'rt reads 0 on exactly the steps a respawn request is accepted', `${mismatches} mismatched steps`);
  check(firstAccepted !== null && near(firstAccepted, DEATH_WAIT), `requests are accepted from ${DEATH_WAIT}s after the wreck`,
    `from ${firstAccepted?.toFixed(3)}s`);
  s = snapOf(room, b);
  check(s.rt === 0 && !b.alive, 'at rt 0 the wreck waits for a key press', `rt ${s.rt}, alive ${b.alive}`);
  run(room, 1);
  check(!b.alive, 'and keeps waiting without one');

  // Holding fire while asking to come back (Space is "any key" too).
  send(b, KEY.FIRE);
  check(requestRespawn(room, b) === true, 'once rt is 0 a respawn request is accepted');
  const { events } = run(room, SIM_DT * 2);
  const back = events.find((e) => e.t === 'respawn' && e.i === b.id);
  check(b.alive && !!back, 'and the kart comes back on the next step');
  check(back && Number.isFinite(back.a) && Math.abs(back.a - b.state.yaw) < 1e-2,
    'the respawn event carries the spawn yaw for the camera', JSON.stringify(back));
  s = snapOf(room, b);
  check(s.iv === 1 && near(s.ivt, SPAWN_INVULN, 0.1), `respawned under ${SPAWN_INVULN}s of spawn protection`, `ivt ${s.ivt}`);
  check(s.kb === null && s.rt === 0 && s.jn === 1, 'kb, rt and jn reset once alive');

  // The fire key that brought them back is still down: it must not spend the
  // first pickup.
  giveWeapon(room, b, 'rocket');
  run(room, 0.3);
  check(b.weapon === 'rocket', 'a fire key held through the respawn does not fire the next pickup');
  send(b, 0);
  run(room, SIM_DT);
  tapFire(room, b);
  check(b.weapon === null, 'releasing and pressing again fires it');
}
{
  const { room, players: [a, b] } = setup();
  const diedAt = rocketKill(room, a, b).at;
  runUntil(room, () => b.alive, AUTO_RESPAWN_SECONDS + 1);
  const took = room.clock - diedAt;
  check(b.alive && near(took, AUTO_RESPAWN_SECONDS),
    `an idle wreck is put back automatically after ${AUTO_RESPAWN_SECONDS}s`, `took ${b.alive ? took.toFixed(3) : 'forever'}s`);
}
{
  // Bots press no keys: they come back when the countdown ends, staggered.
  const room = createRoom(`CHK${roomSeq++}`, drop.mapId, 15);
  const bots = [0, 1, 2, 3, 4, 5].map(() => createPlayer(room, { isAi: true }));
  for (const bot of bots) { bot.invulnTime = 0; overTheEdge(bot); }
  const diedAt = new Map();
  const waits = [];
  for (let i = 0; i < Math.round((1 + DEATH_WAIT + BOT_RESPAWN_JITTER) / SIM_DT); i++) {
    stepRoom(room, SIM_DT);
    tickMatchClock(room);
    for (const e of room.events.splice(0)) {
      if (e.t === 'kill') diedAt.set(e.i, room.clock);
      if (e.t === 'respawn' && diedAt.has(e.i)) waits.push(room.clock - diedAt.get(e.i));
    }
  }
  check(diedAt.size === bots.length && waits.length === bots.length, 'every bot falls and respawns by itself',
    `${diedAt.size} fell, ${waits.length} back`);
  check(waits.every((w) => w >= DEATH_WAIT - 1e-6 && w <= DEATH_WAIT + BOT_RESPAWN_JITTER + SIM_DT * 1.5),
    `bots wait the countdown plus up to ${BOT_RESPAWN_JITTER}s`, waits.map((w) => w.toFixed(2)).join(', '));
  check(new Set(waits.map((w) => w.toFixed(3))).size > 1, 'bots caught together do not all reappear on the same step');
}

// ── Input: every command the client predicted runs exactly once ─────────
// The client's prediction replays its own commands through the same physics,
// so the server must neither drop any nor invent any, or the two part ways and
// the kart rubber-bands on screen.
console.log('\n=== Input ===');
{
  const drive = KEY.FORWARD | KEY.RIGHT;
  // Same kart, same commands: one client steady at one per tick, the other
  // silent through a 100 ms hitch and then delivering them all at once.
  const steady = setup(['Steady']);
  const bursty = setup(['Bursty']);
  const s = steady.players[0];
  const b = bursty.players[0];
  place(s, 0, 0, 0.3);
  place(b, 0, 0, 0.3);
  for (let i = 0; i < 6; i++) {
    s.queue.push({ seq: ++s.testSeq, bits: drive });
    stepRoom(steady.room, SIM_DT);
  }
  const before = { x: b.state.x, z: b.state.z };
  for (let i = 0; i < 5; i++) stepRoom(bursty.room, SIM_DT);
  check(b.state.x === before.x && b.state.z === before.z,
    'with no command in, a human kart is not moved on a guess');
  for (let i = 0; i < 6; i++) b.queue.push({ seq: ++b.testSeq, bits: drive });
  stepRoom(bursty.room, SIM_DT);
  check(b.ackSeq === b.testSeq && b.queue.length === 0, 'a burst after a hitch is run in full, none dropped',
    `acked ${b.ackSeq} of ${b.testSeq}, ${b.queue.length} still queued`);
  const gap = Math.hypot(b.state.x - s.state.x, b.state.z - s.state.z);
  check(gap < 1e-9 && s.ackSeq === b.ackSeq, 'and ends exactly where the steady client did', `${gap.toFixed(4)} m apart`);

  // A client sending twice as fast as real time still gets ~one step a tick:
  // it covers no more ground than an honest one holding the same throttle.
  const fast = setup(['Fast']);
  const honest = setup(['Honest']);
  const f = fast.players[0];
  const h = honest.players[0];
  place(f, 0, 0, 0);
  place(h, 0, 0, 0);
  const start = { x: f.state.x, z: f.state.z };
  const ticks = 60;
  for (let i = 0; i < ticks; i++) {
    f.queue.push({ seq: ++f.testSeq, bits: KEY.FORWARD });
    f.queue.push({ seq: ++f.testSeq, bits: KEY.FORWARD });
    h.queue.push({ seq: ++h.testSeq, bits: KEY.FORWARD });
    stepRoom(fast.room, SIM_DT);
    stepRoom(honest.room, SIM_DT);
  }
  const fastGone = Math.hypot(f.state.x - start.x, f.state.z - start.z);
  const honestGone = Math.hypot(h.state.x - start.x, h.state.z - start.z);
  check(fastGone <= honestGone + 0.01, 'a client sending too fast gets no extra speed',
    `${fastGone.toFixed(2)} m against ${honestGone.toFixed(2)} m`);
  check(f.queue.length <= 12, 'and its backlog stays bounded', `${f.queue.length} queued`);
}

// ── Weapon slot: ammo, timers ────────────────────────────────────────────
console.log('\n=== Weapon slot ===');
{
  const { room, players: [a, b] } = setup();
  place(a, 0, 0, 0);
  place(b, 30, 0, 0); // well off the line of fire
  giveWeapon(room, a, 'machineGun');
  check(snapOf(room, a).wn === 20, 'a machine gun shows 20 rounds', `wn ${snapOf(room, a).wn}`);
  const seen = new Set();
  const count = () => { for (const p of room.projectiles) if (p.w === 'machineGun') seen.add(p.id); };
  send(a, KEY.FIRE);
  run(room, 0.5, count);
  const afterBurst = a.ammo;
  check(a.weapon === 'machineGun' && seen.size >= 5 && seen.size <= 7 && afterBurst === 20 - seen.size,
    'holding fire spends rounds at a steady rate', `${seen.size} bullets in 0.5 s, ${afterBurst} left`);
  send(a, 0);
  run(room, 0.4, count);
  check(a.ammo === afterBurst, 'letting go stops the gun and keeps the rest', `${a.ammo} left`);
  send(a, KEY.FIRE);
  run(room, 2, count);
  check(a.weapon === null && seen.size === 20, 'holding again empties it: 20 bullets in all', `${seen.size} bullets`);
}
{
  // Bullets bend toward a kart a little off the nose, so a burst at someone
  // weaving across your path still connects.
  const { room, players: [a, b] } = setup();
  place(a, 0, 0, 0);
  place(b, 2.5, 14, 0);
  giveWeapon(room, a, 'machineGun');
  send(a, KEY.FIRE);
  const { events } = run(room, 1.5);
  const hits = events.filter((e) => e.t === 'hit' && e.i === b.id).length;
  check(hits >= 2, 'machine-gun bullets home onto a kart a few metres off the nose', `${hits} hits`);
}
{
  const { room, players: [a, b] } = setup();
  place(a, 0, 0, 0);
  place(b, 0, -25, Math.PI); // 25 m directly behind: out of the homing cone
  giveWeapon(room, a, 'machineGun');
  send(a, KEY.FIRE);
  const { events } = run(room, 1.5);
  check(!events.some((e) => e.t === 'hit'), 'but not onto anything behind');
}
{
  const { room, players: [a] } = setup(['Ann']);
  place(a, 0, 0, 0);
  giveWeapon(room, a, 'shield');
  let s = snapOf(room, a);
  check(s.wn === 7 && s.wt === 0, 'an unused shield shows its full 6.5 s as 7', `wn ${s.wn}, wt ${s.wt}`);
  tapFire(room, a);
  s = snapOf(room, a);
  check(s.wt === 1 && s.sh === 1 && a.weapon === 'shield', 'pressing switches it on and keeps it in the slot');
  run(room, 3);
  s = snapOf(room, a);
  check(s.wn === Math.ceil(6.5 - 3 - SIM_DT * 2) && s.sh === 1, 'the badge counts the seconds down', `wn ${s.wn}`);
  tapFire(room, a);
  check(near(a.timer, 6.5 - 3 - SIM_DT * 4, 0.05), 'pressing again while it runs does nothing');
  run(room, 3.6);
  s = snapOf(room, a);
  check(a.weapon === null && s.sh === 0 && s.wt === 0 && s.wn === 0, 'when it runs out the slot empties and the bubble goes');
}
{
  const { room, players: [a] } = setup(['Ann']);
  place(a, 0, 0, 0);
  a.hp = 80;
  giveWeapon(room, a, 'repair');
  tapFire(room, a);
  check(a.hp === MAX_HP, `a repair kit tops up to ${MAX_HP}, never past it`, `hp ${a.hp}`);
}

// ── Spike balls ──────────────────────────────────────────────────────────
console.log('\n=== Spike balls ===');
{
  const { room, players: [a, b, c, d] } = setup(['Ann', 'Ben', 'Cat', 'Dan']);
  place(a, 0, 0, 0);
  place(b, 6, 0, 0); // outside the ring
  place(c, -9, 0, 0);
  place(d, 0, -9, 0);
  giveWeapon(room, a, 'spikes');
  check(snapOf(room, a).wn === 6, 'a spike-ball pickup shows 6 before it is switched on');
  tapFire(room, a);
  check(snapOf(room, a).wt === 1, 'pressing sets them spinning');
  run(room, 0.5);
  check(b.alive && c.alive, 'karts clear of the ring are untouched');

  // Ben drifts into the ring.
  place(b, WEAPONS.spikes.radius, 0, 0);
  const { events } = run(room, 0.2);
  const kill = events.find((e) => e.t === 'kill' && e.i === b.id);
  check(!b.alive && kill?.by === a.id && kill?.w === 'spikes', 'a kart touching the ring is wrecked by the owner\'s spikes',
    JSON.stringify(kill));
  check(a.alive && a.hp === MAX_HP, 'the owner is untouched by their own spikes');

  // Cat is shielded when she touches it: blocked, and not spammed every step.
  c.shieldTime = 10;
  place(c, -2.4, 0, 0);
  const blocked = run(room, 1).events.filter((e) => e.t === 'block' && e.i === c.id).length;
  check(c.alive && blocked >= 1 && blocked <= 3, 'a shielded kart shrugs them off, re-tried twice a second at most',
    `${blocked} blocks in 1 s`);
  // Her shield runs out while she is still in contact.
  c.shieldTime = 0;
  run(room, 0.6);
  check(!c.alive, 'and is wrecked once the shield is gone, if still in contact');

  run(room, 6);
  const s = snapOf(room, a);
  check(a.weapon === null && s.wt === 0, 'after 6 s the spikes are gone and the slot is free');
  place(d, 2, 0, 0);
  run(room, 0.3);
  check(d.alive, 'and they no longer hurt anyone');
}

// ── Round over → winners → next round ────────────────────────────────────
console.log('\n=== Round loop ===');
{
  const { room, players: [a, b, c] } = setup(['Ann', 'Ben', 'Cat']);
  const bot = createPlayer(room, { isAi: true });
  place(a, 0, 0, 0);
  place(b, 6, 0, 0);
  place(c, -6, 0, 0);
  a.score = a.kills = 2;
  b.score = b.kills = 2;
  c.score = c.kills = 1;
  room.endsAt = room.clock + 0.5;

  // Stop on the whistle itself, which is when the server sends MATCH_OVER.
  const phases = [];
  for (let i = 0; i < 60 && room.status === ROOM_STATUS.PLAYING; i++) phases.push(...run(room, SIM_DT).phases);
  const ended = phases.find((p) => p.change === 'ended');
  check(room.status === ROOM_STATUS.ROUND_OVER && !!ended, 'at the whistle the room goes to roundOver');
  let snap = snapshot(room);
  check(snap.ph === 'roundOver' && near(snap.tl, ROUND_OVER_SECONDS + RESULTS_SECONDS, 0.2),
    'roundOver counts down to the next round', `ph ${snap.ph}, tl ${snap.tl}`);

  const over = matchOverPayload(room);
  check(over && over.roundOverSeconds === ROUND_OVER_SECONDS && near(over.nextIn, ROUND_OVER_SECONDS + RESULTS_SECONDS, 0.1),
    'MATCH_OVER says when the winners show and when the next round starts', JSON.stringify(over && { r: over.roundOverSeconds, n: over.nextIn }));
  check(over && over.winners.length === 2 && over.winners.includes(a.id) && over.winners.includes(b.id),
    'a tie for the top score names both winners', JSON.stringify(over?.winners));
  const ranks = Object.fromEntries((over?.standings || []).map((s) => [s.i, s.rank]));
  check(ranks[a.id] === 1 && ranks[b.id] === 1 && ranks[c.id] === 3 && ranks[bot.id] === 4,
    'tied players share a rank, and the next one skips it (1, 1, 3, 4)', JSON.stringify(ranks));

  // Nothing fires, scores or gets picked up between rounds.
  giveWeapon(room, a, 'rocket');
  place(b, 0, 10, 0);
  const frozen = run(room, 1, (i) => { if (i === 0) send(a, KEY.FIRE); if (i === 1) send(a, 0); });
  check(a.weapon === 'rocket' && !room.projectiles.length && !frozen.events.some((e) => e.t === 'fire'),
    'firing does nothing during roundOver');

  const winnersAt = phases.concat(frozen.phases);
  const toWinners = run(room, ROUND_OVER_SECONDS);
  const winners = [...winnersAt, ...toWinners.phases].find((p) => p.change === 'winners');
  check(winners && near(winners.at - ended.at, ROUND_OVER_SECONDS),
    `"ROUND OVER" lasts ${ROUND_OVER_SECONDS}s, then the winners`, winners ? `${(winners.at - ended.at).toFixed(3)}s` : 'never');
  snap = snapshot(room);
  check(snap.ph === 'results', 'the snapshot phase is now results', snap.ph);
  check(snap.p.filter((p) => p.al).every((p) => p.iv === 1 && p.ivt > RESULTS_SECONDS - 1.5),
    'everyone still driving wears the green bubble through the winners');

  // Pickups and damage stay frozen on the winners screen.
  const box = room.boxes.find((x) => x.alive);
  c.state = createKartState({ x: box.x, y: box.y, z: box.z, yaw: 0 });
  c.invulnTime = 0;
  b.invulnTime = 0;
  giveWeapon(room, a, 'spikes');
  a.timer = 5; // spinning, as if switched on just before the whistle
  place(a, 0, 0, 0);
  place(b, 2.5, 0, 0);
  run(room, 1);
  check(box.alive && c.weapon === null, 'nobody picks up a crate during results');
  check(b.alive && b.hp === MAX_HP, 'nothing deals damage during results');
  check([a.score, b.score, c.score].join() === '2,2,1', 'and no score changes after the whistle');

  // A late arrival sees the same screen counting down from where it is now.
  const late = createPlayer(room, { name: 'Late', isAi: false });
  const lateOver = matchOverPayload(room);
  check(lateOver && lateOver.roundOverSeconds === 0 && near(lateOver.nextIn, timeLeft(room), 0.1),
    'someone joining during results gets MATCH_OVER with the time left', JSON.stringify(lateOver && { r: lateOver.roundOverSeconds, n: lateOver.nextIn }));

  const rest = run(room, RESULTS_SECONDS);
  const restarted = rest.phases.find((p) => p.change === 'restarted');
  check(restarted && near(restarted.at - winners.at, RESULTS_SECONDS),
    `the winners stay up ${RESULTS_SECONDS}s, then a new round starts`, restarted ? `${(restarted.at - winners.at).toFixed(3)}s` : 'never');
  check(room.status === ROOM_STATUS.PLAYING && restarted && near(room.endsAt - restarted.at, room.matchSeconds)
    && matchOverPayload(room) === null, 'the new round runs the full match length');
  check([a, b, c, late].every((p) => p.score === 0 && p.kills === 0), 'scores are wiped for the new round');

  // ── Intermission ──
  snap = snapshot(room);
  const humans = [a, b, c, late].map((p) => snap.p.find((s) => s.i === p.id));
  check(humans.every((s) => s.jn === 0 && s.al === 0 && s.rt === 0 && s.kb === null),
    'humans sit the new round out (jn 0) until they ask to join', JSON.stringify(humans.map((s) => [s.jn, s.al, s.rt])));
  check(snap.p.find((s) => s.i === bot.id).al === 1, 'bots are straight back in');
  run(room, AUTO_RESPAWN_SECONDS + 1);
  check(!a.alive && a.awaitingJoin, 'a human who never asks stays out — there is no auto-join');
  check(requestRespawn(room, a) === true, 'a join request is accepted at any time');
  const joined = run(room, SIM_DT * 2).events.find((e) => e.t === 'respawn' && e.i === a.id);
  snap = snapshot(room);
  check(a.alive && !!joined && snap.p.find((s) => s.i === a.id).jn === 1, 'and drops them in (jn 1)');
  check(!b.alive && snap.p.find((s) => s.i === b.id).jn === 0, 'without bringing anyone else along');

  // And the rules are live again.
  place(a, 0, 0, 0);
  b.alive = true; b.awaitingJoin = false; b.invulnTime = 0;
  a.invulnTime = 0;
  const kill = rocketKill(room, a, b);
  check(!!kill && a.score === 1, 'combat and scoring resume in the new round');
}
{
  // Nobody scored at all: there are no winners to name.
  const { room } = setup(['Ann', 'Ben']);
  room.endsAt = room.clock + SIM_DT;
  run(room, SIM_DT * 3);
  check(room.status === ROOM_STATUS.ROUND_OVER && room.winners.length === 0, 'a round where nobody scored has no winners');
  check(winnersOf(standingsOf(room)).length === 0, 'winnersOf agrees');
}
{
  // A wreck still waiting at the whistle is not left out for good.
  const { room, players: [a, b] } = setup();
  rocketKill(room, a, b);
  room.endsAt = room.clock + 0.1;
  const took = runUntil(room, () => b.alive, AUTO_RESPAWN_SECONDS);
  check(took !== null && room.status !== ROOM_STATUS.PLAYING, 'a wreck from before the whistle still comes back during the break');
}
{
  // Falling off between rounds: there is nowhere to put the kart but back at
  // a spawn point, so it is wrecked and returns — but it is not a death on
  // the record, and it scores nobody anything.
  const { room, players: [a, b] } = setup(['Ann', 'Ben'], drop.mapId);
  a.score = a.kills = 1;
  room.endsAt = room.clock + SIM_DT;
  runUntil(room, () => room.status === ROOM_STATUS.RESULTS, ROUND_OVER_SECONDS + 1);
  overTheEdge(b);
  const { events } = run(room, 0.5);
  check(!b.alive && b.deaths === 0 && events.some((e) => e.t === 'kill' && e.i === b.id && e.w === 'void'),
    'a fall during results wrecks the kart without counting a death');
  check(a.score === 1 && b.score === 0, 'and changes no score');
  runUntil(room, () => snapOf(room, b).rt === 0, DEATH_WAIT + 1);
  requestRespawn(room, b);
  run(room, SIM_DT * 2);
  const left = room.resultsUntil - room.clock;
  check(b.alive && room.status === ROOM_STATUS.RESULTS && left > SPAWN_INVULN && near(b.invulnTime, left, 0.05),
    'back in during the break, it wears the bubble until the next round like everyone else',
    `ivt ${b.invulnTime.toFixed(2)}, ${left.toFixed(2)}s of break left`);
}

console.log(failures === 0 ? '\nAll room checks passed.' : `\n${failures} room check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
