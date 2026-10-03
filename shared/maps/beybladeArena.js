/**
 * Beyblade Arena — a spinning stadium dish under a daylight sky.
 *
 * The bowl is one smooth slope: a flat centre pit, then concentric bands whose
 * tops ramp from one band's height to the next, so their edges meet exactly and
 * a kart rolls up and down it like the real thing. It used to be eighteen flat
 * terraces 0.42 m apart, and a kart sampling the ground under its centre would
 * sink its nose into each step until it crossed it, then pop up a step in a
 * single frame — the "digging into the arena" this replaced.
 *
 * The profile steepens towards the rim (height ∝ distance^1.5), flat enough in
 * the middle to fight in and steep enough at the edge to feel like a bowl. The
 * dish spins, dragging karts around it and flinging them toward the rim.
 */

import { cyl, ring, decor, spawnRing, circlePoints } from './helpers.js';

const CENTER_R = 10;
const BOWL_W = 46;
const OUTER_R = CENTER_R + BOWL_W; // 56
const RIM_TOP = 8;
/** One metre per band: fine enough that the straight segments read as a curve. */
const BAND_W = 1;
const BANDS = BOWL_W / BAND_W;

/** Height of the dish surface at a distance from the centre. */
export function dishHeight(radius) {
  if (radius <= CENTER_R) return 0;
  const t = Math.min(1, (radius - CENTER_R) / BOWL_W);
  return RIM_TOP * t ** 1.5;
}

export default function beybladeArena() {
  const solids = [];
  const visuals = [];
  const boxes = [];

  // Flat centre pit.
  solids.push(cyl(0, -1.5, 0, CENTER_R, 1.5, 'dishCore', { spins: true }));

  // The bowl: one sloped band per metre, each a tube whose top climbs from the
  // previous band's outer height to its own, so the surface is continuous.
  // Colours alternate every two metres, which reads as rings on the spinner.
  for (let k = 0; k < BANDS; k++) {
    const inner = CENTER_R + k * BAND_W;
    const outer = inner + BAND_W;
    const low = dishHeight(inner);
    const high = dishHeight(outer);
    solids.push(cyl(0, -1.5, 0, outer, high + 1.5, Math.floor(k / 2) % 2 ? 'dishB' : 'dishA', {
      inner,
      rise: high - low,
      spins: true,
    }));
  }

  // Rim wall — keeps the fight inside the stadium.
  solids.push(ring(0, RIM_TOP, 0, OUTER_R, 9, 'rim'));

  // Four launcher posts just outside the centre pit: obstacles to juke around.
  // These stay put — a mesh that span while its collider did not would be a lie.
  // Each stands at the height of the lowest point under it so no gap shows.
  const POST_R = CENTER_R + 4;
  for (const p of circlePoints(4, POST_R, 0, Math.PI / 4)) {
    solids.push(cyl(p.x, dishHeight(POST_R - 1.5), p.z, 1.5, 2.4, 'post'));
  }

  // ── Visual dressing ──
  // The stadium sits on a lawn, with grandstands all round and floodlights
  // behind them. Nothing out here can be reached: the rim wall is 9 m tall.
  visuals.push(decor('ground', 0, -1.6, 0, { size: 380, mat: 'lawn', round: true }));
  visuals.push(decor('drum', 0, -1.6, 0, { r: OUTER_R + 0.05, h: RIM_TOP + 1.6 }));
  visuals.push(decor('stands', 0, 0, 0, {
    r: OUTER_R + 7, rows: 8, step: 1.7, rise: 1.5, base: -1.6, sectors: 16,
  }));
  circlePoints(8, OUTER_R + 26, 0, 0.0625).forEach((p) => {
    visuals.push(decor('floodlight', p.x, -1.6, p.z, { h: 24 }));
  });
  // The emblem and grooves ride the spinner so the rotation is readable.
  visuals.push(decor('centreEmblem', 0, 0.03, 0, { r: CENTER_R - 0.5, spins: true }));
  for (const r of [17, 27, 37, 47]) {
    visuals.push(decor('grooveRing', 0, dishHeight(r) + 0.05, 0, { r, spins: true }));
  }

  // ── Pickups: two sparse rings, so the dish stays a fight over territory ──
  for (const [r, n, phase] of [[17, 4, 0], [39, 10, 0.1]]) {
    for (const p of circlePoints(n, r, 0, phase)) {
      boxes.push({ x: p.x, y: dishHeight(r), z: p.z });
    }
  }

  const spawns = spawnRing(15, 32, 0, 0.05).map((s) => ({ ...s, y: dishHeight(32) }));

  return {
    id: 'beybladeArena',
    name: 'Beyblade Arena',
    floorY: -1000,
    killY: -20,
    /**
     * Read by the server each tick and by the client to spin the dish mesh.
     * `centrifugal` is deliberately mild: enough that holding the middle takes
     * effort, not so much that everyone ends up pinned against the rim.
     *
     * `yawGrip` is how much of the floor's rotation the tyres pick up, so a
     * parked kart turns with the dish at the same rate the dish turns. It is
     * the *same* `omega` the mesh spins at, which is what makes a stationary
     * kart look bolted to the floor rather than sliding on it.
     */
    // omega was 0.52 on the old 44 m dish; slowed in step with the bigger
    // radius so the rim still moves at about the same speed (~25 m/s).
    spin: { omega: 0.45, centrifugal: 0.22, tangential: 0.1, yawGrip: 1 },
    /**
     * Above this the dish no longer has any grip on you — a kart launched over
     * the rim is in the air, not on the ride. Set just above the rim so the
     * terraces, which is everywhere a kart can actually drive, are all covered.
     */
    spinCeiling: RIM_TOP + 3,
    arenaRadius: OUTER_R,
    theme: {
      sky: { top: 0x4ea8ff, horizon: 0xe2f4ff, bottom: 0xe2f4ff },
      background: 0xe2f4ff,
      fog: { color: 0xe2f4ff, near: 170, far: 520 },
      bounce: 0xdbe9f7,
      palette: {
        dishCore: { color: 0xffffff, polar: -0.07, wedges: 16, size: 2 },
        // The terraces are one merged spinning mesh; these are its ring
        // colours, alternating white and sky blue, with `theme.dish` wedges.
        dishA: 0xf7fbff,
        dishB: 0xc4e2ff,
        // The rim kerb: chunky blocks in red / yellow / blue, white between.
        rim: {
          color: 0xff4a4a,
          stripes: [0xff4a4a, 0xffffff, 0xffd23f, 0xffffff, 0x2a7de1, 0xffffff],
          kerb: 1.1,
          blockLen: 2.6,
        },
        post: { color: 0x2a7de1, ring: 0xffd23f },
        lawn: { color: 0x58d935, checker: true },
      },
      dish: { polar: -0.07, wedges: 24, ring: 2 },
      seats: [0xff4a4a, 0x2a7de1, 0xffd23f, 0x45d65a],
      emblem: [0xff4a4a, 0xffd23f, 0x2a7de1, 0xffffff],
      groove: 0xffd23f,
      accent: 0xff4a4a,
      accentAlt: 0x2a7de1,
      backdrop: {
        clouds: { count: 14, r: [230, 360], y: [45, 110], size: [18, 32] },
        rings: [
          { prop: 'tree', count: 46, r: [96, 140], h: [7, 11], colors: {} },
          { prop: 'hill', count: 24, r: [170, 230], h: [16, 34], base: -4, colors: {} },
        ],
      },
    },
    solids,
    visuals,
    spawns,
    boxes,
  };
}
