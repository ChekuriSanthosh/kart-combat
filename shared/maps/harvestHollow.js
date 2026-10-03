/**
 * Harvest Hollow — a sunny cartoon farm.
 *
 * The brief was "fewer hurdles, and room for fifteen". The field is 124 m
 * across with only sixteen collision solids on it, against Gravel Pit's 39 in
 * a space two thirds the size — so there is somewhere to go at all times, and
 * almost all of the arena's character comes from things you cannot crash into.
 *
 * What little geometry there is earns its place:
 *
 *   The barn is a tunnel, not a block. Both ends are open, so it is a lane
 *   through the middle of the map rather than something to drive around — a
 *   shortcut you can take at speed and an ambush spot for anyone holding it.
 *
 *   The silos are round. A glancing hit on a cylinder slides you off down the
 *   tangent instead of stopping you dead the way a corner does, so a cluster
 *   of them reads as an obstacle while barely costing anyone momentum.
 *
 *   The corn is the idea this arena is built around. It is two metres tall and
 *   has no collider at all, so it blocks what you can *see* without blocking
 *   where you can *go*. You lose people in it, you get lost in it, and you
 *   come out of it somewhere nobody expected — all without a single thing to
 *   crash into. Cover that costs no momentum is rare, and on a map this open
 *   it is what stops the whole fight happening in one line of sight.
 */

import { box, cyl, ramp, ring, decor, spawnRing, circlePoints } from './helpers.js';

const ARENA_R = 62;
const FENCE_H = 3.0;

/** Barn: two long walls with both ends open, so you drive straight through. */
const BARN_X = -26;
const BARN_Z = 4;
const BARN_LEN = 30;
const BARN_HALF_W = 8;
const BARN_WALL_T = 1.3;
const BARN_H = 5.5;

export default function harvestHollow() {
  const solids = [];
  const visuals = [];
  const boxes = [];

  // ── Perimeter ──
  // A ring rather than four walls and corner cuts: on a round field there is
  // no corner for anyone to wedge into in the first place.
  solids.push(ring(0, 0, 0, ARENA_R, FENCE_H, 'fence'));

  // ── The barn ──
  for (const side of [-1, 1]) {
    solids.push(box(
      BARN_X + side * BARN_HALF_W, 0, BARN_Z,
      BARN_WALL_T, BARN_H, BARN_LEN,
      'barnWall',
    ));
  }

  // ── Silo cluster ──
  const siloSpots = [[36, -24], [45, -12], [35, -2]];
  for (const [sx, sz] of siloSpots) {
    solids.push(cyl(sx, 0, sz, 3.4, 14, 'silo'));
  }

  // ── Water tower: a second landmark on the far side from the windmill ──
  solids.push(cyl(30, 0, 34, 2.6, 11, 'millBase'));

  // ── Three earth ramps, all throwing you back toward the middle ──
  for (const [rx, rz] of [[8, 42], [-10, -44], [46, 14]]) {
    const rotY = Math.atan2(-rx, -rz); // high edge faces the centre
    solids.push(ramp(rx, 0, rz, 10, 12, 2.6, rotY + Math.PI, 'dirt'));
  }

  // ── Round bales: sparse, and round for the same reason the silos are ──
  const balePositions = [
    [18, -10], [14, 20], [-10, 30], [-40, -26], [40, 22], [-2, -18], [-34, 34],
  ];
  for (const [bx, bz] of balePositions) {
    solids.push(cyl(bx, 0, bz, 2.0, 1.8, 'hay'));
  }

  // ── Windmill: a landmark you navigate by, with a base you can hit ──
  solids.push(cyl(0, 0, -48, 2.4, 16, 'millBase'));

  // ── Visual dressing: none of this collides ──
  visuals.push(decor('ground', 0, 0, 0, { size: 760, mat: 'grass', round: true }));

  /**
   * Corn, inside the fence and drivable straight through. Placed off the
   * centre line and away from the barn mouths so there is always a clear route
   * for anyone who would rather not lose sight of the fight.
   */
  visuals.push(decor('cornPatch', 24, 0, 22, { w: 30, d: 26, rows: 15, per: 13, rotY: -0.25 }));
  visuals.push(decor('cornPatch', -30, 0, -32, { w: 28, d: 24, rows: 14, per: 12, rotY: 0.4 }));
  visuals.push(decor('cornPatch', 6, 0, -26, { w: 20, d: 16, rows: 10, per: 9, rotY: 0.15 }));

  visuals.push(decor('pond', -44, 0, 26, { r: 10 }));
  visuals.push(decor('barnShell', BARN_X, 0, BARN_Z, {
    w: BARN_HALF_W * 2 + BARN_WALL_T, d: BARN_LEN, h: BARN_H,
  }));
  for (const [sx, sz] of siloSpots) {
    visuals.push(decor('siloCap', sx, 14, sz, { r: 3.4 }));
  }
  visuals.push(decor('waterTower', 30, 11, 34, { r: 4.2 }));
  visuals.push(decor('windmill', 0, 0, -48, { h: 16, r: 2.4 }));
  visuals.push(decor('fenceLine', 0, 0, 0, { r: ARENA_R, posts: 86, h: FENCE_H }));

  // Worked fields beyond the fence, then the treeline: the layers that give
  // the arena somewhere to be without putting anything in the way.
  visuals.push(decor('cropField', 60, 0, 54, { w: 34, d: 26, rotY: -0.7, rows: 28 }));
  visuals.push(decor('cropField', -68, 0, 44, { w: 28, d: 22, rotY: 0.6, rows: 24 }));
  visuals.push(decor('cropField', -10, 0, 82, { w: 38, d: 22, rotY: 0.1, rows: 30 }));
  visuals.push(decor('treeline', 0, 0, 0, {
    count: 44, r: ARENA_R + 44, h: 8, phase: 0.11,
  }));
  for (const [tx, tz] of [[42, -64], [-70, 10], [68, 30], [-24, -74]]) {
    visuals.push(decor('tractor', tx, 0, tz, { rotY: tx * 0.1 }));
  }

  // ── Pickups: a wide ring, an inner ring, the barn, and inside the corn ──
  for (const p of circlePoints(9, 42, 0, 0.05)) boxes.push({ x: p.x, y: 0, z: p.z });
  for (const p of circlePoints(4, 20, 0, 0.22)) boxes.push({ x: p.x, y: 0, z: p.z });
  boxes.push({ x: BARN_X, y: 0, z: BARN_Z - 9 });
  boxes.push({ x: BARN_X, y: 0, z: BARN_Z + 9 });
  // Two crates buried in corn: worth the risk of not seeing who else went in.
  boxes.push({ x: 24, y: 0, z: 22 });
  boxes.push({ x: -30, y: 0, z: -32 });

  return {
    id: 'harvestHollow',
    name: 'Harvest Hollow',
    floorY: 0,
    killY: -20,
    arenaRadius: ARENA_R,
    theme: {
      sky: { top: 0x4ea8ff, horizon: 0xe2f4ff, bottom: 0xe2f4ff },
      background: 0xe2f4ff,
      fog: { color: 0xe2f4ff, near: 170, far: 520 },
      // A lime field bounces green light up into everything standing on it.
      bounce: 0xd2ecb4,
      trees: { trunk: 0x9a5b2e, leaves: [0x3fbf3f, 0x56d24a, 0x2fae3c] },
      palette: {
        grass: { color: 0x58d935, checker: true },
        dirt: { color: 0xf2a03d, stripe: 0xffd27a },
        // The perimeter is a low white kerb under the picket fence; the fence
        // posts are the full height of the barrier, so no glass is needed.
        fence: { color: 0xffffff, kerb: 0.6, glass: false, blockLen: 3.2 },
        barnWall: { color: 0xe8443a, round: 0.35 },
        silo: { color: 0xf6f1e4 },
        hay: { color: 0xffc83d, bale: true, baleLine: 0xe2a12a },
        millBase: { color: 0xffffff },
        water: { color: 0x3fa0ff, checker: 0.07 },
      },
      accent: 0xffc83d,
      accentAlt: 0x58d935,
      backdrop: {
        clouds: { count: 14, r: [230, 360], y: [45, 110], size: [18, 32] },
        rings: [
          { prop: 'tree', count: 30, r: [150, 175], h: [9, 14], phase: 0.05, colors: {} },
          { prop: 'hill', count: 26, r: [190, 250], h: [18, 40], base: -4, colors: {} },
        ],
      },
    },
    solids,
    visuals,
    // Outside the ramps (which reach r≈50) and inside the fence, so nobody
    // starts the match perched halfway up a slope.
    spawns: spawnRing(15, 55, 0, 0.02),
    boxes,
  };
}
