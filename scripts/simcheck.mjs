/**
 * Headless sanity check for the shared simulation.
 * Drives synthetic karts around every map and reports anything that falls
 * through the world, jams against geometry, or fails to climb a ramp.
 */

import { getMap } from '../shared/maps/index.js';
import { createKartState, createInput, stepKart, resolveKartPair } from '../shared/physics.js';
import { sampleGround, topAt } from '../shared/collision.js';
import { createAiBrain, driveAi } from '../shared/ai/index.js';
import { MAP_IDS, SIM_DT } from '../shared/constants.js';

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

for (const id of MAP_IDS) {
  const map = getMap(id);
  console.log(`\n=== ${map.name} (${map.solids.length} solids, ${map.boxes.length} pickups) ===`);

  const spawnYs = map.spawns.map((s) => +s.y.toFixed(2));
  console.log(`  spawn heights: ${[...new Set(spawnYs)].join(', ')}`);
  if (map.spawns.some((s) => !Number.isFinite(s.y) || s.y < map.killY)) {
    fail('a spawn resolved below the kill plane');
  } else {
    ok('all spawns land on a surface');
  }
  if (map.boxes.some((b) => !Number.isFinite(b.y) || b.y < map.killY)) {
    fail('a pickup resolved below the kill plane');
  } else {
    ok('all pickups land on a surface');
  }

  // Nothing should come to rest balanced on a bumper, crate or boulder. The
  // giveaway is that whatever is holding it up has a tiny footprint: floors and
  // platforms are broad, obstacles are not.
  const footprint = (s) => {
    if (s.t === 'box') return s.w * s.d;
    if (s.t === 'ramp') return s.w * s.len;
    if (s.t === 'cyl') return Math.PI * (s.r ** 2 - (s.inner || 0) ** 2);
    return Infinity;
  };
  const supportOf = (x, z, y) => {
    let best = null;
    for (const s of map.solids) {
      const top = topAt(s, x, z);
      if (top === null || Math.abs(top - y) > 0.05) continue;
      if (!best || footprint(s) < footprint(best)) best = s;
    }
    return best;
  };
  const perched = [];
  for (const [label, list] of [['spawn', map.spawns], ['pickup', map.boxes]]) {
    for (const p of list) {
      const s = supportOf(p.x, p.z, p.y);
      if (s && footprint(s) < 30) perched.push(`${label} on ${s.t}:${s.mat} (${footprint(s).toFixed(0)}m²)`);
    }
  }
  if (perched.length) fail(`${perched.length} perched on obstacles: ${perched.slice(0, 3).join(', ')}`);
  else ok('nothing spawns balanced on an obstacle');

  const ctx = { solids: map.solids, floorY: map.floorY };

  // Run a full grid of bots against each other for 20 s using the shipping AI.
  // Anything that ends up wedged shows as a kart that covered almost no ground.
  const bots = map.spawns.map((spawn, i) => ({
    id: `b${i}`,
    isAi: true,
    alive: true,
    weapon: null,
    state: createKartState(spawn),
    brain: createAiBrain(),
    input: createInput(),
    travelled: 0,
    respawns: 0,
  }));

  let maxClimb = 0;
  for (let i = 0; i < 20 / SIM_DT; i++) {
    for (const bot of bots) {
      driveAi(bot, bots, map, bot.input, SIM_DT);
      const px = bot.state.x;
      const pz = bot.state.z;
      stepKart(bot.state, bot.input, ctx, SIM_DT);
      bot.travelled += Math.hypot(bot.state.x - px, bot.state.z - pz);
      maxClimb = Math.max(maxClimb, bot.state.y);
      if (!Number.isFinite(bot.state.x) || !Number.isFinite(bot.state.y)) {
        fail(`NaN in kart state for ${bot.id}`);
        bot.state = createKartState(map.spawns[0]);
      }
      if (bot.state.y < map.killY) {
        bot.respawns++;
        bot.state = createKartState(map.spawns[bot.respawns % map.spawns.length]);
        bot.brain = createAiBrain();
      }
    }
    for (let a = 0; a < bots.length; a++) {
      for (let b = a + 1; b < bots.length; b++) resolveKartPair(bots[a].state, bots[b].state);
    }
  }

  const worst = Math.min(...bots.map((b) => b.travelled));
  const totalFalls = bots.reduce((n, b) => n + b.respawns, 0);
  if (worst < 60) fail(`a bot covered only ${worst.toFixed(1)}m in 20s — wedged on geometry`);
  else ok(`all ${bots.length} bots drove freely (min distance ${worst.toFixed(1)}m)`);
  if (totalFalls > bots.length * 2) {
    fail(`${totalFalls} falls into the void in 20s — the arena leaks`);
  } else {
    console.log(`  note  ${totalFalls} falls into the void over 20s`);
  }
  console.log(`  highest point reached while driving: ${maxClimb.toFixed(2)}`);

  // Ramp climb test: can a kart actually get onto the raised geometry?
  const raised = map.solids.filter((s) => s.t === 'ramp');
  if (raised.length) {
    let climbed = 0;
    for (const r of raised) {
      // Start at the ramp's low edge, pointing up the slope.
      const lowX = r.x - Math.sin(r.rotY) * (r.len / 2 - 1);
      const lowZ = r.z - Math.cos(r.rotY) * (r.len / 2 - 1);
      const startY = sampleGround(map.solids, lowX, lowZ, 3, map.floorY);
      const k = createKartState({ x: lowX, y: startY, z: lowZ, yaw: r.rotY });
      const inp = createInput();
      inp.forward = true;
      // Track the peak: a kart that crests the ramp and drives on is a success,
      // even though it is back at ground level by the end of the run.
      let peak = startY;
      for (let i = 0; i < 2.5 / SIM_DT; i++) {
        stepKart(k, inp, ctx, SIM_DT);
        peak = Math.max(peak, k.y);
      }
      if (peak > startY + r.rise * 0.7) climbed++;
    }
    if (climbed === raised.length) ok(`all ${raised.length} ramps are climbable`);
    else fail(`only ${climbed}/${raised.length} ramps could be driven up`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
