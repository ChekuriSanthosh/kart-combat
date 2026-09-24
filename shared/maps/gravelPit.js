/**
 * Gravel Pit — sun-baked desert arena.
 * A central rock butte to circle, four raised decks with ramps, launch ramps
 * for air time, and crates/tyres for cover.
 */

import { box, cyl, ramp, decor, arenaWalls, spawnRing, circlePoints } from './helpers.js';

const HALF = 42;
const WALL_H = 5.5;
const WALL_T = 3;

export default function gravelPit() {
  const solids = [];
  const visuals = [];
  const boxes = [];

  solids.push(...arenaWalls(HALF, WALL_H, WALL_T, 'cliff'));

  // ── Central butte: the arena's one landmark, circled rather than crossed ──
  solids.push(cyl(0, 0, 0, 6.5, 6.0, 'rock'));
  solids.push(cyl(-4.5, 0, -3.0, 3.4, 4.0, 'rock'));
  solids.push(cyl(3.8, 0, 4.2, 2.8, 3.0, 'rock'));

  // ── Four raised decks on the cardinals, each reachable by two ramps ──
  const DECK_SIZE = 15;
  const DECK_H = 2.6;
  const DECK_DIST = 26;
  const RAMP_LEN = 10;
  const half = DECK_SIZE / 2;

  for (const [dx, dz] of [[0, -DECK_DIST], [0, DECK_DIST], [-DECK_DIST, 0], [DECK_DIST, 0]]) {
    const len = Math.hypot(dx, dz);
    const outX = dx / len;
    const outZ = dz / len;
    const inX = -outX;
    const inZ = -outZ;
    // Ramps rise along their local +Z, which must point away from the centre.
    const rotY = Math.atan2(outX, outZ);
    // Perpendicular, used to sit the two ramps either side of the deck's midline.
    const perpX = outZ;
    const perpZ = -outX;

    solids.push(box(dx, 0, dz, DECK_SIZE, DECK_H, DECK_SIZE, 'plateau'));

    const reach = half + RAMP_LEN / 2;
    for (const lateral of [-4.2, 4.2]) {
      solids.push(ramp(
        dx + inX * reach + perpX * lateral,
        0,
        dz + inZ * reach + perpZ * lateral,
        6,
        RAMP_LEN,
        DECK_H,
        rotY,
        'dirt',
      ));
    }

    // Parapet along the outer lip — chest-high cover facing the perimeter.
    solids.push(box(
      dx + outX * (half - 0.7),
      DECK_H,
      dz + outZ * (half - 0.7),
      DECK_SIZE,
      1.1,
      1.4,
      'crate',
      { rotY },
    ));

    boxes.push({ x: dx, y: DECK_H, z: dz });
  }

  // ── Launch ramps on the diagonals — drive off the lip and fly ──
  const launches = [
    { x: -20, z: -20, rot: Math.PI * 0.25 },
    { x: 20, z: 20, rot: Math.PI * 1.25 },
    { x: -20, z: 20, rot: Math.PI * 0.75 },
    { x: 20, z: -20, rot: Math.PI * 1.75 },
  ];
  for (const l of launches) {
    solids.push(ramp(l.x, 0, l.z, 7, 12, 3.2, l.rot, 'metal', { launch: true }));
  }

  // ── Cover ──
  // Kept sparse on purpose. Every solid here is something you can crash into
  // at speed, and a field full of them turns driving into an obstacle course
  // instead of a fight. Four crates and four boulders, all well clear of the
  // ramp mouths and the racing line around the butte.
  const crateSpots = [[-31, -14], [31, 14], [-14, 31], [14, -31]];
  crateSpots.forEach(([x, z], i) => {
    solids.push(box(x, 0, z, 2.6, 2.6, 2.6, 'crate', { rotY: (i * 0.7) % Math.PI }));
  });

  for (const [x, z, r] of [[-36, 0, 3.0], [36, 0, 3.0], [0, -36, 2.7], [0, 36, 2.7]]) {
    solids.push(cyl(x, 0, z, r, r * 1.15, 'rock'));
  }

  // ── Visual dressing (no collision) ──
  visuals.push(decor('ground', 0, 0, 0, { size: (HALF + WALL_T) * 2, mat: 'sand' }));
  // Striped barriers hug the wall, where they add colour without ever being
  // something you slam into mid-fight.
  for (const [x, z, rotY] of [
    [-39, 0, 0], [39, 0, 0], [0, -39, Math.PI / 2], [0, 39, Math.PI / 2],
  ]) {
    visuals.push(decor('barrier', x, 0, z, { len: 14, rotY }));
  }
  // Scrub patches give the eye something to track speed against.
  for (const [x, z, r] of [
    [-22, -30, 9], [24, 28, 11], [-30, 20, 8], [31, -22, 9],
    [0, 0, 11], [-8, 40, 6], [9, -40, 6],
  ]) {
    visuals.push(decor('patch', x, 0, z, { r, mat: 'grass' }));
  }
  // Flags stand on top of the wall — down on the floor karts would drive
  // straight through the poles.
  circlePoints(10, HALF + WALL_T / 2, 0, 0.31).forEach((p, i) => {
    visuals.push(decor('flag', p.x, WALL_H, p.z, { height: 6, tint: i % 4 }));
  });
  circlePoints(18, 62, 0).forEach((p, i) => {
    visuals.push(decor('mesa', p.x, 0, p.z, { r: 7 + (i % 5) * 2.2, h: 12 + (i % 4) * 7 }));
  });
  visuals.push(decor('banner', 0, 0, -HALF + 1.8, { w: 26, rotY: 0 }));
  visuals.push(decor('banner', 0, 0, HALF - 1.8, { w: 26, rotY: Math.PI }));

  // ── Pickups: arcs around the butte plus lane drops ──
  // Crates are deliberately scarce — they are worth fighting over, and a field
  // littered with them means nobody ever has to leave their corner.
  // One ring hugging the central butte, one out on the diagonals.
  for (const p of circlePoints(4, 12, 0, 0.125)) boxes.push({ x: p.x, y: 0, z: p.z });
  for (const p of circlePoints(4, 30, 0, 0.125)) boxes.push({ x: p.x, y: 0, z: p.z });

  return {
    id: 'gravelPit',
    name: 'Gravel Pit',
    floorY: 0,
    killY: -12,
    arenaRadius: HALF + WALL_T,
    theme: {
      background: 0x9fd6f5,
      fog: { color: 0xe8cfa2, near: 80, far: 230 },
      // Fill is kept low on purpose. Wash the scene in ambient light and the
      // shadows disappear, which is what made the arena look flat and papery.
      // Enough bounce that faces turned away from the sun stay readable rock
      // rather than black cut-outs, but not so much that it flattens shadows.
      hemi: { sky: 0xbfe6ff, ground: 0x9a7448, intensity: 0.45 },
      ambient: { color: 0xfff1d8, intensity: 0.26 },
      // A lower sun throws longer shadows, which is most of what makes the
      // arena read as solid rather than painted on.
      sun: { color: 0xfff6e2, intensity: 2.6, x: 46, y: 54, z: 32 },
      palette: {
        sand: 0xe8c98d,
        dirt: 0x8f5f33,
        cliff: 0xb26a3c,
        rock: 0x8d8377,
        plateau: 0xc25a3f,
        crate: 0xd99b3f,
        tyre: 0x2e2e33,
        metal: 0xf5a623,
        grass: 0x6bbf4a,
        barrier: 0xe8413c,
      },
    },
    solids,
    visuals,
    spawns: spawnRing(15, 37, 0, 0.12),
    boxes,
  };
}
