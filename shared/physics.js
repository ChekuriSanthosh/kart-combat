/**
 * The one and only kart simulation. The server runs it authoritatively and the
 * client runs the exact same function to predict the local kart, so prediction
 * and authority agree instead of fighting each other every snapshot.
 *
 * Convention: `y` is the ground-contact height (the bottom of the wheels), and
 * yaw 0 faces +Z with forward = (sin yaw, 0, cos yaw).
 */

import { STEP_UP, sampleGround, resolveHorizontal } from './collision.js';

/**
 * Handling is tuned for arcade feel rather than realism: karts reach top speed
 * in well under a second, corner tightly enough to fight in a small arena, and
 * stop sliding the moment you stop asking them to.
 */
export const KART = Object.freeze({
  radius: 0.85,
  height: 1.5,

  maxSpeed: 26,
  boostSpeed: 38,
  reverseMax: 11,
  accel: 30,
  brake: 46,
  reverseAccel: 18,

  /** Exponential decay rates, per second. */
  coastDrag: 1.15,
  airDrag: 0.22,
  gripLateral: 9.5,
  driftGrip: 2.6,

  /**
   * Turn rate in rad/s. 2.4 gives a ~11 m circle at full speed: tight enough
   * to fight in, wide enough to hold a line. Higher values than this read as
   * twitchy — the kart snaps round faster than you can correct.
   */
  turnRate: 2.4,
  /**
   * How quickly steering ramps in with speed. Turning authority reaches full
   * strength at this speed, so a crawling kart cannot pirouette on the spot.
   */
  turnRampSpeed: 9,
  driftTurnMul: 1.5,
  /**
   * Yaw rate eases toward its target rather than snapping to it. This is the
   * single biggest contributor to steering feeling smooth instead of jerky.
   */
  turnResponse: 7.5,
  airTurnMul: 0.4,

  gravity: 33,
  maxFallSpeed: 55,

  /** Drift must be held this long to earn a boost. */
  driftMinTime: 0.38,
  driftBoostTime: 0.9,
  driftBoostMaxTime: 1.5,

  /** Upward speed carried off the end of a ramp, capped so nobody moons. */
  maxLaunchSpeed: 13,

  /**
   * How far the wheels reach down to hold a surface that drops away beneath
   * them. Sized to swallow the tallest step a kart can drive down without it
   * counting as a fall — the Beyblade terraces are 0.42 m — while staying well
   * under the height of a real ledge, so driving off a deck or into the void
   * is still a fall.
   */
  stickDown: 0.6,

  bumpRestitution: 0.55,
});

export function createKartState(spawn = {}) {
  return {
    x: spawn.x ?? 0,
    y: spawn.y ?? 0,
    z: spawn.z ?? 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: spawn.yaw ?? 0,
    yawRate: 0,
    speed: 0,
    grounded: true,
    drifting: false,
    driftTime: 0,
    driftDir: 0,
    boostTime: 0,
    stunTime: 0,
    climbRate: 0,
  };
}

export function createInput() {
  return { forward: false, back: false, left: false, right: false, drift: false, fire: false };
}

const decay = (rate, dt) => Math.exp(-rate * dt);

/**
 * Advance one kart by a fixed timestep.
 *
 * @param {object} k    kart state, mutated in place
 * @param {object} inp  { forward, back, left, right, drift }
 * @param {object} ctx  { solids, floorY, gravityScale?, externalAx?, externalAz?,
 *                        externalYawRate? }
 * @param {number} dt
 */
export function stepKart(k, inp, ctx, dt) {
  const solids = ctx.solids || [];
  const floorY = ctx.floorY ?? 0;
  const stunned = k.stunTime > 0;

  if (k.boostTime > 0) k.boostTime = Math.max(0, k.boostTime - dt);
  if (k.stunTime > 0) k.stunTime = Math.max(0, k.stunTime - dt);

  const fwdX = Math.sin(k.yaw);
  const fwdZ = Math.cos(k.yaw);
  // Right-hand vector so that positive steer input turns left.
  const rightX = fwdZ;
  const rightZ = -fwdX;

  const along = k.vx * fwdX + k.vz * fwdZ;
  const speedAbs = Math.abs(along);

  // ── Drift state ──────────────────────────────────────────────────────
  let steer = 0;
  if (!stunned) {
    if (inp.left) steer += 1;
    if (inp.right) steer -= 1;
  }

  const wantDrift =
    !stunned && !!inp.drift && steer !== 0 && k.grounded && speedAbs > 7;

  if (wantDrift && !k.drifting) k.driftDir = steer;
  if (k.drifting && !wantDrift) {
    if (k.driftTime >= KART.driftMinTime) {
      const charge = Math.min(1, k.driftTime / KART.driftBoostMaxTime);
      k.boostTime = Math.max(k.boostTime, KART.driftBoostTime * (0.55 + 0.45 * charge));
    }
    k.driftTime = 0;
    k.driftDir = 0;
  }
  k.drifting = wantDrift;
  if (wantDrift) k.driftTime += dt;

  // ── Steering ─────────────────────────────────────────────────────────
  // Turning authority ramps in smoothly with speed. The curve is eased rather
  // than linear so there is no sudden jump in responsiveness as you pull away,
  // which is what made slow-speed steering feel uncontrollable.
  const speedRamp = Math.min(1, speedAbs / KART.turnRampSpeed);
  const speedFactor = speedRamp * speedRamp * (3 - 2 * speedRamp); // smoothstep
  const reverseSign = along < -0.5 ? -1 : 1;
  const turnMul =
    (k.drifting ? KART.driftTurnMul : 1) * (k.grounded ? 1 : KART.airTurnMul);
  const targetYawRate =
    steer * reverseSign * KART.turnRate * speedFactor * turnMul;
  k.yawRate += (targetYawRate - k.yawRate) * (1 - decay(KART.turnResponse, dt));
  k.yaw += k.yawRate * dt;
  // A rotating floor carries the kart's heading round with it. This is added
  // straight to yaw rather than to yawRate: the kart is being turned *by the
  // platform*, not steering, so it should not bank into it and a remote
  // client should not read it back as steering input.
  if (ctx.externalYawRate) k.yaw += ctx.externalYawRate * dt;
  if (k.yaw > Math.PI) k.yaw -= Math.PI * 2;
  else if (k.yaw < -Math.PI) k.yaw += Math.PI * 2;

  // Heading changed, so rebuild the basis before applying forces.
  const fX = Math.sin(k.yaw);
  const fZ = Math.cos(k.yaw);
  const rX = fZ;
  const rZ = -fX;

  // ── Throttle ─────────────────────────────────────────────────────────
  const boosting = k.boostTime > 0;
  const topSpeed = boosting ? KART.boostSpeed : KART.maxSpeed;
  const accelMul = (boosting ? 1.6 : 1) * (k.grounded ? 1 : 0.25);

  if (!stunned) {
    if (inp.forward) {
      k.vx += fX * KART.accel * accelMul * dt;
      k.vz += fZ * KART.accel * accelMul * dt;
    } else if (inp.back) {
      const cur = k.vx * fX + k.vz * fZ;
      const a = cur > 1 ? KART.brake : KART.reverseAccel;
      k.vx -= fX * a * accelMul * dt;
      k.vz -= fZ * a * accelMul * dt;
    }
  }

  if (ctx.externalAx) k.vx += ctx.externalAx * dt;
  if (ctx.externalAz) k.vz += ctx.externalAz * dt;

  // ── Lateral grip — this is what makes a kart a kart and not a puck ────
  if (k.grounded) {
    const lat = k.vx * rX + k.vz * rZ;
    const grip = k.drifting ? KART.driftGrip : KART.gripLateral;
    const kept = lat * decay(grip, dt);
    k.vx += rX * (kept - lat);
    k.vz += rZ * (kept - lat);
  }

  // ── Drag ─────────────────────────────────────────────────────────────
  const coasting = stunned || (!inp.forward && !inp.back);
  const dragRate = !k.grounded
    ? KART.airDrag
    : coasting
      ? KART.coastDrag
      : KART.airDrag;
  const d = decay(dragRate, dt);
  k.vx *= d;
  k.vz *= d;

  // ── Speed clamp along the heading ────────────────────────────────────
  let fwdSpeed = k.vx * fX + k.vz * fZ;
  if (fwdSpeed > topSpeed) {
    const excess = fwdSpeed - topSpeed;
    k.vx -= fX * excess;
    k.vz -= fZ * excess;
    fwdSpeed = topSpeed;
  } else if (fwdSpeed < -KART.reverseMax) {
    const excess = fwdSpeed + KART.reverseMax;
    k.vx -= fX * excess;
    k.vz -= fZ * excess;
    fwdSpeed = -KART.reverseMax;
  }
  k.speed = fwdSpeed;

  // ── Horizontal integration + wall resolution ─────────────────────────
  const feetY = k.y;
  const headY = k.y + KART.height;
  const move = {
    x: k.x + k.vx * dt,
    z: k.z + k.vz * dt,
    vx: k.vx,
    vz: k.vz,
  };
  resolveHorizontal(solids, move, KART.radius, feetY, headY, k.x, k.z);
  k.x = move.x;
  k.z = move.z;
  k.vx = move.vx;
  k.vz = move.vz;

  // ── Vertical: gravity, landing and ramp launches ─────────────────────
  k.vy -= KART.gravity * (ctx.gravityScale ?? 1) * dt;
  if (k.vy < -KART.maxFallSpeed) k.vy = -KART.maxFallSpeed;

  const ground = sampleGround(solids, k.x, k.z, k.y, floorY);
  const nextY = k.y + k.vy * dt;

  if (nextY <= ground) {
    // Track how fast the surface is climbing so leaving a ramp throws us.
    const rise = ground - k.y;
    k.climbRate = rise > 0 ? Math.min(rise / dt, KART.maxLaunchSpeed) : 0;
    k.y = ground;
    k.vy = 0;
    k.grounded = true;
  } else if (
    k.grounded
    && k.vy <= 0
    && k.climbRate <= 0.5
    && k.y - ground <= KART.stickDown
  ) {
    // ── Surface stick ──
    // A small drop under a kart that is already on the ground is a dip in the
    // floor, not a cliff, so the wheels reach down and hold it. Without this a
    // kart crossing any stepped surface — the Beyblade terraces most of all,
    // where it was airborne 40% of the time — leaves the ground every few
    // frames and falls back onto it, which both looks like skipping and makes
    // anything gated on `grounded` flicker at the same rate.
    //
    // Deliberately does not apply to ramp lips (`climbRate`), so launches
    // still throw the kart, nor to anything already rising.
    k.climbRate = 0;
    k.y = ground;
    k.vy = 0;
    k.grounded = true;
  } else {
    if (k.grounded && k.climbRate > 0.5) {
      // Just drove off the lip of a ramp — convert the climb into a hop.
      k.vy = k.climbRate;
      k.climbRate = 0;
    }
    k.y = nextY;
    k.grounded = false;
  }

  return k;
}

/** Elastic-ish kart-on-kart shove, Smash-Karts style. */
export function resolveKartPair(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const minDist = KART.radius * 2;
  let d = Math.hypot(dx, dz);
  if (d >= minDist) return false;
  if (Math.abs(a.y - b.y) > KART.height) return false;

  let nx;
  let nz;
  if (d < 1e-6) {
    nx = 1;
    nz = 0;
    d = 1e-6;
  } else {
    nx = dx / d;
    nz = dz / d;
  }

  const overlap = (minDist - d) * 0.5;
  a.x -= nx * overlap;
  a.z -= nz * overlap;
  b.x += nx * overlap;
  b.z += nz * overlap;

  const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (rel >= 0) return true;
  const j = -(1 + KART.bumpRestitution) * rel * 0.5;
  a.vx -= nx * j;
  a.vz -= nz * j;
  b.vx += nx * j;
  b.vz += nz * j;
  return true;
}

/** Knockback from explosions and impacts. */
export function applyImpulse(k, ix, iy, iz) {
  k.vx += ix;
  k.vz += iz;
  if (iy) {
    k.vy += iy;
    k.grounded = false;
  }
}
