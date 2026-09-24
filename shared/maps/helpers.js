/**
 * Blueprint primitives. A map is plain data: the server feeds `solids` to the
 * physics step and the client builds meshes from the very same list, so a
 * collider can never disagree with what the player sees.
 *
 * `y` is always the BOTTOM of a shape. `mat` names a palette entry that the
 * client's MapBuilder resolves to a material.
 */

export function box(x, y, z, w, h, d, mat, extra = {}) {
  return { t: 'box', x, y, z, w, h, d, rotY: 0, mat, ...extra };
}

export function cyl(x, y, z, r, h, mat, extra = {}) {
  return { t: 'cyl', x, y, z, r, h, mat, ...extra };
}

/** Flat at `y` on the low edge, rising to `y + rise` along local +Z. */
export function ramp(x, y, z, w, len, rise, rotY, mat, extra = {}) {
  return { t: 'ramp', x, y, z, w, len, rise, rotY, mat, ...extra };
}

/** Hollow wall that keeps karts inside radius `r`. */
export function ring(x, y, z, r, h, mat, extra = {}) {
  return { t: 'ring', x, y, z, r, h, mat, ...extra };
}

/** Visual-only decoration — never touched by physics. */
export function decor(kind, x, y, z, opts = {}) {
  return { kind, x, y, z, ...opts };
}

/**
 * A square platform with ramps running up to it from the chosen sides.
 * Ramps are placed flush against the platform edge so there is no lip to catch on.
 */
export function platform(x, y, z, size, height, mat, sides = [], rampOpts = {}) {
  const out = [box(x, y, z, size, height, size, mat)];
  const top = y + height;
  const rampLen = rampOpts.len ?? Math.max(8, height * 4);
  const rampW = rampOpts.w ?? 7;
  const rampMat = rampOpts.mat ?? mat;
  const half = size / 2;

  // rotY orients the ramp so its high edge (local +Z) meets the platform.
  const dirs = {
    north: { dx: 0, dz: half + rampLen / 2, rotY: Math.PI },
    south: { dx: 0, dz: -(half + rampLen / 2), rotY: 0 },
    east: { dx: half + rampLen / 2, dz: 0, rotY: -Math.PI / 2 },
    west: { dx: -(half + rampLen / 2), dz: 0, rotY: Math.PI / 2 },
  };

  for (const side of sides) {
    const dir = dirs[side];
    if (!dir) continue;
    out.push(ramp(x + dir.dx, y, z + dir.dz, rampW, rampLen, top - y, dir.rotY, rampMat));
  }
  return out;
}

/** Evenly spaced points on a circle, each facing the centre. */
export function spawnRing(count, radius, y, phase = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    out.push({ x, y, z, yaw: Math.atan2(-x, -z) });
  }
  return out;
}

/** Points on a circle, used for pickup pads and props. */
export function circlePoints(count, radius, y, phase = 0, cx = 0, cz = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * radius, y, z: cz + Math.sin(a) * radius });
  }
  return out;
}

/**
 * Four walls enclosing a square arena plus 45° corner cuts, so karts skim the
 * corners instead of burying themselves in them.
 */
export function arenaWalls(half, height, thickness, mat) {
  const span = half * 2 + thickness;
  const out = [
    box(0, 0, -half - thickness / 2, span, height, thickness, mat),
    box(0, 0, half + thickness / 2, span, height, thickness, mat),
    box(-half - thickness / 2, 0, 0, thickness, height, span, mat),
    box(half + thickness / 2, 0, 0, thickness, height, span, mat),
  ];

  // A chord of length cut·√2 whose ends meet the straight walls at ±(half − cut).
  const cut = half * 0.3;
  const c = half - cut / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    out.push(box(sx * c, 0, sz * c, cut * Math.SQRT2, height, thickness, mat, {
      rotY: sx * sz > 0 ? Math.PI / 4 : -Math.PI / 4,
    }));
  }
  return out;
}
