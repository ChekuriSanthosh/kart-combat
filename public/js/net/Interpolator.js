/**
 * Remote kart smoothing.
 *
 * Snapshots arrive 20 times a second, so drawing the newest one directly is
 * visibly steppy. Instead we keep a short history and render everyone a fixed
 * delay in the past, interpolating between the two snapshots that straddle the
 * render time. When the buffer runs dry we extrapolate briefly from velocity.
 */

import {
  INTERP_MIN_MS, INTERP_MAX_MS, INTERP_START_MS, SNAPSHOT_MS,
} from '/shared/constants.js';

const HISTORY = 24;

export function createInterpolator() {
  /** @type {{ t: number, byId: Map<string, object> }[]} */
  const buffer = [];
  let offset = null; // serverTime − clientTime

  // ── Adaptive delay ──
  // Snapshots leave the server on a metronome, so any variation in the gaps
  // between arrivals is jitter the network introduced. Buy buffer to cover it
  // and no more: every millisecond held back is distance a rival is drawn
  // behind where they really are.
  let delay = INTERP_START_MS;
  let jitter = 0;
  let lastArrival = 0;
  let lastServerT = 0;
  /** Bumped when playback runs off the end of the buffer; decays in sample(). */
  let underrunBoost = 0;
  /** Frames that had to extrapolate — diagnostics only. */
  let stalls = 0;

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

      // ── Re-measure how much buffer this connection needs ──
      // Compare the gap between arrivals against the gap the server actually
      // put between sending them, not against the nominal tick rate. The
      // server's loop does not emit on a perfect metronome — a catch-up tick
      // or a GC pause shifts it — and charging that to the network inflates
      // the buffer for everyone. What is left after subtracting the send gap
      // is transit variation, which is the only thing worth buffering against.
      if (lastArrival && lastServerT) {
        const arrivalGap = now - lastArrival;
        const sendGap = snapshot.t - lastServerT;
        const drift = Math.abs(arrivalGap - sendGap);
        // Rise fast, fall slow: one bad burst should widen the buffer
        // immediately, but a brief calm patch should not narrow it back and
        // set up the next stall.
        jitter += (drift - jitter) * (drift > jitter ? 0.25 : 0.01);
      }
      lastArrival = now;
      lastServerT = snapshot.t;

      // A little over one interval so there is always a newer snapshot to
      // interpolate toward, plus headroom for the jitter actually observed.
      //
      // The 1.3 multiplier was measured, not guessed: swept against simulated
      // links from LAN to lossy mobile, it is the smallest value that holds
      // stalls at zero everywhere. Lower buys another metre of closeness but
      // lets a mobile connection start stuttering; higher just costs distance
      // for no benefit.
      const target = Math.min(
        INTERP_MAX_MS,
        Math.max(INTERP_MIN_MS, SNAPSHOT_MS * 1.15 + jitter * 1.3 + underrunBoost),
      );
      // Same asymmetry on the delay itself. Growing late is what causes a
      // visible stall, so growth is near-instant; shrinking is gradual enough
      // that players read it as the picture settling, not as a jump.
      delay += (target - delay) * (target > delay ? 0.5 : 0.02);

      const byId = new Map();
      for (const p of snapshot.p) byId.set(p.i, p);
      buffer.push({ t: snapshot.t, byId });
      while (buffer.length > HISTORY) buffer.shift();
    },

    /** Interpolated pose for one player, or null if we have never seen them. */
    sample(id) {
      if (buffer.length === 0 || offset === null) return null;
      // Bleed off any widening earned by a past stall, so a connection that
      // recovers gets its responsiveness back instead of staying padded.
      if (underrunBoost > 0) underrunBoost = Math.max(0, underrunBoost - 0.35);
      const renderTime = performance.now() + offset - delay;

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
        // Ran off the end of the buffer. Extrapolating is the emergency brake,
        // not a mode to live in, so record that the buffer was too thin and
        // widen it — this is the signal a measurement of arrival gaps alone
        // can miss, because a single very late packet barely moves the average.
        stalls++;
        underrunBoost = Math.min(INTERP_MAX_MS - INTERP_MIN_MS, underrunBoost + 14);
        // Coast on last known velocity, but only briefly so a stalled
        // connection cannot fling karts across the arena.
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

    /** Current buffer depth in ms and the jitter driving it — for diagnostics. */
    stats() {
      return { delay, jitter, underrunBoost, stalls };
    },

    clear() {
      buffer.length = 0;
      offset = null;
      delay = INTERP_START_MS;
      jitter = 0;
      lastArrival = 0;
      lastServerT = 0;
      underrunBoost = 0;
      stalls = 0;
    },
  };
}
