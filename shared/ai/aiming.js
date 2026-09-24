/**
 * Where to point so a shot actually connects.
 *
 * Aiming at where a kart *is* only works against a stationary one. Everything
 * here is about aiming at where it is going to be, and about knowing when not
 * to pull the trigger at all.
 */

import { pointInSolid } from '../collision.js';

/**
 * Lead time for a shot, solved exactly.
 *
 * The projectile leaves at `speed` along whatever direction we choose, plus a
 * fixed share of the shooter's own velocity that it inherits regardless of aim
 * (see `spawnProjectiles`). Folding that inherited part into the target's
 * relative velocity turns the problem back into the standard one:
 *
 *   |d + W·t| = speed·t        with  d = target − shooter
 *                                    W = targetVel − shooterVel·inherit
 *
 * Squaring gives a quadratic in t. The smallest positive root is the first
 * moment the projectile can be in the same place as the target.
 *
 * @returns {{ t: number, x: number, z: number } | null} impact time and point
 */
export function solveIntercept({
  sx, sz, svx = 0, svz = 0,
  tx, tz, tvx = 0, tvz = 0,
  speed, inherit = 0,
}) {
  const dx = tx - sx;
  const dz = tz - sz;
  const wx = tvx - svx * inherit;
  const wz = tvz - svz * inherit;

  const a = wx * wx + wz * wz - speed * speed;
  const b = 2 * (dx * wx + dz * wz);
  const c = dx * dx + dz * dz;

  let t;
  if (Math.abs(a) < 1e-6) {
    // Target is running at exactly projectile speed: the quadratic collapses.
    if (Math.abs(b) < 1e-6) return null;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null; // cannot be caught
    const root = Math.sqrt(disc);
    const t1 = (-b - root) / (2 * a);
    const t2 = (-b + root) / (2 * a);
    // Smallest positive root; the other is the shot that catches up later.
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    t = lo > 1e-4 ? lo : hi;
  }

  if (!(t > 1e-4) || !Number.isFinite(t)) return null;
  return { t, x: tx + tvx * t, z: tz + tvz * t };
}

/**
 * Yaw the shooter should hold to hit `target` with `def`.
 *
 * `lead` scales how much of the solved lead to actually apply, which is the
 * main lever difficulty pulls: 0 aims straight at the target's current
 * position the way a beginner would, 1 is the full solution.
 *
 * @returns {{ yaw: number, dist: number, time: number } | null}
 */
export function aimAt(def, shooter, target, lead = 1) {
  const s = shooter.state;
  const t = target.state;
  const dist = Math.hypot(t.x - s.x, t.z - s.z);

  // Mines are dropped behind, and self-buffs are not aimed at all.
  if (!def || def.kind === 'self' || def.kind === 'mine') return null;

  const def2 = def.kind === 'burst' ? { speed: 44 } : def;
  const speed = def2.speed || 40;

  let aimX = t.x;
  let aimZ = t.z;
  let time = dist / speed;

  if (lead > 0) {
    const hit = solveIntercept({
      sx: s.x, sz: s.z, svx: s.vx, svz: s.vz,
      tx: t.x, tz: t.z, tvx: t.vx, tvz: t.vz,
      speed,
      // Lobbed shots arc and lose their flat-trajectory assumption; the rest
      // inherit 35% of the shooter's velocity from spawnProjectiles.
      inherit: def.kind === 'lobbed' ? 0 : 0.35,
    });
    if (hit) {
      aimX = t.x + (hit.x - t.x) * lead;
      aimZ = t.z + (hit.z - t.z) * lead;
      time = hit.t;
    }
  }

  return { yaw: Math.atan2(aimX - s.x, aimZ - s.z), dist, time };
}

/**
 * Is there a clear shot from a to b?
 *
 * Marched at the height a projectile actually flies, so bots stop firing
 * rockets into the wall they are hiding behind. Sampling is coarse on purpose:
 * this runs for every armed bot every time it considers a shot, and a metre of
 * slop matters far less than the cost.
 */
export function hasLineOfFire(solids, ax, ay, az, bx, by, bz, step = 1.2) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-3) return true;

  const steps = Math.max(2, Math.ceil(dist / step));
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    if (pointInSolid(solids, ax + dx * f, ay + dy * f, az + dz * f)) return false;
  }
  return true;
}
