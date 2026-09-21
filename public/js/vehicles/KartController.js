/**
 * KartController.js — modular arcade kart for Three.js (CDN ESM).
 *
 * Pass THREE into the factory (do not import 'three').
 *
 * Usage:
 *   import { createKartController } from './KartController.js';
 *   const kart = createKartController(THREE, { playerName: 'P1', color: 0xe74c3c });
 *   scene.add(kart.group);
 *   kart.bindInput(window);
 *   // in loop: kart.update(dt); kart.updateCamera(camera, dt);
 */

const DEFAULTS = Object.freeze({
  // Bigger Smash-style arenas (gravel floor ~92, beyblade r~45): slightly more
  // speed + pulled-back cam; still near server PHYS (~42/34) to limit desync.
  maxSpeed: 44,
  reverseMax: 16,
  accel: 36,
  brake: 52,
  reverseAccel: 24,
  steerAngle: 0.78,
  steerResponse: 14,
  driftTurnMul: 1.85,
  driftLateralGrip: 0.42,
  gripLateral: 0.92,
  linearDrag: 0.978,
  angularDrag: 0.86,
  gravity: 60,
  rideHeight: 0.42,
  // Drift exit boost — satisfying pop
  driftMinTime: 0.28,
  driftBoostImpulse: 28,
  driftBoostMaxCharge: 1.2,
  // Sticky chase camera — pulled back for larger floors
  camDistance: 9.6,
  camHeight: 4.4,
  camLookAhead: 6.2,
  camLerp: 12,
  // Name tag
  nameTagHeight: 2.35,
});

/**
 * @param {typeof globalThis.THREE} THREE
 * @param {{
 *   playerName?: string,
 *   playerId?: string,
 *   color?: number,
 *   accent?: number,
 *   spawn?: { position?: [number, number, number], yaw?: number },
 *   config?: Partial<typeof DEFAULTS>,
 * }} [opts]
 */
export function createKartController(THREE, opts = {}) {
  const cfg = { ...DEFAULTS, ...(opts.config || {}) };
  const playerName = opts.playerName ?? opts.playerId ?? 'Player';
  const bodyColor = opts.color ?? 0xe74c3c;
  const accentColor = opts.accent ?? 0x2c3e50;

  const group = new THREE.Group();
  group.name = `Kart:${playerName}`;

  const meshParts = buildKartMesh(THREE, bodyColor, accentColor);
  group.add(meshParts.root);

  const nameTag = createNameTag(THREE, playerName);
  nameTag.position.y = cfg.nameTagHeight;
  group.add(nameTag);

  const spawn = opts.spawn || {};
  const spawnPos = spawn.position || [0, cfg.rideHeight, 0];
  const spawnYaw = spawn.yaw ?? 0;

  const state = {
    position: new THREE.Vector3(spawnPos[0], spawnPos[1] ?? cfg.rideHeight, spawnPos[2]),
    velocity: new THREE.Vector3(),
    yaw: spawnYaw,
    yawRate: 0,
    speed: 0,
    drifting: false,
    driftTime: 0,
    grounded: true,
    hp: 100,
    statusEffects: [],
  };

  group.position.copy(state.position);
  group.rotation.order = 'YXZ';
  group.rotation.y = state.yaw;

  const input = {
    forward: false,
    back: false,
    left: false,
    right: false,
    drift: false,
  };

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  let wasDrifting = false;
  let unbindInput = null;

  // Visual pose (lerped) — hides physics/network jitter
  const visual = {
    pos: new THREE.Vector3().copy(state.position),
    yaw: state.yaw,
    leanZ: 0,
    leanX: 0,
    steer: 0,
    spin: 0,
    suspension: 0,
    susVel: 0,
    hitFlash: 0,
    respawnPulse: 0,
  };
  const VIS_POS_LERP = 20;
  const VIS_YAW_LERP = 14;
  const VIS_LEAN_LERP = 12;
  const STEER_LERP = 14;

  function setInput(next) {
    if (!next) return;
    if ('forward' in next) input.forward = !!next.forward;
    if ('back' in next) input.back = !!next.back;
    if ('left' in next) input.left = !!next.left;
    if ('right' in next) input.right = !!next.right;
    if ('drift' in next) input.drift = !!next.drift;
  }

  function bindInput(target = window) {
    if (unbindInput) unbindInput();
    const onDown = (e) => mapKey(e.code, true, e);
    const onUp = (e) => mapKey(e.code, false, e);
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    unbindInput = () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      unbindInput = null;
    };
    return unbindInput;
  }

  function mapKey(code, pressed, e) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        input.forward = pressed;
        break;
      case 'KeyS':
      case 'ArrowDown':
        input.back = pressed;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        input.left = pressed;
        break;
      case 'KeyD':
      case 'ArrowRight':
        input.right = pressed;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        input.drift = pressed;
        break;
      default:
        return;
    }
    if (
      pressed &&
      e &&
      (code.startsWith('Arrow') || code === 'Space')
    ) {
      e.preventDefault();
    }
  }

  function statusMods() {
    let speedMul = 1;
    let steerMul = 1;
    let accelMul = 1;
    let locked = false;
    for (const fx of state.statusEffects) {
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

  function tickStatus(dt) {
    for (let i = state.statusEffects.length - 1; i >= 0; i--) {
      state.statusEffects[i].remaining -= dt;
      if (state.statusEffects[i].remaining <= 0) state.statusEffects.splice(i, 1);
    }
  }

  /**
   * @param {number} dt
   * @param {{ groundY?: number, colliders?: object[] }} [world]
   */
  function update(dt, world = {}) {
    tickStatus(dt);
    const mods = statusMods();
    const groundY = world.groundY ?? 0;

    forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    right.set(forward.z, 0, -forward.x);

    const speedAbs = Math.abs(state.speed);
    const wantDrift =
      !mods.locked &&
      input.drift &&
      (input.left || input.right) &&
      speedAbs > 8 &&
      state.grounded;

    // Drift exit → speed boost (scales with charge time)
    if (wasDrifting && !wantDrift && state.driftTime >= cfg.driftMinTime) {
      const charge = Math.min(state.driftTime, cfg.driftBoostMaxCharge) / cfg.driftBoostMaxCharge;
      const impulse = cfg.driftBoostImpulse * (0.45 + 0.55 * charge);
      state.velocity.addScaledVector(forward, impulse);
      state.statusEffects.push({
        type: 'boost',
        remaining: 0.35 + 0.45 * charge,
        magnitude: 1.15 + 0.25 * charge,
      });
    }
    state.drifting = wantDrift;
    state.driftTime = wantDrift ? state.driftTime + dt : 0;
    wasDrifting = wantDrift;

    // Steering
    if (!mods.locked) {
      let steerInput = 0;
      if (input.left) steerInput += 1;
      if (input.right) steerInput -= 1;
      const speedFactor = THREE.MathUtils.clamp(speedAbs / cfg.maxSpeed, 0.12, 1);
      const turnMul = wantDrift ? cfg.driftTurnMul : 1;
      const desiredYawRate =
        steerInput * cfg.steerAngle * speedFactor * turnMul * mods.steerMul * cfg.steerResponse;
      state.yawRate = THREE.MathUtils.lerp(
        state.yawRate,
        desiredYawRate,
        1 - Math.exp(-cfg.steerResponse * dt),
      );
      state.yaw += state.yawRate * dt;
    } else {
      state.yawRate *= Math.pow(cfg.angularDrag, dt * 60);
    }

    forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));

    // Throttle / reverse / brake
    if (!mods.locked) {
      const along = state.velocity.dot(forward);
      if (input.forward) {
        state.velocity.addScaledVector(forward, cfg.accel * mods.accelMul * dt);
      } else if (input.back) {
        if (along > 1) {
          state.velocity.addScaledVector(forward, -cfg.brake * dt);
        } else {
          state.velocity.addScaledVector(forward, -cfg.reverseAccel * dt);
        }
      }
    }

    // Lateral grip (looser while drifting)
    const lat = state.velocity.dot(right);
    const grip = wantDrift ? cfg.driftLateralGrip : cfg.gripLateral;
    state.velocity.addScaledVector(right, -lat * (1 - Math.pow(1 - grip, dt * 60)));

    state.velocity.x *= Math.pow(cfg.linearDrag, dt * 60);
    state.velocity.z *= Math.pow(cfg.linearDrag, dt * 60);

    // Clamp forward/reverse speed
    const alongAfter = state.velocity.dot(forward);
    const maxFwd = cfg.maxSpeed * mods.speedMul;
    if (alongAfter > maxFwd) state.velocity.addScaledVector(forward, maxFwd - alongAfter);
    if (alongAfter < -cfg.reverseMax) {
      state.velocity.addScaledVector(forward, -cfg.reverseMax - alongAfter);
    }

    // Gravity + ground
    state.velocity.y -= cfg.gravity * dt;
    resolveColliders(state, world.colliders, cfg.rideHeight);

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

    syncVisual(dt);
  }

  /**
   * Visual-only step: lerp mesh from current state (no accel/steer).
   * Used by remotes after network state lerp.
   */
  function syncVisual(dt) {
    const posA = 1 - Math.exp(-VIS_POS_LERP * dt);
    const yawA = 1 - Math.exp(-VIS_YAW_LERP * dt);
    const leanA = 1 - Math.exp(-VIS_LEAN_LERP * dt);

    visual.pos.lerp(state.position, posA);
    let dyaw = state.yaw - visual.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    visual.yaw += dyaw * yawA;

    const wantDrift = state.drifting;
    const targetLeanZ = THREE.MathUtils.clamp(
      -state.yawRate * (wantDrift ? 0.1 : 0.045),
      -0.5,
      0.5,
    );
    const targetLeanX = THREE.MathUtils.clamp(
      -state.speed * 0.0018 + (state.grounded ? 0 : 0.06),
      -0.14,
      0.1,
    );
    visual.leanZ += (targetLeanZ - visual.leanZ) * leanA;
    visual.leanX += (targetLeanX - visual.leanX) * leanA;

    const accelY = state.grounded ? -Math.abs(state.speed) * 0.0008 : state.velocity.y * 0.02;
    const spring = -visual.suspension * 56 - visual.susVel * 10 + accelY * 28;
    visual.susVel += spring * dt;
    visual.suspension += visual.susVel * dt;
    visual.suspension = THREE.MathUtils.clamp(visual.suspension, -0.12, 0.1);

    group.position.set(
      visual.pos.x,
      visual.pos.y + visual.suspension,
      visual.pos.z,
    );
    group.rotation.order = 'YXZ';
    group.rotation.y = visual.yaw;
    group.rotation.z = visual.leanZ;
    group.rotation.x = visual.leanX;

    const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    meshParts.animateWheels(state.speed, state.yawRate, dt, wantDrift, steerInput, visual);
    faceNameTagToCamera(nameTag);

    if (visual.hitFlash > 0) {
      visual.hitFlash = Math.max(0, visual.hitFlash - dt);
      const flash = Math.min(1, visual.hitFlash * 5);
      const s = 1 + flash * 0.12;
      meshParts.root.scale.setScalar(s);
      if (meshParts.bodyMat) {
        meshParts.bodyMat.emissive.setHex(0xff2222);
        meshParts.bodyMat.emissiveIntensity = flash * 0.85;
      }
    } else if (visual.respawnPulse > 0) {
      visual.respawnPulse = Math.max(0, visual.respawnPulse - dt);
      const u = 1 - visual.respawnPulse / 0.45;
      const s = 0.15 + u * 0.85;
      meshParts.root.scale.setScalar(s);
      if (meshParts.bodyMat) {
        meshParts.bodyMat.emissive.setHex(0xffffff);
        meshParts.bodyMat.emissiveIntensity = (1 - u) * 0.6;
      }
    } else {
      meshParts.root.scale.setScalar(1);
      if (meshParts.bodyMat) meshParts.bodyMat.emissiveIntensity = 0;
    }
  }

  /** Third-person chase camera */
  function updateCamera(camera, dt) {
    if (!camera) return;
    forward.set(Math.sin(visual.yaw), 0, Math.cos(visual.yaw));
    camTarget
      .copy(visual.pos)
      .addScaledVector(forward, -cfg.camDistance)
      .add(tmp.set(0, cfg.camHeight + visual.suspension, 0));
    lookAt
      .copy(visual.pos)
      .addScaledVector(forward, cfg.camLookAhead)
      .add(tmp.set(0, 1.15 + visual.suspension, 0));
    const a = 1 - Math.exp(-cfg.camLerp * dt);
    camera.position.lerp(camTarget, a);
    camera.lookAt(lookAt);
  }

  function reset(x, y, z, yaw = 0) {
    state.position.set(x, y ?? cfg.rideHeight, z);
    state.velocity.set(0, 0, 0);
    state.yaw = yaw;
    state.yawRate = 0;
    state.speed = 0;
    state.drifting = false;
    state.driftTime = 0;
    wasDrifting = false;
    visual.pos.copy(state.position);
    visual.yaw = yaw;
    visual.leanZ = 0;
    visual.leanX = 0;
    visual.steer = 0;
    visual.suspension = 0;
    visual.susVel = 0;
    group.position.copy(state.position);
    group.rotation.set(0, yaw, 0);
  }


  /** Combat juice — brief scale flash on hit (WeaponSystem can call). */
  function punchHit(intensity = 1) {
    visual.hitFlash = Math.max(visual.hitFlash || 0, 0.22 * intensity);
  }

  function punchRespawn() {
    visual.respawnPulse = 0.45;
    visual.hitFlash = 0;
    if (meshParts?.root) meshParts.root.scale.setScalar(0.15);
  }

  function getNetworkState() {
    return {
      id: opts.playerId ?? null,
      x: state.position.x,
      y: state.position.y,
      z: state.position.z,
      yaw: state.yaw,
      vx: state.velocity.x,
      vy: state.velocity.y,
      vz: state.velocity.z,
      speed: state.speed,
      drifting: state.drifting,
      hp: state.hp,
      effects: state.statusEffects.map((e) => ({
        type: e.type,
        remaining: e.remaining,
        magnitude: e.magnitude,
      })),
    };
  }

  /**
   * @param {object} snap
   * @param {{ hard?: boolean }} [opts] hard:true for teleport/respawn (snap visual too)
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
    if (snap.hp != null) state.hp = snap.hp;
    if (snap.effects) state.statusEffects = snap.effects.map((e) => ({ ...e }));

    const hard = !!opts.hard;
    const dx = state.position.x - visual.pos.x;
    const dz = state.position.z - visual.pos.z;
    // Hard teleports always snap visual; otherwise only if planar error > 5
    if (hard || dx * dx + dz * dz > 25) {
      visual.pos.copy(state.position);
      visual.yaw = state.yaw;
      group.position.set(visual.pos.x, visual.pos.y + visual.suspension, visual.pos.z);
      group.rotation.y = visual.yaw;
    }
    // Else leave visual to lerp via syncVisual / update
  }

  /**
   * Soft blend state toward server for medium prediction error.
   * @param {object} serverSnap
   * @param {number} [dtOrAlpha=0.2] alpha in (0,1], or if >1 treat as unused and use 0.2
   */
  function reconcile(serverSnap, dtOrAlpha = 0.2) {
    if (!serverSnap) return;
    let alpha = typeof dtOrAlpha === 'number' ? dtOrAlpha : 0.2;
    if (alpha > 1) alpha = 0.2;
    alpha = Math.min(1, Math.max(0, alpha));

    if (serverSnap.x != null) {
      state.position.x += (serverSnap.x - state.position.x) * alpha;
    }
    if (serverSnap.z != null) {
      state.position.z += (serverSnap.z - state.position.z) * alpha;
    }
    if (serverSnap.y != null) {
      state.position.y += (serverSnap.y - state.position.y) * alpha;
    }
    if (serverSnap.yaw != null) {
      let dyaw = serverSnap.yaw - state.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      state.yaw += dyaw * alpha;
    }
    if (serverSnap.vx != null) {
      state.velocity.x += (serverSnap.vx - state.velocity.x) * alpha;
    }
    if (serverSnap.vz != null) {
      state.velocity.z += (serverSnap.vz - state.velocity.z) * alpha;
    }
    if (serverSnap.vy != null) {
      state.velocity.y += (serverSnap.vy - state.velocity.y) * alpha;
    }
    forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    state.speed = state.velocity.dot(forward);
  }

  function applyHit({ damage = 0, effect = null, fromId = null } = {}) {
    const invincible = state.statusEffects.some((e) => e.type === 'invincible');
    if (!invincible && damage > 0) {
      state.hp = Math.max(0, state.hp - damage);
    }
    if (!invincible && effect) {
      const existing = state.statusEffects.find((e) => e.type === effect.type);
      if (existing) {
        existing.remaining = Math.max(existing.remaining, effect.duration ?? effect.remaining ?? 1);
        existing.magnitude = effect.magnitude ?? existing.magnitude;
      } else {
        state.statusEffects.push({
          type: effect.type,
          remaining: effect.duration ?? effect.remaining ?? 1,
          magnitude: effect.magnitude ?? 1,
          fromId,
        });
      }
    }
    return { hp: state.hp, alive: state.hp > 0 };
  }

  function setPlayerName(name) {
    updateNameTagTexture(THREE, nameTag, name);
  }

  function dispose() {
    if (unbindInput) unbindInput();
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => disposeMat(m));
        else disposeMat(obj.material);
      }
    });
  }

  return {
    group,
    mesh: meshParts.root,
    nameTag,
    state,
    input,
    cfg,
    setInput,
    bindInput,
    update,
    syncVisual,
    updateCamera,
    reset,
    getNetworkState,
    applyNetworkState,
    reconcile,
    applyHit,
    punchHit,
    punchRespawn,
    setPlayerName,
    dispose,
  };
}

/* ─── mesh ─────────────────────────────────────────────────────────── */

function buildKartMesh(THREE, bodyColor, accentColor) {
  const root = new THREE.Group();
  root.name = 'BeachBuggy';

  // Body rides on suspension group so wheels stay planted
  const body = new THREE.Group();
  body.name = 'BuggyBody';
  root.add(body);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    metalness: 0.22,
    roughness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    metalness: 0.45,
    roughness: 0.4,
  });
  const cageMat = new THREE.MeshStandardMaterial({
    color: 0xdfe6e9,
    metalness: 0.7,
    roughness: 0.35,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    metalness: 0.8,
    roughness: 0.28,
  });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2d3436, roughness: 0.85 });
  const bumperMat = new THREE.MeshStandardMaterial({
    color: 0xf1c40f,
    metalness: 0.3,
    roughness: 0.55,
  });

  const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // Chunky tub / chassis
  const tub = cast(new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 2.15), bodyMat));
  tub.position.set(0, 0.42, 0.05);
  body.add(tub);

  // Raised nose / hood scoop
  const nose = cast(new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.28, 0.7), bodyMat));
  nose.position.set(0, 0.55, 0.95);
  body.add(nose);

  // Side pods
  for (const x of [-0.85, 0.85]) {
    const pod = cast(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.35, 1.6), accentMat));
    pod.position.set(x, 0.4, 0.05);
    body.add(pod);
  }

  // Front brush bumper
  const bumper = cast(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.32), bumperMat));
  bumper.position.set(0, 0.28, 1.35);
  body.add(bumper);
  const bar = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.55, 8), cageMat));
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 0.42, 1.42);
  body.add(bar);

  // Bucket seats (open cabin)
  for (const x of [-0.32, 0.32]) {
    const seat = cast(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.48), seatMat));
    seat.position.set(x, 0.62, -0.15);
    body.add(seat);
    const back = cast(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.12), seatMat));
    back.position.set(x, 0.85, -0.35);
    back.rotation.x = -0.15;
    body.add(back);
  }

  // Steering wheel stub
  const col = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 6), cageMat));
  col.position.set(-0.28, 0.85, 0.35);
  col.rotation.x = 0.55;
  body.add(col);
  const wheelRim = cast(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 6, 12), cageMat));
  wheelRim.position.set(-0.28, 0.98, 0.48);
  wheelRim.rotation.x = Math.PI / 2 - 0.4;
  body.add(wheelRim);

  // Open roll cage
  const tube = (x1, y1, z1, x2, y2, z2, r = 0.045) => {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    const mesh = cast(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), cageMat));
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx / len, dy / len, dz / len),
    );
    body.add(mesh);
  };
  // A-pillars
  tube(-0.7, 0.55, 0.55, -0.65, 1.35, 0.15);
  tube(0.7, 0.55, 0.55, 0.65, 1.35, 0.15);
  // B-pillars / rear
  tube(-0.7, 0.55, -0.85, -0.65, 1.35, -0.55);
  tube(0.7, 0.55, -0.85, 0.65, 1.35, -0.55);
  // Roof bars
  tube(-0.65, 1.35, 0.15, 0.65, 1.35, 0.15);
  tube(-0.65, 1.35, -0.55, 0.65, 1.35, -0.55);
  tube(-0.65, 1.35, 0.15, -0.65, 1.35, -0.55);
  tube(0.65, 1.35, 0.15, 0.65, 1.35, -0.55);
  // Cross brace
  tube(-0.65, 1.35, 0.15, 0.65, 1.35, -0.55, 0.035);

  // Rear spare-ish light bar
  const lightBar = cast(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.12), accentMat));
  lightBar.position.set(0, 1.15, -1.0);
  body.add(lightBar);

  // Fat off-road tires
  const wheels = [];
  const tireGeom = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 14);
  const hubGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.4, 10);
  const places = [
    { x: -0.92, y: 0.42, z: 0.95, front: true },
    { x: 0.92, y: 0.42, z: 0.95, front: true },
    { x: -0.92, y: 0.42, z: -0.95, front: false },
    { x: 0.92, y: 0.42, z: -0.95, front: false },
  ];

  for (const p of places) {
    const mount = new THREE.Group(); // steer yaw
    mount.position.set(p.x, p.y, p.z);
    mount.userData.front = p.front;
    mount.userData.baseY = p.y;
    const spinner = new THREE.Group(); // spin on local X
    const tire = cast(new THREE.Mesh(tireGeom, wheelMat));
    tire.rotation.z = Math.PI / 2;
    const hub = cast(new THREE.Mesh(hubGeom, hubMat));
    hub.rotation.z = Math.PI / 2;
    // tread nubs
    for (let i = 0; i < 8; i++) {
      const nub = cast(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.1), wheelMat));
      const a = (i / 8) * Math.PI * 2;
      nub.position.set(0, Math.sin(a) * 0.4, Math.cos(a) * 0.4);
      nub.rotation.x = a;
      spinner.add(nub);
    }
    spinner.add(tire, hub);
    mount.add(spinner);
    root.add(mount);
    wheels.push({ mount, spinner, front: p.front, baseY: p.y });
  }

  let steerSmoothed = 0;
  let spinAngle = 0;

  /**
   * @param {number} speed
   * @param {number} yawRate
   * @param {number} dt
   * @param {boolean} drifting
   * @param {number} steerInput -1..1
   * @param {{ suspension?: number, steer?: number }} [visual]
   */
  function animateWheels(speed, yawRate, dt, drifting, steerInput = 0, visual = {}) {
    // Smooth spin — accumulate angle instead of jittery per-frame hops
    const spinSpeed = speed * 2.05;
    spinAngle += spinSpeed * dt;
    // Smooth steer toward input + yaw assist
    const steerTarget = THREE.MathUtils.clamp(
      steerInput * 0.55 + (-yawRate * 0.12),
      -0.55,
      0.55,
    );
    const boost = drifting ? 1.2 : 1;
    const sA = 1 - Math.exp(-10 * dt);
    steerSmoothed += (steerTarget * boost - steerSmoothed) * sA;

    const sus = visual.suspension ?? 0;
    body.position.y = sus;

    for (const w of wheels) {
      w.spinner.rotation.x = spinAngle * (w.mount.position.x > 0 ? 1 : 1);
      // slight opposite spin sign not needed — same direction for tubes on X
      if (w.front) w.mount.rotation.y = steerSmoothed;
      // wheel stays near ground; tiny compression opposite body
      w.mount.position.y = w.baseY - sus * 0.35;
    }
  }

  return { root, body, wheels, animateWheels, bodyMat, accentMat, bumperMat };
}

/* ─── name tag (canvas texture sprite) ─────────────────────────────── */

function createNameTag(THREE, name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  paintName(canvas, name);

  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.55, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.texture = texture;
  return sprite;
}

function paintName(canvas, name) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // pill background
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, 8, 12, canvas.width - 16, canvas.height - 24, 14);
  ctx.fill();
  ctx.font = 'bold 28px system-ui, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(name).slice(0, 18), canvas.width / 2, canvas.height / 2 + 1);
}

function updateNameTagTexture(THREE, sprite, name) {
  const canvas = sprite.userData.canvas;
  paintName(canvas, name);
  sprite.userData.texture.needsUpdate = true;
}

function faceNameTagToCamera(sprite) {
  // Sprite already faces camera; no-op kept for API clarity / future CSS2D swap
  void sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ─── simple collider push-out (box / sphere / cylinder data) ──────── */

const KART_RADIUS = 0.9;

function isNonSolidCollider(c) {
  // Floors / voids / decorative bowl bands are NOT solid obstacles.
  // Treating them as solid shove karts to the rim every frame (shake/hang).
  if (!c) return true;
  if (c.isTrigger || c.solid === false) return true;
  if (c.kind === 'void' || c.kind === 'floor') return true;
  if (c.tag === 'floor' || c.tag === 'bowl') return true;
  if (c.id === 'floor' || c.id === 'bowl_floor') return true;
  return false;
}

function killRadialIn(state, nx, nz) {
  const vn = state.velocity.x * nx + state.velocity.z * nz;
  if (vn < 0) {
    state.velocity.x -= vn * nx;
    state.velocity.z -= vn * nz;
  }
}

function resolveColliders(state, colliders, rideHeight) {
  if (!colliders || !colliders.length) return;
  for (const c of colliders) {
    if (!c || !c.position || isNonSolidCollider(c)) continue;
    const px = c.position[0] ?? c.position.x ?? 0;
    const pz = c.position[2] ?? c.position.z ?? 0;
    if (c.type === 'sphere') {
      const r = (c.size && (c.size[0] ?? c.size.radius)) || c.radius || 1;
      const dx = state.position.x - px;
      const dz = state.position.z - pz;
      const d = Math.hypot(dx, dz);
      const min = r + KART_RADIUS;
      if (d > 0 && d < min) {
        const push = (min - d) / d;
        state.position.x += dx * push;
        state.position.z += dz * push;
        killRadialIn(state, dx / d, dz / d);
      }
    } else if (c.type === 'cylinder') {
      const r = (c.size && (c.size[0] ?? c.size.radius)) || c.radius || 1;
      const dx = state.position.x - px;
      const dz = state.position.z - pz;
      const d = Math.hypot(dx, dz);
      // Hollow / rim: keep kart INSIDE innerRadius (containment), not push-out solid.
      if (c.hollow || typeof c.innerRadius === 'number' || c.tag === 'rim' || c.kind === 'cage') {
        const inner = (typeof c.innerRadius === 'number' ? c.innerRadius : r - 1) - KART_RADIUS;
        if (inner > 0.1 && d > inner) {
          if (d < 1e-6) {
            state.position.x = px + inner;
            state.position.z = pz;
          } else {
            const s = inner / d;
            state.position.x = px + dx * s;
            state.position.z = pz + dz * s;
            // kill outward radial velocity
            const nx = dx / d;
            const nz = dz / d;
            const vn = state.velocity.x * nx + state.velocity.z * nz;
            if (vn > 0) {
              state.velocity.x -= vn * nx;
              state.velocity.z -= vn * nz;
            }
          }
        }
      } else {
        const min = r + KART_RADIUS;
        if (d > 0 && d < min) {
          const push = (min - d) / d;
          state.position.x += dx * push;
          state.position.z += dz * push;
          killRadialIn(state, dx / d, dz / d);
        } else if (d < 1e-6) {
          state.position.x = px + min;
        }
      }
    } else if (c.type === 'box') {
      const sx = (c.size && (c.size[0] ?? c.size.x)) || 1;
      const sz = (c.size && (c.size[2] ?? c.size.z)) || 1;
      // Skip absurdly flat/wide ground slabs (Y thin, XZ huge)
      const sy = (c.size && (c.size[1] ?? c.size.y)) || 1;
      if (sy < 1.2 && sx > 20 && sz > 20) continue;
      const hx = sx * 0.5 + KART_RADIUS;
      const hz = sz * 0.5 + KART_RADIUS;
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
  void rideHeight;
}

function disposeMat(m) {
  if (m.map) m.map.dispose();
  m.dispose();
}

export { createKartController as createVehicleController };
export default createKartController;
