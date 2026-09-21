/**
 * MapManager.js — arena map loaders for Kart Combat.
 * Browser ESM. Pass CDN THREE into each loader (do not import npm 'three').
 *
 * Architect:
 *   import { loadGravelPit, loadSkyPinball, loadBeybladeArena } from '/js/maps/MapManager.js';
 *
 * Note: mysteryBoxSpawns are PLAIN positions only — physics owns interactive boxes.
 * Do NOT parent gift-box meshes here (would double visuals).
 */
import {
  createGravelTexture,
  createDirtTexture,
  createTireTexture,
  createRockTexture,
  createNeonPanelTexture,
  createBumperTexture,
  createMetalTexture,
  createNetTexture,
} from './shared/textures.js';

/* ─── helpers ───────────────────────────────────────────────────────── */

function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose?.();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m.map) m.map.dispose?.();
        m.dispose?.();
      }
    }
  });
  root.clear();
}

function spawnRing(count, radius, y, teams) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    pts.push({
      x,
      y,
      z,
      rotationY: Math.atan2(-x, -z),
      team: teams ? teams[i % teams.length] : undefined,
    });
  }
  return pts;
}

function clampDt(delta) {
  return Math.min(Math.max(delta || 0, 0), 0.05);
}

/* ═══════════════════════════════════════════════════════════════════════
 * GRAVEL PIT — Smash Karts–style outdoor pit (large readable arena)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * @param {any} THREE
 * @returns {{ name, group, colliders, spawnPoints, mysteryBoxSpawns, update, dispose }}
 */
export function loadGravelPit(THREE) {
  const name = 'Gravel Pit';
  const group = new THREE.Group();
  group.name = 'gravelPit';
  const colliders = [];
  const disposables = [];

  const gravelTex = createGravelTexture(THREE);
  const dirtTex = createDirtTexture(THREE);
  const tireTex = createTireTexture(THREE);
  const rockTex = createRockTexture(THREE);
  disposables.push(gravelTex, dirtTex, tireTex, rockTex);

  // Lights / fog once
  const hemi = new THREE.HemisphereLight(0xffe8c8, 0x5c4a32, 0.75);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd4a0, 1.15);
  sun.position.set(45, 55, 28);
  sun.castShadow = true;
  group.add(sun);
  group.userData.fog = { color: 0xc9b48a, near: 55, far: 160 };
  group.userData.background = 0x87a0b4;

  // ~1.7× footprint vs prior 54 — Smash Karts readable play space
  const floorSize = 92;
  const floorMat = new THREE.MeshStandardMaterial({
    map: gravelTex,
    roughness: 0.95,
    color: 0xbba888,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  disposables.push(floorMat);
  // Single solid ground box — tagged floor (not hollow)
  colliders.push({
    type: 'box',
    id: 'floor',
    tag: 'floor',
    position: { x: 0, y: -0.35, z: 0 },
    size: { x: floorSize, y: 0.7, z: floorSize },
    rotation: { x: 0, y: 0, z: 0 },
    restitution: 0.15,
  });

  const dirtMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 0.9, color: 0x8a6a4a });
  disposables.push(dirtMat);

  function addWall(x, z, w, h, d, rotY = 0, id, tag = 'wall') {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, dirtMat);
    mesh.position.set(x, h / 2, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push({
      type: 'box',
      id: id || `wall_${colliders.length}`,
      tag,
      position: { x, y: h / 2, z },
      size: { x: w, y: h, z: d },
      rotation: { x: 0, y: rotY, z: 0 },
      restitution: 0.2,
    });
  }

  // Tall outer berm walls all around
  const bermH = 4.2;
  const bermD = 3.6;
  const half = 45;
  addWall(0, -half, 90, bermH, bermD, 0, 'wall_s');
  addWall(0, half, 90, bermH, bermD, 0, 'wall_n');
  addWall(-half, 0, bermD, bermH, 88, 0, 'wall_w');
  addWall(half, 0, bermD, bermH, 88, 0, 'wall_e');

  // Corner berm thickeners (readable corners — keep driveable)
  addWall(-38, -38, 6, 4.8, 6, 0.2, 'berm_sw');
  addWall(38, -38, 6, 4.8, 6, -0.2, 'berm_se');
  addWall(-38, 38, 6, 4.8, 6, -0.2, 'berm_nw');
  addWall(38, 38, 6, 4.8, 6, 0.2, 'berm_ne');

  // Inner cover walls — lane dividers / LOS blockers (not sealing)
  addWall(-18, 4, 2.0, 2.2, 16, 0.12, 'inner_a');
  addWall(20, -10, 18, 2.2, 2.0, 0.28, 'inner_b');
  addWall(6, 18, 14, 2.0, 1.8, -0.35, 'inner_c');
  addWall(-8, -18, 12, 1.9, 1.7, 0.45, 'inner_d');
  addWall(26, 14, 1.8, 2.0, 12, -0.2, 'inner_e');

  // Drivable ramps — visual angled; colliders are stepped flat AABB stairs
  // (host resolve uses AABB and ignores rotation, so a rotated hull fights the kart).
  function addRamp(x, z, length, width, height, rotY, id) {
    const geo = new THREE.BoxGeometry(width, 0.45, length);
    const mesh = new THREE.Mesh(geo, dirtMat);
    const angle = Math.atan2(height, length);
    mesh.position.set(x, height / 2, z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = rotY;
    mesh.rotation.x = -angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const steps = 5;
    const stepLen = length / steps;
    const stepH = Math.max(0.35, height / steps);
    const dirX = Math.sin(rotY);
    const dirZ = Math.cos(rotY);
    const baseId = id || `ramp_${colliders.length}`;
    for (let i = 0; i < steps; i++) {
      const along = length / 2 - (i + 0.5) * stepLen;
      const wx = x + dirX * along;
      const wz = z + dirZ * along;
      const topY = ((i + 1) / steps) * height;
      const wy = topY - stepH / 2;
      colliders.push({
        type: 'box',
        id: `${baseId}_s${i}`,
        tag: 'ramp',
        position: { x: wx, y: Math.max(stepH / 2, wy), z: wz },
        size: { x: width, y: stepH, z: stepLen * 1.02 },
        rotation: { x: 0, y: rotY, z: 0 },
        restitution: 0.1,
      });
    }
  }
  // 6 main ramps + bridge approaches
  addRamp(-16, -12, 14, 6.5, 4.0, 0.35, 'ramp_1');
  addRamp(18, 8, 15, 7.0, 4.4, Math.PI + 0.55, 'ramp_2');
  addRamp(0, 22, 12, 6.0, 3.4, Math.PI * 0.5, 'ramp_3');
  addRamp(-24, 14, 12, 5.5, 3.2, -0.7, 'ramp_4');
  addRamp(14, -22, 11, 5.5, 3.0, Math.PI * 0.15, 'ramp_5');
  addRamp(-6, 4, 10, 5.0, 2.8, -Math.PI * 0.4, 'ramp_6');

  // Bridges / elevated lanes
  const bridgeMat = new THREE.MeshStandardMaterial({
    color: 0x9a7a55,
    map: dirtTex,
    roughness: 0.85,
  });
  disposables.push(bridgeMat);

  function addBridgeDeck(bx, bz, bw, bl, by, rotY, id) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.45, bl), bridgeMat);
    mesh.position.set(bx, by, bz);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push({
      type: 'box',
      id,
      tag: 'bridge',
      position: { x: bx, y: by, z: bz },
      size: { x: bw, y: 0.45, z: bl },
      rotation: { x: 0, y: rotY, z: 0 },
      restitution: 0.2,
    });
  }

  // Bridge 1 — mid-south elevated hop
  {
    const bw = 4.2;
    const bl = 16;
    const by = 2.4;
    addBridgeDeck(10, -20, bw, bl, by, 0.4, 'bridge_1');
    addRamp(4.5, -26, 7, 4, 2.4, 0.4, 'ramp_bridge1_a');
    addRamp(15.2, -14.2, 7, 4, 2.4, Math.PI + 0.4, 'ramp_bridge1_b');
  }
  // Bridge 2 — north-east span
  {
    const bw = 4.0;
    const bl = 14;
    const by = 2.6;
    addBridgeDeck(-14, 24, bw, bl, by, -0.55, 'bridge_2');
    addRamp(-20, 18, 7, 3.8, 2.6, -0.55, 'ramp_bridge2_a');
    addRamp(-8.5, 29.5, 7, 3.8, 2.6, Math.PI - 0.55, 'ramp_bridge2_b');
  }

  // Jump pads (short raised platforms)
  function addPad(x, z, w, d, y, id) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), bridgeMat);
    pad.position.set(x, y, z);
    pad.castShadow = true;
    group.add(pad);
    colliders.push({
      type: 'box',
      id,
      tag: 'pad',
      kind: 'jump',
      position: { x, y, z },
      size: { x: w, y: 0.5, z: d },
      rotation: { x: 0, y: 0, z: 0 },
      restitution: 0.2,
    });
  }
  addPad(-28, -8, 5.5, 5.5, 0.4, 'jump_pad_w');
  addPad(30, 10, 5.0, 5.0, 0.4, 'jump_pad_e');

  // Tire barriers — corners + mid landmarks
  const tireMat = new THREE.MeshStandardMaterial({ map: tireTex, roughness: 0.7 });
  disposables.push(tireMat);
  function addTires(x, z, stacks = 3) {
    for (let i = 0; i < stacks; i++) {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.24, 8, 16), tireMat);
      mesh.position.set(x, 0.24 + i * 0.58, z);
      mesh.rotation.x = Math.PI / 2;
      mesh.castShadow = true;
      group.add(mesh);
    }
    colliders.push({
      type: 'cylinder',
      id: `tires_${colliders.length}`,
      tag: 'barrier',
      position: { x, y: (stacks * 0.58) / 2, z },
      radius: 1.0,
      height: stacks * 0.58,
      rotation: { x: 0, y: 0, z: 0 },
      restitution: 0.2,
    });
  }
  // Outer ring stacks
  [
    [-36, -36], [36, -36], [-36, 36], [36, 36],
    [-36, 0], [36, 0], [0, -36], [0, 36],
    [-36, -18], [36, 18], [-18, 36], [18, -36],
  ].forEach(([x, z], i) => addTires(x, z, 3 + (i % 2)));
  // Mid cluster tires (LOS / cover)
  addTires(-12, 10, 3);
  addTires(12, -8, 3);
  addTires(-10, -14, 2);
  addTires(14, 12, 2);
  addTires(0, -22, 3);
  addTires(22, 0, 2);

  // Center rock cluster — strong landmark
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.88, color: 0x888480 });
  disposables.push(rockMat);
  const rocks = [
    { x: 0, y: 2.0, z: 0, sx: 6.0, sy: 4.0, sz: 5.4 },
    { x: 4.2, y: 1.3, z: 2.6, sx: 3.2, sy: 2.6, sz: 3.2 },
    { x: -3.8, y: 1.2, z: -2.4, sx: 3.4, sy: 2.4, sz: 2.8 },
    { x: 2.0, y: 1.0, z: -3.6, sx: 2.4, sy: 2.0, sz: 2.6 },
    { x: -3.2, y: 0.95, z: 3.4, sx: 2.2, sy: 1.9, sz: 2.4 },
  ];
  rocks.forEach((r, i) => {
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat);
    mesh.position.set(r.x, r.y, r.z);
    mesh.scale.set(r.sx / 2, r.sy / 2, r.sz / 2);
    mesh.castShadow = true;
    group.add(mesh);
    colliders.push({
      type: 'box',
      id: `rock_${i}`,
      tag: 'obstacle',
      position: { x: r.x, y: r.y, z: r.z },
      size: { x: r.sx, y: r.sy, z: r.sz },
      rotation: { x: 0, y: 0, z: 0 },
      restitution: 0.15,
    });
  });

  // Satellite rock cover
  [
    { x: -22, z: 22, sx: 3.0, sy: 2.2, sz: 2.8 },
    { x: 24, z: -18, sx: 2.8, sy: 2.0, sz: 2.6 },
  ].forEach((r, i) => {
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat);
    mesh.position.set(r.x, r.sy / 2, r.z);
    mesh.scale.set(r.sx / 2, r.sy / 2, r.sz / 2);
    mesh.castShadow = true;
    group.add(mesh);
    colliders.push({
      type: 'box',
      id: `rock_sat_${i}`,
      tag: 'obstacle',
      position: { x: r.x, y: r.sy / 2, z: r.z },
      size: { x: r.sx, y: r.sy, z: r.sz },
      rotation: { x: 0, y: 0, z: 0 },
      restitution: 0.15,
    });
  });

  // Flags / poles at quadrant + mid markers
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.4 });
  const flagMats = [
    new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xaa1122, emissiveIntensity: 0.25 }),
    new THREE.MeshStandardMaterial({ color: 0x3388ff, emissive: 0x1144aa, emissiveIntensity: 0.25 }),
    new THREE.MeshStandardMaterial({ color: 0xffcc22, emissive: 0xaa8800, emissiveIntensity: 0.25 }),
    new THREE.MeshStandardMaterial({ color: 0x33cc66, emissive: 0x118833, emissiveIntensity: 0.25 }),
  ];
  disposables.push(poleMat, ...flagMats);
  [
    [-32, -22],
    [32, -22],
    [-32, 22],
    [32, 22],
    [0, -32],
    [0, 32],
  ].forEach(([x, z], i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.5, 8), poleMat);
    pole.position.set(x, 2.75, z);
    pole.castShadow = true;
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), flagMats[i % flagMats.length]);
    flag.position.set(x + 0.85, 4.4, z);
    flag.castShadow = true;
    group.add(flag);
  });

  // Spawn ring — larger radius, clear of walls
  const spawnPoints = spawnRing(8, 28, 1.2, ['A', 'B']);

  // Dense mystery box pads in open lanes / pads / ramp tops (physics owns meshes)
  const mysteryBoxSpawns = [
    // Outer ring
    { x: -28, y: 1.15, z: -28, id: 'mb_sw' },
    { x: 28, y: 1.15, z: -28, id: 'mb_se' },
    { x: -28, y: 1.15, z: 28, id: 'mb_nw' },
    { x: 28, y: 1.15, z: 28, id: 'mb_ne' },
    { x: 0, y: 1.15, z: -32, id: 'mb_s' },
    { x: 0, y: 1.15, z: 32, id: 'mb_n' },
    { x: -32, y: 1.15, z: 0, id: 'mb_w' },
    { x: 32, y: 1.15, z: 0, id: 'mb_e' },
    // Mid ring
    { x: -18, y: 1.15, z: 0, id: 'mb_mid_w' },
    { x: 18, y: 1.15, z: 0, id: 'mb_mid_e' },
    { x: 0, y: 1.15, z: -18, id: 'mb_mid_s' },
    { x: 0, y: 1.15, z: 18, id: 'mb_mid_n' },
    { x: -16, y: 1.15, z: -16, id: 'mb_mid_sw' },
    { x: 16, y: 1.15, z: -16, id: 'mb_mid_se' },
    { x: -16, y: 1.15, z: 16, id: 'mb_mid_nw' },
    { x: 16, y: 1.15, z: 16, id: 'mb_mid_ne' },
    // Lane pads
    { x: -26, y: 1.15, z: -12, id: 'mb_lane_a' },
    { x: 26, y: 1.15, z: 12, id: 'mb_lane_b' },
    { x: -12, y: 1.15, z: 26, id: 'mb_lane_c' },
    { x: 12, y: 1.15, z: -26, id: 'mb_lane_d' },
    { x: -8, y: 1.15, z: -28, id: 'mb_lane_e' },
    { x: 8, y: 1.15, z: 28, id: 'mb_lane_f' },
    { x: -30, y: 1.15, z: 10, id: 'mb_lane_g' },
    { x: 30, y: 1.15, z: -10, id: 'mb_lane_h' },
    // Ramp tops
    { x: -16, y: 4.2, z: -10, id: 'mb_ramp1' },
    { x: 16, y: 4.6, z: 6, id: 'mb_ramp2' },
    { x: 0, y: 3.6, z: 20, id: 'mb_ramp3' },
    { x: -22, y: 3.4, z: 12, id: 'mb_ramp4' },
    { x: 12, y: 3.2, z: -20, id: 'mb_ramp5' },
    { x: -4, y: 3.0, z: 2, id: 'mb_ramp6' },
    // Bridges + pads
    { x: 10, y: 3.0, z: -20, id: 'mb_bridge1' },
    { x: -14, y: 3.2, z: 24, id: 'mb_bridge2' },
    { x: -28, y: 1.5, z: -8, id: 'mb_pad_w' },
    { x: 30, y: 1.5, z: 10, id: 'mb_pad_e' },
    // Extra open-lane fillers
    { x: -22, y: 1.15, z: 4, id: 'mb_fill_a' },
    { x: 22, y: 1.15, z: -4, id: 'mb_fill_b' },
  ];

  return {
    name,
    id: 'gravelPit',
    group,
    colliders,
    spawnPoints,
    mysteryBoxSpawns,
    floorSize,
    update(delta) {
      clampDt(delta);
    },
    dispose() {
      disposeObject3D(group);
      disposables.forEach((d) => d.dispose?.());
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * SKY PINBALL — floating tiers + perimeter bumpers (large platforms)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * @param {any} THREE
 */
export function loadSkyPinball(THREE) {
  const name = 'Sky Pinball';
  const group = new THREE.Group();
  group.name = 'skyPinball';
  const colliders = [];
  const disposables = [];
  const bumpers = [];

  const panelTex = createNeonPanelTexture(THREE, '#12182a', '#00e5ff');
  const panelTex2 = createNeonPanelTexture(THREE, '#1a1028', '#b14eff');
  const bumperTex = createBumperTexture(THREE, '#ff2d95');
  disposables.push(panelTex, panelTex2, bumperTex);

  group.add(new THREE.HemisphereLight(0x6688ff, 0x1a1030, 0.55));
  const key = new THREE.DirectionalLight(0xaaccff, 0.9);
  key.position.set(16, 40, 18);
  group.add(key);
  group.add(new THREE.PointLight(0x00e5ff, 1.4, 90).translateY(10));
  group.userData.fog = { color: 0x0a0e1a, near: 35, far: 130 };
  group.userData.background = 0x060812;

  const matA = new THREE.MeshStandardMaterial({
    map: panelTex,
    roughness: 0.45,
    metalness: 0.35,
    emissive: 0x003344,
    emissiveIntensity: 0.25,
  });
  const matB = new THREE.MeshStandardMaterial({
    map: panelTex2,
    roughness: 0.45,
    metalness: 0.35,
    emissive: 0x220044,
    emissiveIntensity: 0.3,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: 0x00e5ff,
    emissiveIntensity: 0.55,
    metalness: 0.4,
    roughness: 0.35,
  });
  disposables.push(matA, matB, railMat);

  function addPlatform(x, y, z, w, h, d, mat, id) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.05, 0.08, d + 0.05),
      new THREE.MeshStandardMaterial({
        color: mat === matB ? 0xb14eff : 0x00e5ff,
        emissive: mat === matB ? 0xb14eff : 0x00e5ff,
        emissiveIntensity: 0.8,
      }),
    );
    edge.position.set(x, y + h / 2 + 0.02, z);
    group.add(edge);
    colliders.push({
      type: 'box',
      id,
      tag: id === 'tier0' ? 'floor' : 'platform',
      position: { x, y, z },
      size: { x: w, y: h, z: d },
      rotation: { x: 0, y: 0, z: 0 },
      restitution: 0.25,
    });
  }

  // 3 tiers — ~2× prior footprint, clear driving loops
  // tier0 was 20 → 38; tier1 ~12 → 22; tier2 10 → 18
  const t0 = { x: 0, y: 0, z: 0, w: 38, h: 0.7, d: 38 };
  const t1a = { x: -24, y: 5.6, z: 8, w: 22, h: 0.6, d: 22 };
  const t1b = { x: 22, y: 6.2, z: -10, w: 20, h: 0.6, d: 20 };
  const t2 = { x: 0, y: 12.5, z: -4, w: 18, h: 0.6, d: 18 };
  const side = { x: -10, y: 2.8, z: -22, w: 11, h: 0.5, d: 11 };

  addPlatform(t0.x, t0.y, t0.z, t0.w, t0.h, t0.d, matA, 'tier0');
  addPlatform(t1a.x, t1a.y, t1a.z, t1a.w, t1a.h, t1a.d, matB, 'tier1a');
  addPlatform(t1b.x, t1b.y, t1b.z, t1b.w, t1b.h, t1b.d, matA, 'tier1b');
  addPlatform(t2.x, t2.y, t2.z, t2.w, t2.h, t2.d, matB, 'tier2');
  addPlatform(side.x, side.y, side.z, side.w, side.h, side.d, matA, 'side_low');

  // Railings / low walls — sit on platform top rim
  function addRail(x, y, z, w, h, d, rotY, id) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), railMat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY || 0;
    mesh.castShadow = true;
    group.add(mesh);
    colliders.push({
      type: 'box',
      id,
      tag: 'wall',
      position: { x, y, z },
      size: { x: w, y: h, z: d },
      rotation: { x: 0, y: rotY || 0, z: 0 },
      restitution: 0.2,
    });
  }
  const rh = 0.6;
  const t0Top = t0.y + t0.h / 2;
  const t1aTop = t1a.y + t1a.h / 2;
  const t1bTop = t1b.y + t1b.h / 2;
  const t2Top = t2.y + t2.h / 2;
  const sideTop = side.y + side.h / 2;

  // Tier0 rails (gaps for ramps/bridges)
  addRail(0, t0Top + rh / 2, -t0.d / 2 - 0.15, 28, rh, 0.3, 0, 'rail0_s');
  addRail(0, t0Top + rh / 2, t0.d / 2 + 0.15, 28, rh, 0.3, 0, 'rail0_n');
  addRail(-t0.w / 2 - 0.15, t0Top + rh / 2, 0, 0.3, rh, 28, 0, 'rail0_w');
  addRail(t0.w / 2 + 0.15, t0Top + rh / 2, 0, 0.3, rh, 28, 0, 'rail0_e');
  // Tier1a
  addRail(t1a.x, t1aTop + rh / 2, t1a.z - t1a.d / 2 - 0.15, 18, rh, 0.28, 0, 'rail1a_s');
  addRail(t1a.x, t1aTop + rh / 2, t1a.z + t1a.d / 2 + 0.15, 18, rh, 0.28, 0, 'rail1a_n');
  addRail(t1a.x - t1a.w / 2 - 0.15, t1aTop + rh / 2, t1a.z, 0.28, rh, 18, 0, 'rail1a_w');
  // Tier1b
  addRail(t1b.x, t1bTop + rh / 2, t1b.z - t1b.d / 2 - 0.15, 16, rh, 0.28, 0, 'rail1b_s');
  addRail(t1b.x, t1bTop + rh / 2, t1b.z + t1b.d / 2 + 0.15, 16, rh, 0.28, 0, 'rail1b_n');
  addRail(t1b.x + t1b.w / 2 + 0.15, t1bTop + rh / 2, t1b.z, 0.28, rh, 16, 0, 'rail1b_e');
  // Tier2
  addRail(t2.x, t2Top + rh / 2, t2.z - t2.d / 2 - 0.15, 14, rh, 0.28, 0, 'rail2_s');
  addRail(t2.x, t2Top + rh / 2, t2.z + t2.d / 2 + 0.15, 14, rh, 0.28, 0, 'rail2_n');
  addRail(t2.x - t2.w / 2 - 0.15, t2Top + rh / 2, t2.z, 0.28, rh, 14, 0, 'rail2_w');
  addRail(t2.x + t2.w / 2 + 0.15, t2Top + rh / 2, t2.z, 0.28, rh, 14, 0, 'rail2_e');
  // Side
  addRail(side.x, sideTop + rh / 2, side.z - side.d / 2 - 0.12, 8, rh, 0.25, 0, 'rail_side_s');

  function addBridge(x, y, z, length, width, rotY, rise, id) {
    const thickness = 0.4;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, length), matA);
    const pitch = rise ? -Math.atan2(rise, length) : 0;
    mesh.position.set(x, y + rise / 2, z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = rotY;
    mesh.rotation.x = pitch;
    mesh.castShadow = true;
    group.add(mesh);
    colliders.push({
      type: 'box',
      id,
      tag: 'bridge',
      position: { x, y: y + rise / 2, z },
      size: { x: width, y: thickness, z: length },
      rotation: { x: pitch, y: rotY, z: 0 },
      restitution: 0.2,
    });
    // Side rails on bridge (wider decks)
    const sideOffset = width / 2 + 0.14;
    for (const s of [-1, 1]) {
      const sx = x + Math.cos(rotY) * s * sideOffset;
      const sz = z + Math.sin(rotY) * s * sideOffset;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, length * 0.92), railMat);
      rail.position.set(sx, y + rise / 2 + 0.4, sz);
      rail.rotation.order = 'YXZ';
      rail.rotation.y = rotY;
      rail.rotation.x = pitch;
      group.add(rail);
    }
  }
  // Wider bridges connecting scaled tiers
  addBridge(-12, 2.6, 4, 18, 4.2, -0.5, 5.6, 'br1');
  addBridge(11, 2.9, -5, 20, 4.2, 0.9, 6.2, 'br2');
  addBridge(-10, 8.8, 2, 18, 3.6, 0.55, 6.8, 'br3');
  addBridge(10, 9.1, -7, 17, 3.6, -0.7, 6.2, 'br4');
  addBridge(-5, 1.3, -11, 14, 3.4, 1.15, 2.8, 'br_side');

  // Void trigger far below
  colliders.push({
    type: 'box',
    id: 'void',
    kind: 'void',
    tag: 'void',
    position: { x: 0, y: -28, z: 0 },
    size: { x: 320, y: 0.5, z: 320 },
    rotation: { x: 0, y: 0, z: 0 },
    restitution: 0,
  });
  const voidMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({
      color: 0x110022,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    }),
  );
  voidMesh.rotation.x = -Math.PI / 2;
  voidMesh.position.y = -28;
  group.add(voidMesh);

  function addBumper(x, y, z, radius = 1.1, bounce = 12) {
    const mat = new THREE.MeshStandardMaterial({
      map: bumperTex,
      emissive: 0xff2d95,
      emissiveIntensity: 0.4,
      roughness: 0.35,
      metalness: 0.2,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    disposables.push(mat);
    // Trigger (not solid bounce wall) — avoids restitution×applyForce double-hit shake.
    const col = {
      type: 'sphere',
      id: `bumper_${bumpers.length}`,
      kind: 'bumper',
      tag: 'bumper',
      position: { x, y, z },
      radius,
      rotation: { x: 0, y: 0, z: 0 },
      isTrigger: true,
      solid: false,
      restitution: 0.2,
      bounceStrength: bounce,
    };
    colliders.push(col);
    bumpers.push({ mesh, mat, col, position: { x, y, z }, radius, bounceStrength: bounce, flash: 0 });
  }

  // More perimeter + on-tier bumpers (triggers only)
  addBumper(0, 1.35, 0, 1.5, 14);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    addBumper(Math.cos(a) * 14, 1.25, Math.sin(a) * 14, 1.0, 12);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.25;
    addBumper(Math.cos(a) * 17.5, 1.2, Math.sin(a) * 17.5, 0.85, 10);
  }
  // On-tier centers (off spawn rings)
  addBumper(t1a.x, t1aTop + 1.15, t1a.z, 1.2, 12);
  addBumper(t1b.x, t1bTop + 1.15, t1b.z, 1.2, 12);
  addBumper(t2.x, t2Top + 1.2, t2.z, 1.35, 14);
  addBumper(side.x, sideTop + 1.05, side.z, 1.0, 11);
  // Extra on-tier perimeter
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    addBumper(t1a.x + Math.cos(a) * 7, t1aTop + 1.05, t1a.z + Math.sin(a) * 7, 0.85, 11);
    addBumper(t1b.x + Math.cos(a) * 6.5, t1bTop + 1.05, t1b.z + Math.sin(a) * 6.5, 0.85, 11);
  }

  const spawnPoints = [
    ...spawnRing(4, 12, 1.15, ['tier0']),
    ...spawnRing(2, 6, t1aTop + 0.9, ['tier1']).map((p) => ({
      ...p,
      x: p.x + t1a.x,
      z: p.z + t1a.z,
      y: t1aTop + 0.9,
    })),
    ...spawnRing(2, 5.5, t1bTop + 0.9, ['tier1']).map((p) => ({
      ...p,
      x: p.x + t1b.x,
      z: p.z + t1b.z,
      y: t1bTop + 0.9,
    })),
    ...spawnRing(3, 5, t2Top + 0.9, ['tier2']).map((p) => ({
      ...p,
      x: p.x + t2.x,
      z: p.z + t2.z,
      y: t2Top + 0.9,
    })),
  ];

  // Dense mystery boxes across tiers — clear of bumper centers (~40)
  const mysteryBoxSpawns = [
    // Tier 0 ring
    { x: -12, y: 1.25, z: -12, id: 'sp_t0_a' },
    { x: 12, y: 1.25, z: -12, id: 'sp_t0_b' },
    { x: -12, y: 1.25, z: 12, id: 'sp_t0_c' },
    { x: 12, y: 1.25, z: 12, id: 'sp_t0_d' },
    { x: 0, y: 1.25, z: -14, id: 'sp_t0_e' },
    { x: 0, y: 1.25, z: 14, id: 'sp_t0_f' },
    { x: -14, y: 1.25, z: 0, id: 'sp_t0_g' },
    { x: 14, y: 1.25, z: 0, id: 'sp_t0_h' },
    { x: -8, y: 1.25, z: -15, id: 'sp_t0_i' },
    { x: 8, y: 1.25, z: 15, id: 'sp_t0_j' },
    { x: -15, y: 1.25, z: 8, id: 'sp_t0_k' },
    { x: 15, y: 1.25, z: -8, id: 'sp_t0_l' },
    // Tier 1a (off center bumper)
    { x: t1a.x - 6, y: t1aTop + 1.1, z: t1a.z - 6, id: 'sp_t1a_a' },
    { x: t1a.x + 6, y: t1aTop + 1.1, z: t1a.z - 6, id: 'sp_t1a_b' },
    { x: t1a.x - 6, y: t1aTop + 1.1, z: t1a.z + 6, id: 'sp_t1a_c' },
    { x: t1a.x + 6, y: t1aTop + 1.1, z: t1a.z + 6, id: 'sp_t1a_d' },
    { x: t1a.x, y: t1aTop + 1.1, z: t1a.z - 8, id: 'sp_t1a_e' },
    { x: t1a.x, y: t1aTop + 1.1, z: t1a.z + 8, id: 'sp_t1a_f' },
    // Tier 1b
    { x: t1b.x - 5.5, y: t1bTop + 1.1, z: t1b.z - 5.5, id: 'sp_t1b_a' },
    { x: t1b.x + 5.5, y: t1bTop + 1.1, z: t1b.z - 5.5, id: 'sp_t1b_b' },
    { x: t1b.x - 5.5, y: t1bTop + 1.1, z: t1b.z + 5.5, id: 'sp_t1b_c' },
    { x: t1b.x + 5.5, y: t1bTop + 1.1, z: t1b.z + 5.5, id: 'sp_t1b_d' },
    { x: t1b.x - 7, y: t1bTop + 1.1, z: t1b.z, id: 'sp_t1b_e' },
    { x: t1b.x + 7, y: t1bTop + 1.1, z: t1b.z, id: 'sp_t1b_f' },
    // Tier 2
    { x: t2.x - 5, y: t2Top + 1.15, z: t2.z - 5, id: 'sp_t2_a' },
    { x: t2.x + 5, y: t2Top + 1.15, z: t2.z - 5, id: 'sp_t2_b' },
    { x: t2.x - 5, y: t2Top + 1.15, z: t2.z + 5, id: 'sp_t2_c' },
    { x: t2.x + 5, y: t2Top + 1.15, z: t2.z + 5, id: 'sp_t2_d' },
    { x: t2.x, y: t2Top + 1.15, z: t2.z - 6.5, id: 'sp_t2_e' },
    { x: t2.x, y: t2Top + 1.15, z: t2.z + 6.5, id: 'sp_t2_f' },
    // Side + bridges
    { x: side.x - 3, y: sideTop + 1.05, z: side.z + 3, id: 'sp_side_a' },
    { x: side.x + 3, y: sideTop + 1.05, z: side.z - 3, id: 'sp_side_b' },
    { x: -12, y: 5.4, z: 4, id: 'sp_br1' },
    { x: 11, y: 5.8, z: -5, id: 'sp_br2' },
    { x: -10, y: 11.5, z: 2, id: 'sp_br3' },
    { x: 10, y: 11.8, z: -7, id: 'sp_br4' },
    { x: -5, y: 2.6, z: -11, id: 'sp_br_side' },
    { x: 4, y: 1.25, z: -10, id: 'sp_t0_extra' },
  ];

  const cooldown = new Map();

  function update(delta, world = {}) {
    const dt = clampDt(delta);
    for (const b of bumpers) {
      if (b.flash > 0) {
        b.flash = Math.max(0, b.flash - dt * 3);
        b.mat.emissiveIntensity = 0.4 + b.flash * 2.5;
      }
    }
    for (const [k, t] of cooldown) {
      const n = t - dt;
      if (n <= 0) cooldown.delete(k);
      else cooldown.set(k, n);
    }
    const players = world.karts
      ? world.karts.map((k) => ({
          id: k.cfg?.playerId || k.state?.playerId || 'kart',
          position: k.state?.position,
          velocity: k.state?.velocity,
        }))
      : world.players || [];
    for (const player of players) {
      const p = player.position;
      if (!p) continue;
      for (const b of bumpers) {
        const dx = (p.x ?? 0) - b.position.x;
        const dy = (p.y ?? 0) - b.position.y;
        const dz = (p.z ?? 0) - b.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist >= b.radius + 0.6 || dist < 0.001) continue;
        const key = `${player.id}:${b.col.id}`;
        if (cooldown.has(key)) continue;
        cooldown.set(key, 0.45);
        // Visual flash only by default. Mild horizontal impulse only — never +Y launch.
        b.flash = 1;
        b.mat.emissiveIntensity = 2.8;
        if (typeof world.applyForce === 'function') {
          const inv = 1 / dist;
          const s = Math.min(b.bounceStrength || 10, 10);
          world.applyForce(player.id, {
            x: dx * inv * s,
            y: 0,
            z: dz * inv * s,
          });
        }
      }
    }
  }

  return {
    name,
    id: 'skyPinball',
    group,
    colliders,
    spawnPoints,
    mysteryBoxSpawns,
    update,
    dispose() {
      disposeObject3D(group);
      disposables.forEach((d) => d.dispose?.());
      bumpers.length = 0;
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * BEYBLADE ARENA — rotating bowl (radius ~45) + centrifugal force
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * @param {any} THREE
 */
export function loadBeybladeArena(THREE) {
  const name = 'Beyblade Arena';
  const group = new THREE.Group();
  group.name = 'beybladeArena';
  const colliders = [];
  const disposables = [];
  /** Colliders that rotate with the bowl (not the static cage). */
  const rotatingColliderIds = new Set();

  const ARENA_RADIUS = 45;
  // Slow carnival spin (~1 turn / 45s).
  let angularVelocity = 0.14; // rad/s
  // Mild outward accel at the slow ω (a ≈ ω² r * scale).
  const centrifugalScale = 0.35;
  const DISH_HEIGHT = 8.5;

  const metalTex = createMetalTexture(THREE);
  const netTex = createNetTexture(THREE);
  disposables.push(metalTex, netTex);

  group.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(20, 40, 16);
  group.add(key);
  group.add(new THREE.PointLight(0x66ccff, 1.0, 80).translateY(12));
  group.userData.fog = { color: 0x1a2030, near: 45, far: 140 };
  group.userData.background = 0x101520;

  // Only the dish spins — root `group` stays put.
  const bowlGroup = new THREE.Group();
  bowlGroup.name = 'bowl';
  group.add(bowlGroup);

  const bowlMat = new THREE.MeshStandardMaterial({
    map: metalTex,
    color: 0xc8d0dc,
    metalness: 0.85,
    roughness: 0.22,
  });
  const accentA = new THREE.MeshStandardMaterial({
    color: 0xff3355,
    metalness: 0.6,
    roughness: 0.3,
    emissive: 0xff3355,
    emissiveIntensity: 0.35,
  });
  const accentB = new THREE.MeshStandardMaterial({
    color: 0x33aaff,
    metalness: 0.6,
    roughness: 0.3,
    emissive: 0x33aaff,
    emissiveIntensity: 0.35,
  });
  const accentC = new THREE.MeshStandardMaterial({
    color: 0xffcc33,
    metalness: 0.5,
    roughness: 0.35,
    emissive: 0xaa8800,
    emissiveIntensity: 0.3,
  });
  const accentD = new THREE.MeshStandardMaterial({
    color: 0x44dd88,
    metalness: 0.5,
    roughness: 0.35,
    emissive: 0x228855,
    emissiveIntensity: 0.3,
  });
  const netMat = new THREE.MeshStandardMaterial({
    map: netTex,
    color: 0xa8d8ff,
    metalness: 0.2,
    roughness: 0.45,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    emissive: 0x2266aa,
    emissiveIntensity: 0.15,
  });
  const netBarMat = new THREE.MeshStandardMaterial({
    color: 0xd0e8ff,
    metalness: 0.55,
    roughness: 0.35,
    emissive: 0x88ccff,
    emissiveIntensity: 0.2,
  });
  disposables.push(bowlMat, accentA, accentB, accentC, accentD, netMat, netBarMat);

  // Dish profile — radius ARENA_RADIUS
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push(new THREE.Vector2(t * ARENA_RADIUS, Math.pow(t, 2.1) * DISH_HEIGHT));
  }
  const bowlMesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 80), bowlMat);
  bowlMesh.castShadow = true;
  bowlMesh.receiveShadow = true;
  bowlGroup.add(bowlMesh);

  // Center podium (readable landmark)
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 4.2, 0.65, 32),
    new THREE.MeshStandardMaterial({
      color: 0xe8eef5,
      metalness: 0.9,
      roughness: 0.15,
      map: metalTex,
      emissive: 0x334455,
      emissiveIntensity: 0.15,
    }),
  );
  podium.position.y = 0.4;
  podium.castShadow = true;
  podium.receiveShadow = true;
  bowlGroup.add(podium);

  const FLOOR_RADIUS = 14;
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(FLOOR_RADIUS, 64),
    new THREE.MeshStandardMaterial({
      color: 0xe8eef5,
      metalness: 0.9,
      roughness: 0.15,
      map: metalTex,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.05;
  floor.receiveShadow = true;
  bowlGroup.add(floor);

  // Colored sector wedges (visual clarity of rotation)
  const sectorMats = [accentA, accentB, accentC, accentD];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    const steps = 10;
    for (let s = 0; s <= steps; s++) {
      const a = a0 + (s / steps) * (Math.PI / 4);
      shape.lineTo(Math.cos(a) * (FLOOR_RADIUS - 0.5), Math.sin(a) * (FLOOR_RADIUS - 0.5));
    }
    shape.lineTo(0, 0);
    const geo = new THREE.ShapeGeometry(shape);
    const wedge = new THREE.Mesh(geo, sectorMats[i % sectorMats.length]);
    wedge.rotation.x = -Math.PI / 2;
    wedge.position.y = 0.08;
    wedge.material = wedge.material.clone();
    wedge.material.transparent = true;
    wedge.material.opacity = 0.35;
    wedge.material.emissiveIntensity = 0.2;
    disposables.push(wedge.material);
    bowlGroup.add(wedge);
  }

  function ring(radius, y, mat) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.14, 8, 80), mat);
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    bowlGroup.add(m);
  }
  // Groove rings scaled with dish
  const grooveRs = [10, 16, 22, 28, 33, 37, 41, 43.5];
  const grooveMats = [accentC, accentA, accentD, accentB, accentA, accentB, accentC, accentB];
  grooveRs.forEach((r, i) => {
    const y = Math.pow(r / ARENA_RADIUS, 2.1) * DISH_HEIGHT + 0.15;
    ring(r, y, grooveMats[i]);
  });

  // Banked lip clarity
  const rim = new THREE.Mesh(new THREE.TorusGeometry(ARENA_RADIUS, 0.5, 12, 80), bowlMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = DISH_HEIGHT;
  bowlGroup.add(rim);
  const lipBand = new THREE.Mesh(
    new THREE.TorusGeometry(ARENA_RADIUS - 0.25, 0.22, 10, 80),
    accentA,
  );
  lipBand.rotation.x = Math.PI / 2;
  lipBand.position.y = DISH_HEIGHT + 0.3;
  bowlGroup.add(lipBand);

  // Rim fins
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.2, 2.6), i % 2 ? accentA : accentB);
    fin.position.set(Math.cos(a) * (ARENA_RADIUS - 1.5), DISH_HEIGHT - 0.9, Math.sin(a) * (ARENA_RADIUS - 1.5));
    fin.rotation.y = -a;
    bowlGroup.add(fin);
  }

  // Start lights / pylons around mid-radius (more detail)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 20;
    const pylon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 2.6, 8),
      i % 2 ? accentA : accentB,
    );
    const py = Math.pow(r / ARENA_RADIUS, 2.1) * DISH_HEIGHT + 1.4;
    pylon.position.set(Math.cos(a) * r, py, Math.sin(a) * r);
    pylon.castShadow = true;
    bowlGroup.add(pylon);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: i % 2 ? 0xff3355 : 0x33aaff,
        emissiveIntensity: 1.2,
      }),
    );
    lamp.position.set(Math.cos(a) * r, py + 1.4, Math.sin(a) * r);
    bowlGroup.add(lamp);
  }
  // Inner pylons near podium
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const r = 8;
    const pylon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 1.8, 8),
      i % 2 ? accentC : accentD,
    );
    pylon.position.set(Math.cos(a) * r, 1.1, Math.sin(a) * r);
    bowlGroup.add(pylon);
  }

  // ── Static containment cage / net (world-fixed — does NOT spin) ──
  const CAGE_RADIUS = ARENA_RADIUS + 1.2; // ~46.2
  const CAGE_HEIGHT = 18;
  const CAGE_Y = CAGE_HEIGHT / 2 + 0.5;
  const cageGroup = new THREE.Group();
  cageGroup.name = 'cage';
  group.add(cageGroup);

  const netShell = new THREE.Mesh(
    new THREE.CylinderGeometry(CAGE_RADIUS, CAGE_RADIUS, CAGE_HEIGHT, 72, 1, true),
    netMat,
  );
  netShell.position.y = CAGE_Y;
  cageGroup.add(netShell);

  const BAR_COUNT = 32;
  for (let i = 0; i < BAR_COUNT; i++) {
    const a = (i / BAR_COUNT) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, CAGE_HEIGHT, 0.2), netBarMat);
    bar.position.set(Math.cos(a) * CAGE_RADIUS, CAGE_Y, Math.sin(a) * CAGE_RADIUS);
    cageGroup.add(bar);
  }
  [3, 7, 11, 15, 18].forEach((y) => {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(CAGE_RADIUS, 0.12, 8, 72), netBarMat);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    cageGroup.add(hoop);
  });
  const topLip = new THREE.Mesh(new THREE.TorusGeometry(CAGE_RADIUS, 0.32, 10, 72), accentB);
  topLip.rotation.x = Math.PI / 2;
  topLip.position.y = CAGE_HEIGHT + 0.5;
  cageGroup.add(topLip);

  /** Solid floor playable area — single cylinder tagged floor (NOT hollow) */
  const floorCol = {
    type: 'cylinder',
    id: 'bowl_floor',
    tag: 'floor',
    position: { x: 0, y: 0.15, z: 0 },
    radius: FLOOR_RADIUS,
    height: 0.3,
    rotation: { x: 0, y: 0, z: 0 },
    restitution: 0.35,
  };
  colliders.push(floorCol);
  rotatingColliderIds.add(floorCol.id);

  /** Hollow rim wall (spins with dish) — hollow:true so physics can skip solid shove */
  const rimCol = {
    type: 'cylinder',
    id: 'bowl_rim',
    tag: 'rim',
    position: { x: 0, y: DISH_HEIGHT, z: 0 },
    radius: ARENA_RADIUS + 0.5,
    height: 1.0,
    rotation: { x: 0, y: 0, z: 0 },
    restitution: 0.45,
    hollow: true,
    innerRadius: ARENA_RADIUS - 0.6,
  };
  colliders.push(rimCol);
  rotatingColliderIds.add(rimCol.id);

  // Slope bands — hollow rings rotate with dish
  [18, 28, 36, 42].forEach((r, i) => {
    const id = `bowl_band_${i}`;
    const y = Math.pow(r / ARENA_RADIUS, 2.1) * DISH_HEIGHT * 0.55 + 0.8;
    colliders.push({
      type: 'cylinder',
      id,
      tag: 'bowl',
      position: { x: 0, y, z: 0 },
      radius: r,
      height: 0.55,
      rotation: { x: 0, y: 0, z: 0 },
      restitution: 0.35,
      hollow: true,
      innerRadius: r - 2.5,
    });
    rotatingColliderIds.add(id);
  });

  // Podium collider (rotates with dish)
  const podiumCol = {
    type: 'cylinder',
    id: 'podium',
    tag: 'obstacle',
    position: { x: 0, y: 0.4, z: 0 },
    radius: 3.9,
    height: 0.65,
    rotation: { x: 0, y: 0, z: 0 },
    restitution: 0.3,
  };
  colliders.push(podiumCol);
  rotatingColliderIds.add(podiumCol.id);

  // Cage: box segments around perimeter (static, tall)
  const WALL_SEGS = 20;
  const wallDepth = 0.6;
  const wallWidth = (2 * Math.PI * CAGE_RADIUS) / WALL_SEGS + 0.2;
  for (let i = 0; i < WALL_SEGS; i++) {
    const a = (i / WALL_SEGS) * Math.PI * 2;
    const x = Math.cos(a) * CAGE_RADIUS;
    const z = Math.sin(a) * CAGE_RADIUS;
    colliders.push({
      type: 'box',
      id: `cage_wall_${i}`,
      tag: 'wall',
      kind: 'cage',
      position: { x, y: CAGE_Y, z },
      size: { x: wallWidth, y: CAGE_HEIGHT, z: wallDepth },
      rotation: { x: 0, y: -a + Math.PI / 2, z: 0 },
      restitution: 0.25,
    });
  }
  colliders.push({
    type: 'cylinder',
    id: 'cage_top_ring',
    tag: 'wall',
    kind: 'cage',
    position: { x: 0, y: CAGE_HEIGHT + 0.4, z: 0 },
    radius: CAGE_RADIUS + 0.35,
    height: 0.6,
    rotation: { x: 0, y: 0, z: 0 },
    restitution: 0.2,
    hollow: true,
    innerRadius: CAGE_RADIUS - 1.4,
  });

  const spawnPoints = spawnRing(8, 9, 1.0, ['red', 'blue']);

  // Dense mid-radius mystery boxes (~28) on mid rings
  const mysteryBoxSpawns = [];
  const mbRadii = [12, 18, 24, 32];
  let mbIdx = 0;
  for (const r of mbRadii) {
    const count = r < 16 ? 6 : r < 22 ? 6 : 8;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (r > 20 ? 0.18 : 0);
      const y = Math.pow(r / ARENA_RADIUS, 2.1) * DISH_HEIGHT + 1.15;
      mysteryBoxSpawns.push({
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        id: `mb_bey_${mbIdx++}`,
      });
    }
  }

  /**
   * Smooth Y-spin of the dish + mild centrifugal for grounded karts.
   * Cage stays world-fixed. Root group is never repositioned.
   */
  function update(delta, world = {}) {
    const dt = clampDt(delta);
    bowlGroup.rotation.y += angularVelocity * dt;

    for (const c of colliders) {
      if (!rotatingColliderIds.has(c.id)) continue;
      if (!c.rotation) c.rotation = { x: 0, y: 0, z: 0 };
      c.rotation.y = bowlGroup.rotation.y;
    }

    const ctx = world || {};
    const list = ctx.karts || ctx.players || [];
    for (const item of list) {
      const pos = item.state?.position || item.position;
      const vel = item.state?.velocity || item.velocity;
      if (!pos) continue;
      const grounded =
        item.state?.grounded !== undefined ? item.state.grounded : (pos.y ?? 0) < 6.0;
      if (!grounded) continue;
      const dx = pos.x ?? 0;
      const dz = pos.z ?? 0;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r < 0.25 || r > ARENA_RADIUS) continue;
      const mag = angularVelocity * angularVelocity * r * centrifugalScale;
      const inv = 1 / r;
      const ax = dx * inv * mag;
      const az = dz * inv * mag;
      if (typeof ctx.applyForce === 'function') {
        ctx.applyForce(item.id ?? item.state?.id ?? 'local', { x: ax, y: 0, z: az });
      } else if (vel) {
        vel.x = (vel.x || 0) + ax * dt;
        vel.z = (vel.z || 0) + az * dt;
      }
    }
  }

  return {
    name,
    id: 'beybladeArena',
    group,
    colliders,
    spawnPoints,
    mysteryBoxSpawns,
    arenaRadius: ARENA_RADIUS,
    cageRadius: CAGE_RADIUS,
    update,
    setAngularVelocity(v) {
      angularVelocity = v;
    },
    getAngularVelocity() {
      return angularVelocity;
    },
    dispose() {
      disposeObject3D(group);
      disposables.forEach((d) => d.dispose?.());
    },
  };
}

/** Convenience map of id → loader */
export const LOADERS = {
  gravelPit: loadGravelPit,
  skyPinball: loadSkyPinball,
  beybladeArena: loadBeybladeArena,
};

/**
 * Dispatcher — load map by id (gravelPit | skyPinball | beybladeArena).
 * @param {any} THREE
 * @param {string} mapId
 */
export function loadMap(THREE, mapId) {
  const id = LOADERS[mapId] ? mapId : 'gravelPit';
  return LOADERS[id](THREE);
}

export function createMapById(id, THREE) {
  return loadMap(THREE, id);
}

export default {
  loadGravelPit,
  loadSkyPinball,
  loadBeybladeArena,
  loadMap,
  createMapById,
  LOADERS,
};
