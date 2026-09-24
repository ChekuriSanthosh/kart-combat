/**
 * Client-side prediction for the local kart.
 *
 * The client steps the *same* physics module as the server at the same fixed
 * rate, keeps every command it has sent, and when a snapshot arrives it rewinds
 * to the server's state and replays the commands the server has not consumed
 * yet. Any leftover difference is absorbed by a render offset that decays over
 * a few frames, so corrections are invisible instead of a visible snap.
 */

import { createKartState, createInput, stepKart } from '/shared/physics.js';
import { applyEnvironment } from '/shared/maps/index.js';
import { SIM_DT, packInput, unpackInput } from '/shared/constants.js';

const MAX_PENDING = 180; // three seconds of commands

export function createPredictor(map, spawn) {
  const state = createKartState(spawn);
  const scratch = createInput();
  const pending = [];
  let seq = 0;
  let accumulator = 0;

  // Smoothed-out correction, applied only to what we draw.
  const error = { x: 0, y: 0, z: 0, yaw: 0 };

  function integrate(s, input, dt) {
    const force = applyEnvironment(map, s);
    stepKart(s, input, {
      solids: map.solids,
      floorY: map.floorY,
      externalAx: force.ax,
      externalAz: force.az,
      externalYawRate: force.yawRate,
    }, dt);
  }

  return {
    state,

    /**
     * Run zero or more fixed simulation steps for the frame and return the
     * commands that need sending.
     */
    advance(frameDt, input) {
      accumulator = Math.min(accumulator + frameDt, SIM_DT * 5);
      const commands = [];
      while (accumulator >= SIM_DT) {
        accumulator -= SIM_DT;
        seq += 1;
        const bits = packInput(input);
        const cmd = { seq, bits };
        pending.push(cmd);
        if (pending.length > MAX_PENDING) pending.shift();
        unpackInput(bits, scratch);
        integrate(state, scratch, SIM_DT);
        commands.push(cmd);
      }

      // Bleed the visual correction away over roughly a fifth of a second.
      const decay = Math.exp(-9 * frameDt);
      error.x *= decay;
      error.y *= decay;
      error.z *= decay;
      error.yaw *= decay;

      return commands;
    },

    /**
     * Rewind to the authoritative state and replay everything newer than the
     * command the server has acknowledged.
     */
    reconcile(server) {
      // Where we were *drawing* the kart, not where we had predicted it. The
      // difference is the correction still bleeding off from the last
      // snapshot, and it has to be carried through this one — see below.
      const before = {
        x: state.x + error.x,
        y: state.y + error.y,
        z: state.z + error.z,
        yaw: state.yaw + error.yaw,
      };

      state.x = server.x;
      state.y = server.y;
      state.z = server.z;
      state.yaw = server.a;
      state.vx = server.vx;
      state.vy = server.vy;
      state.vz = server.vz;
      state.yawRate = server.yr;
      state.speed = server.sp;
      state.grounded = !!server.g;
      state.drifting = !!server.dr;
      state.boostTime = server.bt;
      state.stunTime = server.st;

      while (pending.length && pending[0].seq <= server.q) pending.shift();
      for (const cmd of pending) {
        unpackInput(cmd.bits, scratch);
        integrate(state, scratch, SIM_DT);
      }

      // Keep drawing where we were, then glide onto the corrected path. The
      // offset is measured from the *drawn* pose rather than the predicted one
      // so the picture never steps. Measuring from the prediction throws away
      // whatever correction had not decayed yet, which puts a small jump in
      // the render every time a snapshot lands — at 20 Hz that reads as a
      // constant shimmer across the whole screen.
      const dx = before.x - state.x;
      const dz = before.z - state.z;
      const dy = before.y - state.y;
      // A correction this large means a teleport (respawn, void, knockback);
      // snapping is the honest thing to do rather than sliding across the map.
      if (Math.hypot(dx, dy, dz) > 8) {
        error.x = 0; error.y = 0; error.z = 0; error.yaw = 0;
      } else {
        error.x = dx;
        error.y = dy;
        error.z = dz;
        let dyaw = before.yaw - state.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        error.yaw = dyaw;
      }
    },

    /** Hard reset, used on respawn and when changing map. */
    teleport(spawnPoint) {
      Object.assign(state, createKartState(spawnPoint));
      pending.length = 0;
      error.x = 0; error.y = 0; error.z = 0; error.yaw = 0;
    },

    /** Pose to draw this frame: prediction plus the shrinking correction. */
    view() {
      return {
        x: state.x + error.x,
        y: state.y + error.y,
        z: state.z + error.z,
        yaw: state.yaw + error.yaw,
        speed: state.speed,
        yawRate: state.yawRate,
        drifting: state.drifting,
        grounded: state.grounded,
        boost: state.boostTime > 0,
        stunned: state.stunTime > 0,
      };
    },

    pendingCount() { return pending.length; },
  };
}
