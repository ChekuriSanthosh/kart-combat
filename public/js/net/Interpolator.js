/**
 * Remote kart smoothing.
 *
 * Snapshots arrive 20 times a second, so drawing the newest one directly is
 * visibly steppy. Instead we keep a short history and render everyone a fixed
 * delay in the past, interpolating between the two snapshots that straddle the
 * render time. When the buffer runs dry we extrapolate briefly from velocity.
 */

import { INTERP_DELAY_MS } from '/shared/constants.js';

const HISTORY = 24;

export function createInterpolator() {
  /** @type {{ t: number, byId: Map<string, object> }[]} */
  const buffer = [];
  let offset = null; // serverTime − clientTime

  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  return {
    push(snapshot) {
      const now = performance.now();
      // Track the clock difference with a slow follow so one late packet does
      // not yank every remote kart.
      const sample = snapshot.t - now;
      offset = offset === null ? sample : offset + (sample - offset) * 0.05;

      const byId = new Map();
      for (const p of snapshot.p) byId.set(p.i, p);
      buffer.push({ t: snapshot.t, byId });
      while (buffer.length > HISTORY) buffer.shift();
    },

    /** Interpolated pose for one player, or null if we have never seen them. */
    sample(id) {
      if (buffer.length === 0 || offset === null) return null;
      const renderTime = performance.now() + offset - INTERP_DELAY_MS;

      let older = null;
      let newer = null;
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i].t <= renderTime) { older = buffer[i]; newer = buffer[i + 1] || null; break; }
      }

      if (!older) {
        // Render time is behind everything we hold: use the oldest frame.
        const first = buffer[0].byId.get(id);
        return first ? { ...first, x: first.x, y: first.y, z: first.z, yaw: first.a } : null;
      }

      const a = older.byId.get(id);
      if (!a) return null;

      if (!newer) {
        // Ran off the end of the buffer — coast on last known velocity, but
        // only for a short while so a stalled connection cannot fling karts.
        const ahead = Math.min(0.12, (renderTime - older.t) / 1000);
        return {
          ...a,
          x: a.x + a.vx * ahead,
          y: a.y + a.vy * ahead,
          z: a.z + a.vz * ahead,
          yaw: a.a + a.yr * ahead,
        };
      }

      const b = newer.byId.get(id);
      if (!b) return { ...a, x: a.x, y: a.y, z: a.z, yaw: a.a };

      const span = newer.t - older.t;
      const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - older.t) / span)) : 0;
      return {
        ...b,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        yaw: lerpAngle(a.a, b.a, t),
        sp: a.sp + (b.sp - a.sp) * t,
        yr: a.yr + (b.yr - a.yr) * t,
      };
    },

    latest() {
      return buffer.length ? buffer[buffer.length - 1] : null;
    },

    clear() {
      buffer.length = 0;
      offset = null;
    },
  };
}
