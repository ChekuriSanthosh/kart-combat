/**
 * Gravel Pit — a sunny toy desert.
 * A central cluster of rounded boulders to circle, four raised decks with
 * ramps, launch ramps for air time, and giant toy blocks for cover. Outside
 * the walls: cacti and palms, banded mesas, and a sea on the horizon.
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
      'parapet',
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
  // Giant toy blocks, one of each colour. `tint` is read only by the renderer.
  const blockTints = [0xff4a4a, 0x2a7de1, 0x45d65a, 0xb36bff];
  crateSpots.forEach(([x, z], i) => {
    solids.push(box(x, 0, z, 2.6, 2.6, 2.6, 'crate', { rotY: (i * 0.7) % Math.PI, tint: blockTints[i] }));
  });

  for (const [x, z, r] of [[-36, 0, 3.0], [36, 0, 3.0], [0, -36, 2.7], [0, 36, 2.7]]) {
    solids.push(cyl(x, 0, z, r, r * 1.15, 'rock'));
  }

  // ── Visual dressing (no collision) ──
  // A sand island reaching well past the walls, with the sea beyond it (see
  // theme.backdrop), so the arena sits in a landscape rather than a void.
  visuals.push(decor('ground', 0, 0, 0, { size: 300, mat: 'sand', round: true }));
  // Warm patches give the eye something to track speed against.
  for (const [x, z, r] of [
    [-22, -30, 7], [24, 28, 8], [-30, 20, 6], [31, -22, 7],
    [-8, 38, 4.5], [9, -38, 4.5],
  ]) {
    visuals.push(decor('patch', x, 0, z, { r, mat: 'sandPatch' }));
  }
  // Flags stand on top of the wall — down on the floor karts would drive
  // straight through the poles.
  circlePoints(10, HALF + WALL_T / 2, 0, 0.31).forEach((p, i) => {
    visuals.push(decor('flag', p.x, WALL_H, p.z, { height: 6, tint: i % 4 }));
  });
  // Bunting strung along the north and south walls.
  visuals.push(decor('bunting', 0, WALL_H, -HALF - WALL_T / 2, { w: 26, h: 5 }));
  visuals.push(decor('bunting', 0, WALL_H, HALF + WALL_T / 2, { w: 26, h: 5 }));
  // Just outside the walls: palms tall enough to show over them, and cacti.
  circlePoints(10, 53, 0, 0.05).forEach((p, i) => {
    visuals.push(decor('palm', p.x, 0, p.z, { h: 9 + (i % 3) * 1.6 }));
  });
  circlePoints(9, 60, 0, 0.21).forEach((p, i) => {
    visuals.push(decor('cactus', p.x, 0, p.z, { h: 3.6 + (i % 4) * 0.8 }));
  });
  // Banded mesas further out: the skyline you see over the wall.
  circlePoints(12, 84, 0, 0.02).forEach((p, i) => {
    visuals.push(decor('mesa', p.x, 0, p.z, { r: 9 + (i % 4) * 2.4, h: 15 + (i % 5) * 4.5 }));
  });

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
      // Sky dome gradient; `background` and the fog match its horizon so the
      // far edge of the world melts into it instead of ending at a line.
      sky: { top: 0x4ea8ff, horizon: 0xe2f4ff, bottom: 0xe2f4ff },
      background: 0xe2f4ff,
      fog: { color: 0xe2f4ff, near: 170, far: 520 },
      // Light bounced up off the sand warms the undersides of everything.
      bounce: 0xf3dcaa,
      mesaBands: [0xf08a4b, 0xf9c27a, 0xe4703f, 0xfbd9a0],
      flags: [0xff4a4a, 0xffd23f, 0x2a7de1, 0x45d65a],
      palette: {
        sand: { color: 0xf7c95c, checker: true },
        sandPatch: { color: 0xf3b44c },
        cliff: { color: 0xf47b20, round: 0.9 },
        plateau: { color: 0xf2665a, checker: true, round: 0.55 },
        parapet: { color: 0xffd23f, studs: true, round: 0.3 },
        dirt: { color: 0xffd23f, stripe: 0xffffff },
        metal: { color: 0x2a7de1, stripe: 0x7fbaff },
        crate: { color: 0xff4a4a, studs: true, round: 0.32 },
        rock: { color: 0xe89a5a, boulder: true },
      },
      backdrop: {
        sea: { color: 0x3fb2ff, from: 150, y: -0.35 },
        clouds: { count: 14, r: [230, 360], y: [45, 110], size: [18, 32] },
        rings: [
          // Palms along the beach and big banded buttes standing in the sea.
          { prop: 'palm', count: 26, r: [128, 144], h: [9, 13], colors: {} },
          { prop: 'cactus', count: 14, r: [106, 122], h: [4, 6], colors: {} },
          {
            prop: 'mesa', count: 9, r: [230, 300], h: [34, 64], widthRatio: 0.55,
            phase: 0.3, base: -6, colors: { bands: [0xf08a4b, 0xf9c27a, 0xe4703f, 0xfbd9a0] },
          },
        ],
      },
    },
    solids,
    visuals,
    spawns: spawnRing(15, 37, 0, 0.12),
    boxes,
  };
}
