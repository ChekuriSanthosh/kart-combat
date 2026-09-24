/**
 * Map registry. Blueprints are built once, their solids indexed for fast
 * queries, and every spawn / pickup snapped onto the surface underneath it so
 * nothing can start life buried in geometry or floating above it.
 */

import { prepareSolids, sampleGround, resolveHorizontal } from '../collision.js';
import { KART } from '../physics.js';
import { MAP_IDS, DEFAULT_MAP_ID } from '../constants.js';

import gravelPit from './gravelPit.js';
import skyPinball from './skyPinball.js';
import beybladeArena from './beybladeArena.js';

const BUILDERS = { gravelPit, skyPinball, beybladeArena };

const cache = new Map();

function settle(map, point, clearance) {
  // Nudge out of any wall the point starts inside, then drop it onto the floor.
  const probe = { x: point.x, z: point.z, vx: 0, vz: 0 };
  const guessY = sampleGround(map.solids, probe.x, probe.z, (point.y ?? 0) + 2.5, map.floorY);
  resolveHorizontal(map.solids, probe, clearance, guessY, guessY + KART.height);
  const y = sampleGround(map.solids, probe.x, probe.z, guessY + 2.5, map.floorY);
  return { ...point, x: probe.x, z: probe.z, y };
}

export function getMap(id) {
  const mapId = BUILDERS[id] ? id : DEFAULT_MAP_ID;
  let map = cache.get(mapId);
  if (map) return map;

  map = BUILDERS[mapId]();
  prepareSolids(map.solids);
  map.bumpers = map.solids.filter((s) => s.bumper);
  map.spawns = map.spawns.map((s) => settle(map, s, KART.radius));
  map.boxes = map.boxes.map((b, i) => ({ ...settle(map, b, 0.6), index: i }));
  cache.set(mapId, map);
  return map;
}

export function getSpawn(mapId, index) {
  const map = getMap(mapId);
  const list = map.spawns;
  const s = list[((index % list.length) + list.length) % list.length];
  return { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
}

/**
 * Per-map forces: the Beyblade dish drags karts around and flings them at the
 * rim, and Sky Pinball's bumpers kick them away. Both server and client
 * prediction call this so the two stay in step.
 *
 * Bumper response *sets* the outward speed rather than adding to it, which
 * makes it idempotent — running it twice gives the same answer, so a replayed
 * client frame matches the server's.
 *
 * `yawRate` comes back separately from the linear forces because a spinning
 * floor turns a kart as well as carrying it: standing still on the Beyblade
 * dish should rotate you, not just sweep you round the middle.
 */
export function applyEnvironment(map, s) {
  const out = { ax: 0, az: 0, yawRate: 0 };

  // Being *inside the bowl* is what puts a kart under the dish's influence,
  // not being exactly in contact with it this frame.
  //
  // The terraces step down 0.42 m at a time, so a kart driving outward is
  // repeatedly leaving the surface for a few frames at a time — measured at
  // 40% of frames airborne, with `grounded` flipping five times a second.
  // Gating the spin on `grounded` therefore switched the whole force on and
  // off at that rate, and since the force feeds both the server and client
  // prediction, the disagreement showed up as the kart and camera shaking.
  // A kart two hand-spans above a spinning floor is still on the ride.
  const onDish = map.spin
    && (s.grounded || s.vy <= 0)
    && s.y <= (map.spinCeiling ?? Infinity);

  if (onDish) {
    const { omega, centrifugal, tangential, yawGrip = 1 } = map.spin;
    const r = Math.hypot(s.x, s.z);

    // Anywhere on the dish, the surface under the wheels is turning, so the
    // kart turns with it — including at r = 0, where there is no orbit at all
    // and rotation is the only thing the spin can do to you.
    if (!map.arenaRadius || r <= map.arenaRadius) {
      out.yawRate += omega * yawGrip;
    }

    if (r > 0.5) {
      const nx = s.x / r;
      const nz = s.z / r;
      // Fade the outward pull to nothing at the rim, otherwise karts simply
      // stack up against the wall and the fight stops.
      const edge = map.arenaRadius ? Math.max(0, 1 - (r / map.arenaRadius) ** 2) : 1;
      out.ax += nx * centrifugal * omega * omega * r * edge;
      out.az += nz * centrifugal * omega * omega * r * edge;
      // Tangential drag from the rotating floor.
      out.ax += -nz * tangential * omega * r;
      out.az += nx * tangential * omega * r;
    }
  }

  for (const solid of map.bumpers || []) {
    const dx = s.x - solid.x;
    const dz = s.z - solid.z;
    const d = Math.hypot(dx, dz);
    const contact = solid.r + KART.radius + 0.25;
    if (d > contact || d < 1e-4) continue;
    if (s.y + KART.height < solid.y || s.y > solid.y + solid.h) continue;
    const nx = dx / d;
    const nz = dz / d;
    const radial = s.vx * nx + s.vz * nz;
    if (radial >= solid.bounce) continue;
    s.vx += nx * (solid.bounce - radial);
    s.vz += nz * (solid.bounce - radial);
  }

  return out;
}

export { MAP_IDS, DEFAULT_MAP_ID };

export const MAP_SUMMARY = MAP_IDS.map((id) => {
  const m = getMap(id);
  return { id: m.id, name: m.name };
});
