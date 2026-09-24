/**
 * Beyblade Arena — a spinning stadium dish.
 *
 * The bowl is built from concentric terraces whose steps are shorter than the
 * kart's step height, so karts drive smoothly up and down a surface that is
 * exactly what the player sees. The dish spins, dragging karts around it and
 * flinging them toward the rim.
 */

import { cyl, ring, decor, spawnRing, circlePoints } from './helpers.js';

const CENTER_R = 8;
const TERRACES = 18;
const TERRACE_W = 2;
const STEP = 0.42;
const OUTER_R = CENTER_R + TERRACES * TERRACE_W; // 44
const RIM_TOP = (TERRACES - 1) * STEP; // 7.14

export function terraceHeight(radius) {
  if (radius <= CENTER_R) return 0;
  const k = Math.min(TERRACES - 1, Math.floor((radius - CENTER_R) / TERRACE_W));
  return k * STEP;
}

export default function beybladeArena() {
  const solids = [];
  const visuals = [];
  const boxes = [];

  // Flat centre pit.
  solids.push(cyl(0, -1.5, 0, CENTER_R, 1.5, 'dishCore', { spins: true }));

  // Terraced bowl. Each ring is a tube so its top only covers its own band.
  for (let k = 0; k < TERRACES; k++) {
    const inner = CENTER_R + k * TERRACE_W;
    const outer = inner + TERRACE_W;
    const top = k * STEP;
    solids.push(cyl(0, -1.5, 0, outer, top + 1.5, k % 2 ? 'dishB' : 'dishA', {
      inner,
      spins: true,
    }));
  }

  // Rim wall — keeps the fight inside the stadium.
  solids.push(ring(0, RIM_TOP, 0, OUTER_R, 9, 'rim'));

  // Four launcher posts just outside the centre pit: obstacles to juke around.
  // These stay put — a mesh that span while its collider did not would be a lie.
  for (const p of circlePoints(4, CENTER_R + 3.5, 0, Math.PI / 4)) {
    solids.push(cyl(p.x, terraceHeight(CENTER_R + 3.5), p.z, 1.5, 2.2, 'post'));
  }

  // ── Visual dressing ──
  visuals.push(decor('cage', 0, 0, 0, { r: OUTER_R + 1.4, h: 20 }));
  visuals.push(decor('dishRim', 0, RIM_TOP, 0, { r: OUTER_R }));
  // The emblem and grooves ride the spinner so the rotation is readable.
  visuals.push(decor('centreEmblem', 0, 0.03, 0, { r: CENTER_R - 0.5, spins: true }));
  circlePoints(12, OUTER_R + 4.5, 0).forEach((p, i) => {
    visuals.push(decor('floodlight', p.x, 0, p.z, { h: 22, tint: i % 3 }));
  });
  for (const r of [14, 22, 30, 38]) {
    visuals.push(decor('grooveRing', 0, terraceHeight(r) + 0.05, 0, { r, spins: true }));
  }

  // ── Pickups: two sparse rings, so the dish stays a fight over territory ──
  for (const [r, n, phase] of [[14, 4, 0], [31, 8, 0.125]]) {
    for (const p of circlePoints(n, r, 0, phase)) {
      boxes.push({ x: p.x, y: terraceHeight(r), z: p.z });
    }
  }

  const spawns = spawnRing(15, 26, 0, 0.05).map((s) => ({ ...s, y: terraceHeight(26) }));

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
    spin: { omega: 0.52, centrifugal: 0.22, tangential: 0.1, yawGrip: 1 },
    /**
     * Above this the dish no longer has any grip on you — a kart launched over
     * the rim is in the air, not on the ride. Set just above the rim so the
     * terraces, which is everywhere a kart can actually drive, are all covered.
     */
    spinCeiling: RIM_TOP + 3,
    arenaRadius: OUTER_R,
    theme: {
      background: 0x0e1420,
      fog: { color: 0x141d2e, near: 80, far: 230 },
      hemi: { sky: 0xaaccff, ground: 0x202838, intensity: 0.34 },
      ambient: { color: 0xdde8ff, intensity: 0.18 },
      sun: { color: 0xffffff, intensity: 2.6, x: 36, y: 56, z: 40 },
      palette: {
        dishCore: 0xe8eef5,
        dishA: 0xd7dfe8,
        dishB: 0xb9c4d2,
        rim: 0xff3355,
        post: 0x33aaff,
      },
      accent: 0xff3355,
      accentAlt: 0x33aaff,
    },
    solids,
    visuals,
    spawns,
    boxes,
  };
}
