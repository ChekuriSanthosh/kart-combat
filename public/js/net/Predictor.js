/**
 * Client-side prediction for the local kart.
 *
 * The client steps the *same* physics module as the server at the same fixed
 * rate, keeps every command it has sent, and when a snapshot arrives it rewinds
 * to the server's state and replays the commands the server has not consumed
 * yet. Any leftover difference is absorbed by a render offset that decays over
 * a few frames, so corrections are invisible instead of a visible snap.
 *
 * What is drawn is interpolated between the last two physics steps, by how far
 * the frame clock has got towards the next one. Drawing the latest step as-is
 * made the kart lurch: frames rarely line up exactly with 60 Hz steps, so some
 * run no step (the kart stands still for a frame) and the next runs two (it
 * jumps double the distance). On a 120 Hz screen that was every other frame.
 * This is the "fix your timestep" interpolation, at the cost of drawing the
 * kart at most one 16 ms step behind the simulation.
 */

import { createKartState, createInput, stepKart } from '/shared/physics.js';
import { applyEnvironment } from '/shared/maps/index.js';
import { SIM_DT, packInput, unpackInput } from '/shared/constants.js';

const MAX_PENDING = 180; // three seconds of commands

/** Shortest signed angle from a to b. */
function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createPredictor(map, spawn) {
  const state = createKartState(spawn);
  const scratch = createInput();
  const pending = [];
  let seq = 0;
  let accumulator = 0;

  // The pose before the most recent step, for interpolating what we draw.
  const prev = { x: state.x, y: state.y, z: state.z, yaw: state.yaw };

  // Where each command left the kart, by seq. When a snapshot acknowledges
  // everything (usual on a fast connection) there is nothing to replay, and the
  // pose one step before the ack is needed to keep blending from where the
  // screen actually is; without it every snapshot jumped the blend forward and
  // the decaying correction turned that into a 20 Hz shudder.
  const history = new Map();
  function recordPose(id) {
    history.set(id, { x: state.x, y: state.y, z: state.z, yaw: state.yaw });
    if (history.size > MAX_PENDING + 8) history.delete(history.keys().next().value);
  }

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

  function rememberPose() {
    prev.x = state.x;
    prev.y = state.y;
    prev.z = state.z;
    prev.yaw = state.yaw;
  }

  /** The pose between the last two steps, without the correction offset. */
  function blended() {
    const a = accumulator / SIM_DT;
    return {
      x: prev.x + (state.x - prev.x) * a,
      y: prev.y + (state.y - prev.y) * a,
      z: prev.z + (state.z - prev.z) * a,
      yaw: prev.yaw + angleDelta(prev.yaw, state.yaw) * a,
    };
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
        rememberPose();
        integrate(state, scratch, SIM_DT);
        recordPose(seq);
        commands.push(cmd);
      }

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
      // Exactly what is on screen right now, so the correction starts from it.
      const shown = blended();
      const before = {
        x: shown.x + error.x,
        y: shown.y + error.y,
        z: shown.z + error.z,
        yaw: shown.yaw + error.yaw,
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
      if (pending.length) {
        for (const cmd of pending) {
          unpackInput(cmd.bits, scratch);
          rememberPose();
          integrate(state, scratch, SIM_DT);
          recordPose(cmd.seq);
        }
      } else {
        // Nothing to replay: the server's pose is the newest step. The one
        // before it is what we predicted for it, moved by the same correction
        // the server just made to the acknowledged step.
        const atAck = history.get(server.q);
        const beforeAck = history.get(server.q - 1);
        if (atAck && beforeAck) {
          prev.x = beforeAck.x + (state.x - atAck.x);
          prev.y = beforeAck.y + (state.y - atAck.y);
          prev.z = beforeAck.z + (state.z - atAck.z);
          prev.yaw = beforeAck.yaw + angleDelta(atAck.yaw, state.yaw);
        } else {
          rememberPose();
        }
      }
      for (const id of history.keys()) {
        if (id >= server.q - 1) break;
        history.delete(id);
      }

      const after = blended();
      const dx = before.x - after.x;
      const dz = before.z - after.z;
      const dy = before.y - after.y;
      if (Math.hypot(dx, dy, dz) > 8) {
        error.x = 0; error.y = 0; error.z = 0; error.yaw = 0;
      } else {
        error.x = dx;
        error.y = dy;
        error.z = dz;
        error.yaw = angleDelta(after.yaw, before.yaw);
      }
    },

    /** Hard reset, used on respawn and when changing map. */
    teleport(spawnPoint) {
      Object.assign(state, createKartState(spawnPoint));
      rememberPose();
      pending.length = 0;
      history.clear();
      error.x = 0; error.y = 0; error.z = 0; error.yaw = 0;
    },

    /** Pose to draw this frame: the blended prediction plus the shrinking correction. */
    view() {
      const b = blended();
      return {
        x: b.x + error.x,
        y: b.y + error.y,
        z: b.z + error.z,
        yaw: b.yaw + error.yaw,
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
