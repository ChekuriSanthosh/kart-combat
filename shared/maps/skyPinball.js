/**
 * Sky Pinball — neon platforms floating over a void.
 * A fast, bumper-filled lower deck ringed by four elevated islands joined into
 * an outer circuit. Miss a bridge and you fall.
 */

import { box, cyl, ramp, decor, spawnRing, circlePoints } from './helpers.js';

const DECK_R = 26;
const ISLAND_DIST = 40;
const ISLAND_SIZE = 14;
const ISLAND_TOP = 4.2;
const RAMP_W = 8;

export default function skyPinball() {
  const solids = [];
  const visuals = [];
  const boxes = [];

  // ── Lower deck ──
  solids.push(cyl(0, -2.2, 0, DECK_R, 2.2, 'deck'));

  // A rail follows the deck's circular rim so a bumper hit does not mean
  // instant death. It is built from short chords rather than a few long
  // straights: an octagon around a circle leaves an unguarded crescent at each
  // corner, and karts pour through those gaps into the void.
  //
  // Four gaps are left, one per cardinal, exactly wide enough for the access
  // ramp that fills them — any wider and karts squeeze past the ramp's edge.
  const RAIL_H = 2.0;
  const RAIL_T = 1.2;
  const railR = DECK_R - RAIL_T / 2;
  const MOUTH = RAMP_W - 1;
  const mouthHalfAngle = Math.asin(MOUTH / 2 / railR);

  for (let q = 0; q < 4; q++) {
    const from = (q / 4) * Math.PI * 2 + mouthHalfAngle;
    const to = ((q + 1) / 4) * Math.PI * 2 - mouthHalfAngle;
    const span = to - from;
    const count = Math.max(1, Math.round(span / 0.19));
    const step = span / count;
    // Overlap neighbours slightly so no seam can open up between chords.
    const chord = 2 * railR * Math.sin(step / 2) + 0.35;
    for (let i = 0; i < count; i++) {
      const a = from + step * (i + 0.5);
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      solids.push(box(
        ox * railR, 0, oz * railR,
        chord, RAIL_H, RAIL_T,
        'rail',
        { rotY: Math.atan2(ox, oz) },
      ));
    }
  }

  // ── Four elevated islands on the cardinals ──
  const islandDirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [ox, oz] of islandDirs) {
    const cx = ox * ISLAND_DIST;
    const cz = oz * ISLAND_DIST;
    solids.push(box(cx, ISLAND_TOP - 1.0, cz, ISLAND_SIZE, 1.0, ISLAND_SIZE, 'island'));

    // Access ramp climbing outward from the deck. Its high edge lands exactly on
    // the island's inner edge, so there is no lip to stall against.
    const rotY = Math.atan2(ox, oz);
    const innerEdge = ISLAND_DIST - ISLAND_SIZE / 2;
    const rampLen = 10;
    const rMid = innerEdge - rampLen / 2;
    solids.push(ramp(ox * rMid, 0, oz * rMid, RAMP_W, rampLen, ISLAND_TOP, rotY, 'rampNeon'));

    // A lip around the three outer sides, so an island reads as a distinct
    // platform rather than blending into the bridges, and overshoots are caught.
    const lipOffset = ISLAND_SIZE / 2 - 0.6;
    solids.push(box(
      cx + ox * lipOffset, ISLAND_TOP, cz + oz * lipOffset,
      ISLAND_SIZE, 1.3, 1.2, 'rail', { rotY },
    ));
    // Short returns down the sides, leaving the bridge mouths open.
    const sideX = oz;
    const sideZ = -ox;
    for (const s of [-1, 1]) {
      solids.push(box(
        cx + sideX * s * lipOffset + ox * (ISLAND_SIZE / 4),
        ISLAND_TOP,
        cz + sideZ * s * lipOffset + oz * (ISLAND_SIZE / 4),
        ISLAND_SIZE / 2, 1.3, 1.2, 'rail', { rotY: rotY + Math.PI / 2 },
      ));
    }

    boxes.push({ x: cx, y: ISLAND_TOP, z: cz });
  }

  // ── Bridges joining adjacent islands into an outer circuit ──
  for (const [i, j] of [[0, 2], [2, 1], [1, 3], [3, 0]]) {
    const a = islandDirs[i];
    const b = islandDirs[j];
    const ax = a[0] * ISLAND_DIST;
    const az = a[1] * ISLAND_DIST;
    const bx = b[0] * ISLAND_DIST;
    const bz = b[1] * ISLAND_DIST;
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const dx = bx - ax;
    const dz = bz - az;
    const span = Math.hypot(dx, dz);
    // Wide enough to cross without threading a needle — a bridge you fall off
    // half the time is just a respawn button.
    solids.push(box(
      cx, ISLAND_TOP - 0.7, cz,
      9, 0.7, span - ISLAND_SIZE + 4,
      'bridge',
      { rotY: Math.atan2(dx, dz) },
    ));
  }

  // ── Bumpers: the pinball half of the name ──
  // One centre boss and a single ring. Earlier versions had three rings, which
  // turned the deck into an obstacle course you pinballed through rather than
  // an arena you could actually aim and drive in.
  const bumperSpots = [
    { x: 0, z: 0, r: 2.6, bounce: 24 },
    ...circlePoints(6, 15, 0, 0.083).map((p) => ({ x: p.x, z: p.z, r: 1.5, bounce: 18 })),
  ];
  for (const b of bumperSpots) {
    solids.push(cyl(b.x, 0, b.z, b.r, 2.4, 'bumper', { bumper: true, bounce: b.bounce }));
  }

  // ── Visual dressing ──
  visuals.push(decor('voidGrid', 0, -26, 0, { size: 320 }));
  visuals.push(decor('deckGlow', 0, 0.02, 0, { r: DECK_R - 0.4 }));
  circlePoints(24, 78, 0).forEach((p, i) => {
    visuals.push(decor('skyShard', p.x, -8 + (i % 6) * 9, p.z, { r: 4 + (i % 4) * 3 }));
  });
  // Beacons sit beyond the outer lip so karts never drive through them.
  for (const [ox, oz] of islandDirs) {
    const beyond = ISLAND_DIST + ISLAND_SIZE / 2 + 1.6;
    visuals.push(decor('pylon', ox * beyond, ISLAND_TOP - 1, oz * beyond, { h: 9 }));
  }

  // ── Pickups: scarce on purpose, so crates are worth contesting ──
  // Four on the lower deck between the bumper rings, one per island (above),
  // and one at the middle of each bridge.
  for (const p of circlePoints(4, 10, 0, 0.125)) boxes.push({ x: p.x, y: 0, z: p.z });
  for (const [i, j] of [[0, 2], [2, 1], [1, 3], [3, 0]]) {
    const a = islandDirs[i];
    const b = islandDirs[j];
    boxes.push({
      x: (a[0] + b[0]) * ISLAND_DIST / 2,
      y: ISLAND_TOP,
      z: (a[1] + b[1]) * ISLAND_DIST / 2,
    });
  }

  return {
    id: 'skyPinball',
    name: 'Sky Pinball',
    // No infinite floor: anything not standing on a solid falls into the void.
    floorY: -1000,
    killY: -30,
    arenaRadius: ISLAND_DIST + ISLAND_SIZE / 2,
    theme: {
      background: 0x0a0a1f,
      fog: { color: 0x120a2e, near: 70, far: 230 },
      hemi: { sky: 0x5566ff, ground: 0x180a30, intensity: 0.32 },
      ambient: { color: 0x8899ff, intensity: 0.2 },
      sun: { color: 0xdce8ff, intensity: 2.4, x: 38, y: 50, z: 44 },
      palette: {
        deck: 0x1d2350,
        rail: 0x00e5ff,
        island: 0x2a1a55,
        rampNeon: 0xb14eff,
        bridge: 0x243066,
        bumper: 0xff2d95,
      },
      accent: 0x00e5ff,
      accentAlt: 0xff2d95,
    },
    solids,
    visuals,
    // Clear of the bumper ring at r=15 and the deck rail at r=25.4.
    spawns: spawnRing(15, 22, 0, 0.0),
    boxes,
  };
}
