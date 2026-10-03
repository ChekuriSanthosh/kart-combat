/**
 * Sky Pinball — a candy sky park floating above the clouds.
 * A fast, bumper-filled lower deck ringed by four elevated islands joined into
 * an outer circuit. Miss a bridge and you drop into the cloud sea.
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
  // `tint` is render-only: every bumper a different candy colour.
  const bumperTints = [0xffd23f, 0x3ee7ff, 0x45d65a, 0xff9a1f, 0x4a98f0, 0xb36bff];
  const bumperSpots = [
    { x: 0, z: 0, r: 2.6, bounce: 24, tint: 0xff4a6a },
    ...circlePoints(6, 15, 0, 0.083).map((p, i) => ({ x: p.x, z: p.z, r: 1.5, bounce: 18, tint: bumperTints[i] })),
  ];
  for (const b of bumperSpots) {
    solids.push(cyl(b.x, 0, b.z, b.r, 2.4, 'bumper', { bumper: true, bounce: b.bounce, tint: b.tint }));
  }

  // ── Visual dressing ──
  // Painted pinball-table lines on the deck: round the bumper ring and just
  // inside the rail.
  visuals.push(decor('paintRing', 0, 0, 0, { r: DECK_R - 2.2, w: 0.45 }));
  visuals.push(decor('paintRing', 0, 0, 0, { r: 18.2, w: 0.35 }));
  visuals.push(decor('paintRing', 0, 0, 0, { r: 5.4, w: 0.35, color: 0xffd23f }));
  // Little grassy islands bobbing around the park at every height.
  circlePoints(12, 82, 0, 0.04).forEach((p, i) => {
    visuals.push(decor('floatIsle', p.x * (1 + (i % 3) * 0.12), -6 + (i % 5) * 5, p.z * (1 + (i % 3) * 0.12), { r: 3 + (i % 4) * 1.2 }));
  });
  // Candy-striped poles stand beyond the outer lip so karts never drive
  // through them.
  for (const [ox, oz] of islandDirs) {
    const beyond = ISLAND_DIST + ISLAND_SIZE / 2 + 1.6;
    visuals.push(decor('candyPole', ox * beyond, ISLAND_TOP - 1, oz * beyond, { h: 9 }));
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
      // Daylight all round, and the bottom of the sky is cloud-white: the
      // void reads as a drop into the clouds, not into black space.
      sky: { top: 0x52adff, horizon: 0xdff3ff, bottom: 0xf5faff },
      background: 0xdff3ff,
      fog: { color: 0xdff3ff, near: 180, far: 520 },
      bounce: 0xece6ff,
      palette: {
        deck: { color: 0xa596ff, checker: true },
        rail: { color: 0xff6fae, round: 0.5 },
        island: { color: 0x5fe08a, checker: true, round: 0.45 },
        rampNeon: { color: 0xffb02e, stripe: 0xffffff },
        bridge: { color: 0xffd84d, checker: true, round: 0.3 },
        // Bumpers are tinted one by one; this is the shared shape.
        bumper: { color: 0xff4a6a, ring: 0xffffff },
      },
      // Kept for anything that wants one signature colour per arena.
      accent: 0xff6fae,
      accentAlt: 0xa596ff,
      backdrop: {
        // Below the platforms, above the kill plane: a fall vanishes into
        // cloud a beat before it counts.
        cloudSea: { y: -24, r: 330, size: 20 },
        clouds: { count: 16, r: [200, 340], y: [30, 95], size: [18, 32] },
        rings: [
          { prop: 'cloudBank', count: 18, r: [160, 250], h: [16, 28], y: -12 },
        ],
      },
    },
    solids,
    visuals,
    // Clear of the bumper ring at r=15 and the deck rail at r=25.4.
    spawns: spawnRing(15, 22, 0, 0.0),
    boxes,
  };
}
