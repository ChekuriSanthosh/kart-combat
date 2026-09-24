/**
 * Solid geometry queries shared by server and client.
 *
 * The old build only ever pushed karts apart on X/Z, which turned every ramp,
 * bridge and platform into an invisible full-height wall. Here each solid
 * exposes a top surface, so a kart either drives onto it (when the top is
 * within step height) or is blocked by it (when it is not).
 *
 * Solid shapes — `y` is always the BOTTOM of the shape:
 *   { t:'box',  x, y, z, w, h, d, rotY }   axis box, optionally yaw-rotated
 *   { t:'cyl',  x, y, z, r, h, inner? }    upright cylinder; `inner` makes it a tube
 *   { t:'ramp', x, y, z, w, len, rise, rotY }
 *        flat at `y` on the local -Z edge, rising to `y + rise` on the local +Z edge
 *   { t:'ring', x, y, z, r, h }            hollow wall that keeps karts INSIDE radius r
 */

/** How tall a lip a kart can climb without a ramp. */
export const STEP_UP = 0.55;

const EPS = 1e-6;

// Matches THREE's Object3D.rotation.y so a solid's mesh and its collider share
// one orientation: local +Z maps to world (sin rotY, cos rotY).
function rotIn(solid, dx, dz) {
  const a = solid.rotY || 0;
  if (a === 0) return [dx, dz];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [dx * c - dz * s, dx * s + dz * c];
}

function rotOut(solid, u, v) {
  const a = solid.rotY || 0;
  if (a === 0) return [u, v];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [u * c + v * s, -u * s + v * c];
}

/**
 * Precompute a conservative world-space AABB so per-frame queries can reject
 * most solids with two comparisons.
 */
export function prepareSolids(solids) {
  for (const s of solids) {
    let reach;
    if (s.t === 'box') {
      reach = Math.hypot(s.w, s.d) * 0.5;
      s._top = s.y + s.h;
    } else if (s.t === 'ramp') {
      reach = Math.hypot(s.w, s.len) * 0.5;
      s._top = s.y + s.rise;
    } else {
      reach = s.r;
      s._top = s.y + s.h;
    }
    s._reach = reach;
    s._minX = s.x - reach;
    s._maxX = s.x + reach;
    s._minZ = s.z - reach;
    s._maxZ = s.z + reach;
  }
  return solids;
}

/**
 * Height of a solid's walkable top at (x, z), or null when (x, z) is outside
 * its footprint. Rings and non-walkable solids return null.
 */
export function topAt(s, x, z) {
  if (x < s._minX || x > s._maxX || z < s._minZ || z > s._maxZ) return null;
  const dx = x - s.x;
  const dz = z - s.z;

  if (s.t === 'box') {
    const [u, v] = rotIn(s, dx, dz);
    if (Math.abs(u) > s.w * 0.5 || Math.abs(v) > s.d * 0.5) return null;
    return s.y + s.h;
  }
  if (s.t === 'cyl') {
    const d2 = dx * dx + dz * dz;
    if (d2 > s.r * s.r) return null;
    if (s.inner && d2 < s.inner * s.inner) return null;
    return s.y + s.h;
  }
  if (s.t === 'ramp') {
    const [u, v] = rotIn(s, dx, dz);
    if (Math.abs(u) > s.w * 0.5 || Math.abs(v) > s.len * 0.5) return null;
    const t = (v + s.len * 0.5) / s.len;
    return s.y + s.rise * t;
  }
  return null; // rings have no top surface
}

/**
 * Highest surface a kart standing at (x, z) with its feet at `feetY` can rest
 * on. Surfaces more than STEP_UP above the feet are ignored (you cannot
 * teleport onto a roof), as are surfaces below `floorY`.
 */
export function sampleGround(solids, x, z, feetY, floorY) {
  let best = floorY;
  const ceiling = feetY + STEP_UP;
  for (const s of solids) {
    if (s.noStand) continue;
    if (s._top <= best) continue;
    const top = topAt(s, x, z);
    if (top === null) continue;
    if (top > ceiling) continue;
    if (top > best) best = top;
  }
  return best;
}

/** Fraction of the way along a→b at which it first enters an axis-aligned box. */
function sweepSlab(p, d, half) {
  if (Math.abs(d) < EPS) return Math.abs(p) <= half ? [0, 1] : null;
  let lo = (-half - p) / d;
  let hi = (half - p) / d;
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  return [lo, hi];
}

/**
 * First contact along a→b against an oriented rectangle grown by `radius`,
 * or null. Returns the entry fraction and which local axis was crossed.
 */
function sweepRect(s, halfW, halfD, radius, ax, az, bx, bz) {
  const [au, av] = rotIn(s, ax - s.x, az - s.z);
  const [bu, bv] = rotIn(s, bx - s.x, bz - s.z);
  const hu = halfW + radius;
  const hv = halfD + radius;
  // Already overlapping: this is a job for the push-out pass, not the sweep.
  if (Math.abs(au) <= hu && Math.abs(av) <= hv) return null;

  const su = sweepSlab(au, bu - au, hu);
  if (!su) return null;
  const sv = sweepSlab(av, bv - av, hv);
  if (!sv) return null;

  const enter = Math.max(su[0], sv[0]);
  const exit = Math.min(su[1], sv[1]);
  if (enter > exit || enter > 1 || exit < 0) return null;
  return { t: Math.max(0, enter), axis: su[0] > sv[0] ? 'u' : 'v' };
}

/** First contact along a→b against a circle of radius R, or -1. */
function sweepCircle(cx, cz, R, ax, az, bx, bz) {
  const mx = ax - cx;
  const mz = az - cz;
  if (mx * mx + mz * mz <= R * R) return -1; // started inside
  const dx = bx - ax;
  const dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a < EPS) return -1;
  const b = 2 * (mx * dx + mz * dz);
  const c = mx * mx + mz * mz - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/**
 * Keep a kart out of the scenery.
 *
 * `out` is the position the kart wants to move to this step; `fromX`/`fromZ`
 * are where it started. Knowing the start matters for two reasons, and
 * skipping either of them lets karts end up on the wrong side of a wall:
 *
 *  - At full speed a kart covers more ground per step than a rail is thick,
 *    so it can pass clean through with no overlap left to detect. The sweep
 *    below catches the crossing and stops the kart at the surface.
 *  - When a kart is already overlapping, ejecting it along the shallowest
 *    axis pushes it out through the *far* face as soon as its centre passes
 *    the wall's midline. Pushing back toward the side it came from cannot.
 *
 * Mutates `out` = { x, z, vx, vz } and returns true when it moved the kart.
 */
export function resolveHorizontal(solids, out, radius, feetY, headY, fromX, fromZ) {
  const climbable = feetY + STEP_UP;
  const ax = fromX === undefined ? out.x : fromX;
  const az = fromZ === undefined ? out.z : fromZ;

  const wall = (s) => {
    if (s.t === 'ring') return !(s.y >= headY || s.y + s.h <= feetY);
    return s._top > climbable && s.y < headY;
  };

  // A ramp's low edge is its entrance, not a wall.
  const rampOpen = (s, u, v) => {
    const tEdge = (v + s.len * 0.5) / s.len;
    return s.y + s.rise * Math.max(0, tEdge) <= climbable;
  };

  // ── Sweep: stop at the first surface crossed on the way to `out` ──
  let firstT = 1;
  let firstNx = 0;
  let firstNz = 0;
  const movedX = out.x - ax;
  const movedZ = out.z - az;
  if (movedX * movedX + movedZ * movedZ > EPS) {
    for (const s of solids) {
      if (!wall(s)) continue;

      if (s.t === 'ring') continue; // concave; handled by push-out below
      if (s.t === 'cyl') {
        if (s.inner) continue; // concave band; push-out handles it
        const t = sweepCircle(s.x, s.z, s.r + radius, ax, az, out.x, out.z);
        if (t < 0 || t >= firstT) continue;
        const hx = ax + movedX * t - s.x;
        const hz = az + movedZ * t - s.z;
        const d = Math.hypot(hx, hz) || 1;
        firstT = t;
        firstNx = hx / d;
        firstNz = hz / d;
        continue;
      }

      const halfW = s.w * 0.5;
      const halfD = (s.t === 'ramp' ? s.len : s.d) * 0.5;
      const res = sweepRect(s, halfW, halfD, radius, ax, az, out.x, out.z);
      if (!res || res.t >= firstT) continue;
      if (s.t === 'ramp') {
        const [, v] = rotIn(s, ax + movedX * res.t - s.x, az + movedZ * res.t - s.z);
        if (rampOpen(s, 0, v)) continue;
      }
      const [u, v] = rotIn(s, ax + movedX * res.t - s.x, az + movedZ * res.t - s.z);
      const [nx, nz] = res.axis === 'u'
        ? rotOut(s, Math.sign(u || 1), 0)
        : rotOut(s, 0, Math.sign(v || 1));
      firstT = res.t;
      firstNx = nx;
      firstNz = nz;
    }
  }

  let hit = false;
  if (firstT < 1) {
    // Land just shy of the surface so the push-out pass has something to bite
    // on rather than sitting exactly on the boundary.
    const t = Math.max(0, firstT - 1e-3);
    out.x = ax + movedX * t;
    out.z = az + movedZ * t;

    // Spend what is left of the step sliding along the surface. Stopping at
    // the contact point instead would mean any kart brushing a wall at an
    // angle comes to a dead halt against it.
    const restX = movedX * (1 - t);
    const restZ = movedZ * (1 - t);
    const into = restX * firstNx + restZ * firstNz;
    out.x += restX - firstNx * into;
    out.z += restZ - firstNz * into;

    const vn = out.vx * firstNx + out.vz * firstNz;
    if (vn < 0) {
      out.vx -= vn * firstNx * 1.2;
      out.vz -= vn * firstNz * 1.2;
    }
    hit = true;
  }

  // ── Push-out: settle any remaining overlap, biased away from where we came
  // from. Repeated because freeing a kart from one solid can press it into
  // another that was already checked this pass.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;

    for (const s of solids) {
      if (!wall(s)) continue;

      if (s.t === 'ring') {
        const dx = out.x - s.x;
        const dz = out.z - s.z;
        const d = Math.hypot(dx, dz);
        const limit = s.r - radius;
        if (d <= limit || d < EPS) continue;
        const nx = dx / d;
        const nz = dz / d;
        out.x = s.x + nx * limit;
        out.z = s.z + nz * limit;
        const vn = out.vx * nx + out.vz * nz;
        if (vn > 0) {
          out.vx -= vn * nx * 1.2;
          out.vz -= vn * nz * 1.2;
        }
        moved = true;
        continue;
      }

      const dx = out.x - s.x;
      const dz = out.z - s.z;
      if (dx < s._minX - s.x - radius || dx > s._maxX - s.x + radius) continue;
      if (dz < s._minZ - s.z - radius || dz > s._maxZ - s.z + radius) continue;

      if (s.t === 'cyl') {
        const d = Math.hypot(dx, dz);
        let nx;
        let nz;
        if (d < EPS) { nx = 1; nz = 0; } else { nx = dx / d; nz = dz / d; }

        if (s.inner) {
          // Tube: blocked only while overlapping the wall band itself, and we
          // slide out whichever side is nearer.
          const outerLimit = s.r + radius;
          const innerLimit = s.inner - radius;
          if (d >= outerLimit || d <= innerLimit) continue;
          const target = d - innerLimit < outerLimit - d ? innerLimit : outerLimit;
          if (target <= 0) continue;
          out.x = s.x + nx * target;
          out.z = s.z + nz * target;
          const vn = out.vx * nx + out.vz * nz;
          const sign = target === outerLimit ? -1 : 1;
          if (vn * sign > 0) {
            out.vx -= vn * nx * 1.2;
            out.vz -= vn * nz * 1.2;
          }
          moved = true;
          continue;
        }

        const min = s.r + radius;
        if (d >= min) continue;
        out.x = s.x + nx * min;
        out.z = s.z + nz * min;
        const vn = out.vx * nx + out.vz * nz;
        if (vn < 0) {
          out.vx -= vn * nx * 1.2;
          out.vz -= vn * nz * 1.2;
        }
        moved = true;
        continue;
      }

      // box + ramp share an oriented-rectangle footprint
      const halfW = s.w * 0.5;
      const halfD = (s.t === 'ramp' ? s.len : s.d) * 0.5;
      const [u, v] = rotIn(s, dx, dz);
      const ou = halfW + radius - Math.abs(u);
      const ov = halfD + radius - Math.abs(v);
      if (ou <= 0 || ov <= 0) continue;

      if (s.t === 'ramp' && rampOpen(s, u, v)) continue;

      // Which face were we outside of when the step began? That is the face to
      // push back through, whatever the overlaps currently say.
      const [su, sv] = rotIn(s, ax - s.x, az - s.z);
      const wasOutU = Math.abs(su) > halfW + radius;
      const wasOutV = Math.abs(sv) > halfD + radius;

      let axis;
      if (wasOutU && !wasOutV) axis = 'u';
      else if (wasOutV && !wasOutU) axis = 'v';
      else axis = ou < ov ? 'u' : 'v'; // started inside, or outside on both

      let pu = 0;
      let pv = 0;
      if (axis === 'u') pu = Math.sign((wasOutU ? su : u) || 1) * ou;
      else pv = Math.sign((wasOutV ? sv : v) || 1) * ov;

      const [wx, wz] = rotOut(s, pu, pv);
      out.x += wx;
      out.z += wz;

      const len = Math.hypot(wx, wz) || 1;
      const nx = wx / len;
      const nz = wz / len;
      const vn = out.vx * nx + out.vz * nz;
      if (vn < 0) {
        out.vx -= vn * nx * 1.2;
        out.vz -= vn * nz * 1.2;
      }
      moved = true;
    }

    if (!moved) break;
    hit = true;
  }

  return hit;
}

/** Does a point (projectile, pickup ray) sit inside any solid? */
export function pointInSolid(solids, x, y, z) {
  for (const s of solids) {
    if (s.t === 'ring' || s.passThrough) continue;
    if (y < s.y || y > s._top) continue;
    const top = topAt(s, x, z);
    if (top !== null) return s;
  }
  return null;
}
