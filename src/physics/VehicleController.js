/**
 * Arcade vehicle controller. Pass global CDN THREE into the factory.
 * Do NOT import from 'three'.
 */

const DEFAULTS = Object.freeze({
  // Match client KartController / closer to server PHYS (maxSpeed 40, accel 28)
  maxSpeed: 44,
  reverseMax: 14,
  accel: 36,
  brake: 40,
  reverseAccel: 18,
  steerAngle: 0.62,
  steerResponse: 10,
  driftTurnMul: 1.55,
  driftLateralGrip: 0.55,
  gripLateral: 0.88,
  linearDrag: 0.985,
  angularDrag: 0.88,
  gravity: 55,
  rideHeight: 0.35,
  driftMinTime: 0.35,
  driftBoostImpulse: 18,
  driftBoostMaxCharge: 1.4,
  camDistance: 9,
  camHeight: 4.2,
  camLookAhead: 4.5,
  camLerp: 7,
});

/**
 * @param {typeof globalThis.THREE} THREE
 * @param {Partial<typeof DEFAULTS>} [opts]
 */
export function createVehicleController(THREE, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  const keys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    drift: false,
  };

  const state = {
    position: new THREE.Vector3(0, cfg.rideHeight, 0),
    velocity: new THREE.Vector3(),
    yaw: 0,
    yawRate: 0,
    speed: 0,
    drifting: false,
    driftTime: 0,
    grounded: true,
  };

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let wasDrifting = false;

  function bindKeys(target = window) {
    const down = (e) => setKey(e.code, true, e);
    const up = (e) => setKey(e.code, false, e);
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
    };
  }

  function setKey(code, pressed, e) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = pressed;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.back = pressed;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = pressed;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.right = pressed;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.drift = pressed;
        break;
      default:
        return;
    }
    if (pressed && e && (code.startsWith('Arrow') || code === 'Space')) e.preventDefault();
  }

  function setInput(next = {}) {
    if ('forward' in next) keys.forward = !!next.forward;
    if ('back' in next) keys.back = !!next.back;
    if ('left' in next) keys.left = !!next.left;
    if ('right' in next) keys.right = !!next.right;
    if ('drift' in next) keys.drift = !!next.drift;
  }

  function statusMods(statusEffects = []) {
    let speedMul = 1;
    let steerMul = 1;
    let accelMul = 1;
    let locked = false;
    for (const fx of statusEffects) {
      if (!fx || fx.remaining <= 0) continue;
      switch (fx.type) {
        case 'boost':
          speedMul *= fx.magnitude ?? 1.4;
          accelMul *= fx.magnitude ?? 1.4;
          break;
        case 'slow':
        case 'ink':
          speedMul *= fx.magnitude ?? 0.45;
          break;
        case 'spin':
        case 'stun':
        case 'frozen':
        case 'freeze':
        case 'iceBlock':
          locked = true;
          break;
        case 'ice':
          steerMul *= fx.magnitude ?? 0.5;
          break;
        default:
          break;
      }
    }
    return { speedMul, steerMul, accelMul, locked };
  }

  /**
   * @param {number} dt
   * @param {{ statusEffects?: object[], groundY?: number, colliders?: object[] }} [world]
   * @returns {{ state: object, exitBoosts: object[] }}
   */
  function update(dt, world = {}) {
    const { statusEffects = [], groundY = 0, colliders } = world;
    const mods = statusMods(statusEffects);

    forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    right.set(forward.z, 0, -forward.x);

    const speedAbs = Math.abs(state.speed);
    const wantDrift =
      !mods.locked &&
      keys.drift &&
      (keys.left || keys.right) &&
      speedAbs > 8 &&
      state.grounded;

    const exitBoosts = [];
    if (wasDrifting && !wantDrift && state.driftTime >= cfg.driftMinTime) {
      const charge =
        Math.min(state.driftTime, cfg.driftBoostMaxCharge) / cfg.driftBoostMaxCharge;
      const impulse = cfg.driftBoostImpulse * (0.45 + 0.55 * charge);
      state.velocity.addScaledVector(forward, impulse);
      exitBoosts.push({
        type: 'boost',
        remaining: 0.35 + 0.45 * charge,
        magnitude: 1.15 + 0.25 * charge,
      });
    }
    state.drifting = wantDrift;
    state.driftTime = wantDrift ? state.driftTime + dt : 0;
    wasDrifting = wantDrift;

    if (!mods.locked) {
      let steerInput = 0;
      if (keys.left) steerInput += 1;
      if (keys.right) steerInput -= 1;
      const speedFactor = THREE.MathUtils.clamp(speedAbs / cfg.maxSpeed, 0.12, 1);
      const turnMul = wantDrift ? cfg.driftTurnMul : 1;
      const desired =
        steerInput * cfg.steerAngle * speedFactor * turnMul * mods.steerMul * cfg.steerResponse;
      state.yawRate = THREE.MathUtils.lerp(
        state.yawRate,
        desired,
        1 - Math.exp(-cfg.steerResponse * dt),
      );
      state.yaw += state.yawRate * dt;
    } else {
      state.yawRate *= Math.pow(cfg.angularDrag, dt * 60);
    }

    forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));

    if (!mods.locked) {
      const along = state.velocity.dot(forward);
      if (keys.forward) {
        state.velocity.addScaledVector(forward, cfg.accel * mods.accelMul * dt);
      } else if (keys.back) {
        if (along > 1) state.velocity.addScaledVector(forward, -cfg.brake * dt);
        else state.velocity.addScaledVector(forward, -cfg.reverseAccel * dt);
      }
    }

    const lat = state.velocity.dot(right);
    const grip = wantDrift ? cfg.driftLateralGrip : cfg.gripLateral;
    state.velocity.addScaledVector(right, -lat * (1 - Math.pow(1 - grip, dt * 60)));
    state.velocity.x *= Math.pow(cfg.linearDrag, dt * 60);
    state.velocity.z *= Math.pow(cfg.linearDrag, dt * 60);

    const alongAfter = state.velocity.dot(forward);
    const maxFwd = cfg.maxSpeed * mods.speedMul;
    if (alongAfter > maxFwd) state.velocity.addScaledVector(forward, maxFwd - alongAfter);
    if (alongAfter < -cfg.reverseMax) {
      state.velocity.addScaledVector(forward, -cfg.reverseMax - alongAfter);
    }

    state.velocity.y -= cfg.gravity * dt;
    resolveColliders(state, colliders);

    state.position.addScaledVector(state.velocity, dt);
    const floor = groundY + cfg.rideHeight;
    if (state.position.y <= floor) {
      state.position.y = floor;
      if (state.velocity.y < 0) state.velocity.y = 0;
      state.grounded = true;
    } else {
      state.grounded = false;
    }

    state.speed = state.velocity.dot(forward);
    return { state, exitBoosts };
  }

  function syncMesh(mesh) {
    if (!mesh) return;
    mesh.position.copy(state.position);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = state.yaw;
    mesh.rotation.z = THREE.MathUtils.clamp(-state.yawRate * 0.04, -0.35, 0.35);
    mesh.rotation.x = THREE.MathUtils.clamp(-state.speed * 0.002, -0.12, 0.08);
  }

  function updateCamera(camera, dt) {
    if (!camera) return;
    forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    camPos
      .copy(state.position)
      .addScaledVector(forward, -cfg.camDistance)
      .add(tmp.set(0, cfg.camHeight, 0));
    lookAt
      .copy(state.position)
      .addScaledVector(forward, cfg.camLookAhead)
      .add(tmp.set(0, 1.15, 0));
    const a = 1 - Math.exp(-cfg.camLerp * dt);
    camera.position.lerp(camPos, a);
    camera.lookAt(lookAt);
  }

  function reset(x = 0, y = cfg.rideHeight, z = 0, yaw = 0) {
    state.position.set(x, y, z);
    state.velocity.set(0, 0, 0);
    state.yaw = yaw;
    state.yawRate = 0;
    state.speed = 0;
    state.drifting = false;
    state.driftTime = 0;
    wasDrifting = false;
  }

  function getSnapshot() {
    return {
      x: state.position.x,
      y: state.position.y,
      z: state.position.z,
      yaw: state.yaw,
      speed: state.speed,
      drifting: state.drifting,
      vx: state.velocity.x,
      vy: state.velocity.y,
      vz: state.velocity.z,
      grounded: state.grounded,
    };
  }

  /**
   * @param {object} snap
   * @param {{ hard?: boolean }} [opts]
   */
  function applyNetworkState(snap, opts = {}) {
    if (!snap) return;
    if (snap.x != null) state.position.x = snap.x;
    if (snap.y != null) state.position.y = snap.y;
    if (snap.z != null) state.position.z = snap.z;
    if (snap.yaw != null) state.yaw = snap.yaw;
    if (snap.vx != null) state.velocity.x = snap.vx;
    if (snap.vy != null) state.velocity.y = snap.vy;
    if (snap.vz != null) state.velocity.z = snap.vz;
    if (snap.speed != null) state.speed = snap.speed;
    if (snap.drifting != null) state.drifting = snap.drifting;
    void opts.hard; // physics-only controller has no separate visual pose
  }

  function reconcile(serverSnap, dtOrAlpha = 0.2) {
    if (!serverSnap) return;
    let alpha = typeof dtOrAlpha === 'number' ? dtOrAlpha : 0.2;
    if (alpha > 1) alpha = 0.2;
    alpha = Math.min(1, Math.max(0, alpha));
    if (serverSnap.x != null) state.position.x += (serverSnap.x - state.position.x) * alpha;
    if (serverSnap.y != null) state.position.y += (serverSnap.y - state.position.y) * alpha;
    if (serverSnap.z != null) state.position.z += (serverSnap.z - state.position.z) * alpha;
    if (serverSnap.yaw != null) {
      let dyaw = serverSnap.yaw - state.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      state.yaw += dyaw * alpha;
    }
    if (serverSnap.vx != null) state.velocity.x += (serverSnap.vx - state.velocity.x) * alpha;
    if (serverSnap.vz != null) state.velocity.z += (serverSnap.vz - state.velocity.z) * alpha;
    if (serverSnap.vy != null) state.velocity.y += (serverSnap.vy - state.velocity.y) * alpha;
    forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    state.speed = state.velocity.dot(forward);
  }

  /** Visual-only helper (no drive physics). Optional mesh applies syncMesh. */
  function syncVisual(dt, mesh) {
    void dt;
    if (mesh) syncMesh(mesh);
  }

  return {
    keys,
    state,
    cfg,
    bindKeys,
    setKey,
    setInput,
    update,
    syncMesh,
    syncVisual,
    updateCamera,
    reset,
    getSnapshot,
    applyNetworkState,
    reconcile,
  };
}

/** Alias kept for callers expecting kart naming. */
export function createKartController(THREE, opts = {}) {
  return createVehicleController(THREE, opts);
}

function resolveColliders(state, colliders) {
  if (!colliders || !colliders.length) return;
  for (const c of colliders) {
    if (!c || !c.position) continue;
    const px = c.position[0] ?? c.position.x ?? 0;
    const pz = c.position[2] ?? c.position.z ?? 0;
    if (c.type === 'sphere' || c.type === 'cylinder') {
      const r = (c.size && (c.size[0] ?? c.size.radius)) || c.radius || 1;
      const dx = state.position.x - px;
      const dz = state.position.z - pz;
      const d = Math.hypot(dx, dz);
      const min = r + 0.9;
      if (d > 0 && d < min) {
        const push = (min - d) / d;
        state.position.x += dx * push;
        state.position.z += dz * push;
        const nx = dx / d;
        const nz = dz / d;
        const vn = state.velocity.x * nx + state.velocity.z * nz;
        if (vn < 0) {
          state.velocity.x -= vn * nx;
          state.velocity.z -= vn * nz;
        }
      }
    } else if (c.type === 'box') {
      const sx = (c.size && (c.size[0] ?? c.size.x)) || 1;
      const sz = (c.size && (c.size[2] ?? c.size.z)) || 1;
      const hx = sx * 0.5 + 0.9;
      const hz = sz * 0.5 + 0.9;
      const dx = state.position.x - px;
      const dz = state.position.z - pz;
      if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
        const ox = hx - Math.abs(dx);
        const oz = hz - Math.abs(dz);
        if (ox < oz) {
          state.position.x += Math.sign(dx || 1) * ox;
          state.velocity.x = 0;
        } else {
          state.position.z += Math.sign(dz || 1) * oz;
          state.velocity.z = 0;
        }
      }
    }
  }
}

export default createVehicleController;
