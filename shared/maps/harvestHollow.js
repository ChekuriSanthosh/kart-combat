/**
 * Harvest Hollow — a working farm at golden hour.
 *
 * The brief for this arena was "fewer hurdles". Gravel Pit blocks the floor
 * with 39 solids and the fighting happens in the gaps between them; here the
 * field is deliberately wide open and almost all of the character comes from
 * things you cannot crash into — crop rows, a pond, a turning windmill, fence
 * lines running off toward the treeline.
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
 *   The two earth ramps point inward, so air time is always spent heading
 *   back into the fight.
 */

import { box, cyl, ramp, ring, decor, spawnRing, circlePoints } from './helpers.js';

const ARENA_R = 46;
const FENCE_H = 3.0;

/** Barn: two long walls with both ends open, so you drive straight through. */
const BARN_X = -20;
const BARN_Z = 2;
const BARN_LEN = 24;
const BARN_HALF_W = 6.5;
const BARN_WALL_T = 1.2;
const BARN_H = 5.0;

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
  const siloSpots = [[27, -17], [33, -8], [26, 0]];
  for (const [sx, sz] of siloSpots) {
    solids.push(cyl(sx, 0, sz, 3.2, 13, 'silo'));
  }

  // ── Two earth ramps, both throwing you back toward the middle ──
  for (const [rx, rz] of [[6, 30], [-4, -31]]) {
    const rotY = Math.atan2(-rx, -rz); // high edge faces the centre
    solids.push(ramp(rx, 0, rz, 9, 11, 2.4, rotY + Math.PI, 'dirt'));
  }

  // ── Round bales: sparse, and round for the same reason the silos are ──
  const balePositions = [[14, -6], [10, 14], [-6, 22], [-30, -18], [30, 16]];
  for (const [bx, bz] of balePositions) {
    solids.push(cyl(bx, 0, bz, 1.9, 1.7, 'hay'));
  }

  // ── Windmill: a landmark you navigate by, with a base you can hit ──
  solids.push(cyl(0, 0, -36, 2.2, 15, 'millBase'));

  // ── Visual dressing: none of this collides ──
  // Far wider than the arena and round, so the edge of the world dies in fog
  // rather than ending in a visible corner.
  visuals.push(decor('ground', 0, 0, 0, { size: 620, mat: 'grass', round: true }));
  // Crops sit *outside* the fence. Inside, their rows clipped through both the
  // fence and the karts driving over them; outside, they layer properly —
  // fence, then worked fields, then the treeline — and read as the farm this
  // arena is parked in rather than decoration scattered on the track.
  visuals.push(decor('cropField', 44, 0, 40, { w: 26, d: 20, rotY: -0.7, rows: 24 }));
  visuals.push(decor('cropField', -50, 0, 34, { w: 22, d: 17, rotY: 0.6, rows: 20 }));
  visuals.push(decor('cropField', -8, 0, 62, { w: 30, d: 18, rotY: 0.1, rows: 26 }));
  visuals.push(decor('pond', -27, 0, -29, { r: 8 }));
  visuals.push(decor('barnShell', BARN_X, 0, BARN_Z, {
    w: BARN_HALF_W * 2 + BARN_WALL_T, d: BARN_LEN, h: BARN_H,
  }));
  for (const [sx, sz] of siloSpots) {
    visuals.push(decor('siloCap', sx, 13, sz, { r: 3.2 }));
  }
  visuals.push(decor('windmill', 0, 0, -36, { h: 15, r: 2.2 }));
  visuals.push(decor('fenceLine', 0, 0, 0, { r: ARENA_R, posts: 68, h: FENCE_H }));

  // A treeline just outside the fence gives the field somewhere to *be*,
  // without putting anything in the way. One node, instanced by the renderer.
  visuals.push(decor('treeline', 0, 0, 0, {
    count: 34, r: ARENA_R + 38, h: 8, phase: 0.11,
  }));
  for (const [tx, tz] of [[30, -48], [-52, 6], [52, 22]]) {
    visuals.push(decor('tractor', tx, 0, tz, { rotY: tx * 0.1 }));
  }

  // ── Pickups: a wide ring plus a pair inside the barn tunnel ──
  for (const p of circlePoints(8, 30, 0, 0.06)) boxes.push({ x: p.x, y: 0, z: p.z });
  for (const p of circlePoints(2, 13, 0, 0.25)) boxes.push({ x: p.x, y: 0, z: p.z });
  boxes.push({ x: BARN_X, y: 0, z: BARN_Z - 7 });
  boxes.push({ x: BARN_X, y: 0, z: BARN_Z + 7 });

  return {
    id: 'harvestHollow',
    name: 'Harvest Hollow',
    floorY: 0,
    killY: -20,
    arenaRadius: ARENA_R,
    theme: {
      background: 0x9fd4f0,
      fog: { color: 0xcfe6f2, near: 95, far: 260 },
      hemi: { sky: 0xbfe4ff, ground: 0x6f7a3a, intensity: 0.62 },
      ambient: { color: 0xfff3dc, intensity: 0.34 },
      // Low and warm: long shadows across the field read as late afternoon.
      sun: { color: 0xffe9c0, intensity: 2.5, x: -52, y: 44, z: 30 },
      palette: {
        grass: 0x6f9e3f,
        dirt: 0xa9793f,
        fence: 0xe8dcc0,
        barnWall: 0xb8352c,
        silo: 0xd9d4c6,
        hay: 0xd8b053,
        millBase: 0xe8dcc0,
      },
      accent: 0xffc93c,
      accentAlt: 0x6f9e3f,
    },
    solids,
    visuals,
    // Outside the ramps (which reach r≈36) and inside the fence, so nobody
    // starts the match perched halfway up a slope.
    spawns: spawnRing(15, 40, 0, 0.02),
    boxes,
  };
}
