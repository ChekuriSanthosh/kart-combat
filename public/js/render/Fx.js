/**
 * Everything that is not a kart or the arena: mystery crates, projectiles in
 * flight, explosions, pickups, hit sparks, tyre smoke, skid marks and the
 * smoke that pours off a wreck.
 *
 * None of this decides anything. The server owns pickups, damage and blasts;
 * this module only draws what the snapshots and event stream describe, plus
 * the purely cosmetic trails left by the karts main.js hands to trackKarts().
 *
 * The look follows the original's cartoon effects: smoke and explosions are
 * clusters of chunky round puffs that swell and shrink away rather than
 * translucent billboards, pickups burst into stars, and tyres leave dark
 * marks that linger on the floor for a few seconds. Puffs, stars and skid
 * marks are each one pooled InstancedMesh, so a busy fifteen-kart brawl costs
 * three draw calls for all of it instead of hundreds of separate meshes.
 */

import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { disposeTree } from './materials.js';

/* ── Mystery crate ────────────────────────────────────────────────────── */

/**
 * One face of the crate: a red-orange box with a bevelled rim, a yellow inset
 * panel and a fat blue question mark — the same on all six sides, so it reads
 * as a mystery box from any angle while it tumbles.
 */
let crateTexture = null;
function crateFace() {
  if (crateTexture) return crateTexture;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  const rounded = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // Body with a darker rim: on a hard-edged cube this is what makes it look
  // like a chunky rounded toy box instead of a texture on a box.
  ctx.fillStyle = '#d9481c';
  ctx.fillRect(0, 0, S, S);
  const body = ctx.createLinearGradient(0, 0, 0, S);
  body.addColorStop(0, '#ff8048');
  body.addColorStop(1, '#ff5a2a');
  ctx.fillStyle = body;
  rounded(10, 10, S - 20, S - 20, 34);
  ctx.fill();

  // Yellow inset panel.
  ctx.fillStyle = '#ffd23f';
  rounded(40, 40, S - 80, S - 80, 26);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#f5a623';
  ctx.stroke();

  // The question mark: blue with a white rim, slightly tilted like a sticker.
  ctx.save();
  ctx.translate(S / 2, S / 2 + 8);
  ctx.rotate(-0.12);
  ctx.font = '900 168px "Baloo 2", "Arial Black", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 20;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText('?', 0, 0);
  ctx.fillStyle = '#2f6bff';
  ctx.fillText('?', 0, 0);
  ctx.restore();

  crateTexture = new THREE.CanvasTexture(canvas);
  crateTexture.colorSpace = THREE.SRGBColorSpace;
  crateTexture.anisotropy = 4;
  return crateTexture;
}

const CRATE_SIZE = 1.2;
const CRATE_HOVER = 1.15;

/** Soft round shadow used under floating things (crates), shared by all. */
let blobGeometry = null;
let blobMaterial = null;
function blobShadow() {
  if (!blobGeometry) {
    blobGeometry = new THREE.CircleGeometry(0.72, 24);
    blobGeometry.rotateX(-Math.PI / 2);
    blobMaterial = new THREE.MeshBasicMaterial({
      color: 0x1c2340, transparent: true, opacity: 0.24, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }
  const m = new THREE.Mesh(blobGeometry, blobMaterial.clone());
  m.position.y = 0.04;
  m.renderOrder = 1;
  return m;
}

function crateMesh() {
  const g = new THREE.Group();
  const map = crateFace();
  // Lambert keeps it flat and bright like the rest of the toy kit; a touch of
  // the texture fed back as emissive stops the shaded side going muddy.
  const material = new THREE.MeshLambertMaterial({
    map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.22,
  });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE), material);
  cube.castShadow = true;
  cube.name = 'cube';
  g.add(cube);

  const shadow = blobShadow();
  shadow.name = 'shadow';
  g.add(shadow);
  return g;
}

/* ── Projectiles ──────────────────────────────────────────────────────── */

const lambert = (color, emissive = 0) => new THREE.MeshLambertMaterial({
  color, emissive: color, emissiveIntensity: emissive,
});

function projectileMesh(def) {
  const g = new THREE.Group();
  const color = def.color;

  switch (def.mesh) {
    case 'rocket': {
      // A chunky toy rocket: bright body, white nose band, red fins, flame.
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.62, 4, 12), lambert(color, 0.25));
      body.rotation.x = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.36, 12), lambert(0xffffff, 0.2));
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.56;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.1, 12), lambert(0xffd23f, 0.3));
      band.rotation.x = Math.PI / 2;
      band.position.z = 0.22;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.7, 10), lambert(0xffa31a, 1.4));
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = -0.62;
      flame.name = 'flame';
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.26), lambert(0xff3b3b, 0.2));
        fin.position.set(Math.cos(a) * 0.22, Math.sin(a) * 0.22, -0.32);
        fin.rotation.z = a + Math.PI / 2;
        g.add(fin);
      }
      g.add(body, nose, band, flame);
      g.userData.trail = 0xf2f2f2;
      break;
    }
    case 'bullet': {
      // A short glowing tracer along the direction of travel.
      const tracer = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.07, 0.6, 3, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe14d }),
      );
      tracer.rotation.x = Math.PI / 2;
      g.add(tracer);
      break;
    }
    case 'snowball':
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), lambert(color, 0.6)));
      g.userData.trail = 0xd9f4ff;
      break;
    case 'bomb': {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), lambert(0x23263a, 0.05));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.14, 10), lambert(0x9aa3b5));
      cap.position.y = 0.42;
      const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      fuse.position.y = 0.56;
      fuse.name = 'flame';
      g.add(ball, cap, fuse);
      break;
    }
    case 'mine': {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.22, 14), lambert(0x2b2f45, 0.05));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.08, 14), lambert(color, 0.15));
      top.position.y = 0.14;
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
      light.position.y = 0.22;
      light.name = 'blink';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), lambert(0xffffff));
        spike.position.set(Math.cos(a) * 0.5, 0.04, Math.sin(a) * 0.5);
        spike.rotation.z = -Math.PI / 2;
        spike.rotation.y = -a;
        g.add(spike);
      }
      g.add(disc, top, light);
      break;
    }
    default:
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), lambert(color, 0.6)));
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/* ── Pooled instanced particles ───────────────────────────────────────── */

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpColor = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * A fixed-size ring of particles drawn as one InstancedMesh. Spawning past
 * capacity recycles the oldest slot, so a pile-up can never allocate or grow
 * the draw cost; it just trims the longest-lived particles a little early.
 *
 * Particles shrink to nothing instead of fading: instancing shares one
 * material, and a cartoon puff that pops away looks right anyway.
 */
function createParticlePool(scene, geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false; // instances span the arena; the bounds would be wrong
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < capacity; i++) {
    mesh.setMatrixAt(i, HIDDEN);
    mesh.setColorAt(i, tmpColor.set(0xffffff));
  }
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const parts = Array.from({ length: capacity }, () => ({
    alive: false, t: 0, life: 1,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, drag: 0, rise: 0,
    size: 1, grow: 0.3, spin: 0, rx: 0, ry: 0, rz: 0,
    color: new THREE.Color(), fade: null,
  }));
  let next = 0;

  return {
    mesh,
    spawn(o) {
      const p = parts[next];
      next = (next + 1) % capacity;
      p.alive = true;
      p.t = 0;
      p.life = o.life;
      p.x = o.x; p.y = o.y; p.z = o.z;
      p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
      p.drag = o.drag ?? 2;
      p.rise = o.rise ?? 0;
      p.size = o.size;
      p.grow = o.grow ?? 0.3;
      p.spin = o.spin ?? 0;
      p.rx = Math.random() * Math.PI * 2;
      p.ry = Math.random() * Math.PI * 2;
      p.rz = Math.random() * Math.PI * 2;
      p.color.set(o.color);
      p.fade = o.fade == null ? null : tmpColor.set(o.fade).clone();
    },
    update(dt) {
      for (let i = 0; i < capacity; i++) {
        const p = parts[i];
        if (!p.alive) continue;
        p.t += dt;
        const k = p.t / p.life;
        if (k >= 1) {
          p.alive = false;
          mesh.setMatrixAt(i, HIDDEN);
          continue;
        }
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp; p.vy = p.vy * damp + p.rise * dt; p.vz *= damp;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;

        // Pop in fast, swell a little, then shrink away over the last stretch.
        const swell = Math.min(1, k / 0.15);
        const shrink = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
        const s = p.size * (0.35 + 0.65 * swell) * (1 + p.grow * k) * shrink * shrink;
        tmpEuler.set(p.rx, p.ry, p.rz);
        tmpQuat.setFromEuler(tmpEuler);
        tmpMatrix.compose(tmpPos.set(p.x, p.y, p.z), tmpQuat, tmpScale.set(s, s, s));
        mesh.setMatrixAt(i, tmpMatrix);
        if (p.fade) mesh.setColorAt(i, tmpColor.copy(p.color).lerp(p.fade, k));
        else mesh.setColorAt(i, p.color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
    clear() {
      for (let i = 0; i < capacity; i++) { parts[i].alive = false; mesh.setMatrixAt(i, HIDDEN); }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    },
  };
}

/** A chunky five-pointed star, thin enough to read as a sticker as it spins. */
function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.45;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
  g.center();
  return g;
}

/* ── Skid marks ───────────────────────────────────────────────────────── */

const SKID_CAPACITY = 1400;
const SKID_LIFE = 6;
const SKID_FADE = 1.6;   // the last seconds of a mark's life, spent thinning out
const SKID_WIDTH = 0.3;

/* Rear wheel contact points in kart space (+z is forward). */
const REAR_AXLE = -1.0;
const REAR_TRACK = 0.74;

function createSkids(scene) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0x1a1d2b, transparent: true, opacity: 0.32, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, SKID_CAPACITY);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < SKID_CAPACITY; i++) mesh.setMatrixAt(i, HIDDEN);
  scene.add(mesh);

  // Each mark keeps the pose it was laid with so it can thin out in place.
  const marks = Array.from({ length: SKID_CAPACITY }, () => ({
    born: -1e9, x: 0, y: 0, z: 0, yaw: 0, len: 0,
  }));
  let next = 0;
  let dirty = false;

  function place(i, m, widthScale) {
    tmpQuat.setFromAxisAngle(UP, m.yaw);
    tmpMatrix.compose(tmpPos.set(m.x, m.y, m.z), tmpQuat, tmpScale.set(SKID_WIDTH * widthScale, 1, m.len));
    mesh.setMatrixAt(i, tmpMatrix);
  }

  return {
    /** Lay one segment from (ax,az) to (bx,bz) at height y. */
    lay(ax, az, bx, bz, y, now) {
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) return;
      const m = marks[next];
      m.born = now;
      m.x = (ax + bx) / 2;
      m.y = y;
      m.z = (az + bz) / 2;
      m.yaw = Math.atan2(dx, dz);
      // A hair longer than the gap so consecutive segments overlap seamlessly.
      m.len = len + 0.06;
      place(next, m, 1);
      next = (next + 1) % SKID_CAPACITY;
      dirty = true;
    },
    update(now) {
      for (let i = 0; i < SKID_CAPACITY; i++) {
        const m = marks[i];
        const age = now - m.born;
        if (age < SKID_LIFE - SKID_FADE) continue;
        if (age >= SKID_LIFE) {
          if (m.len) { mesh.setMatrixAt(i, HIDDEN); m.len = 0; dirty = true; }
          continue;
        }
        place(i, m, (SKID_LIFE - age) / SKID_FADE);
        dirty = true;
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
      dirty = false;
    },
    clear() {
      for (let i = 0; i < SKID_CAPACITY; i++) { marks[i].born = -1e9; marks[i].len = 0; mesh.setMatrixAt(i, HIDDEN); }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

/* ── The effects layer ────────────────────────────────────────────────── */

const PUFF_COLORS = {
  tyre: 0xeef0f5,
  wreck: 0x4a4e5c,
  trail: 0xf2f2f2,
  fireHot: 0xffe066,
  fireMid: 0xff9a1f,
  fireOut: 0x6d6f7a,
};

export function createFx(scene, boxPositions) {
  // ── Mystery crates ──
  const crates = boxPositions.map((p, i) => {
    const mesh = crateMesh();
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    return {
      mesh,
      cube: mesh.getObjectByName('cube'),
      shadow: mesh.getObjectByName('shadow'),
      base: p.y,
      // Staggered so a ring of crates ripples instead of moving in lockstep.
      phase: (i * 2.399) % (Math.PI * 2),
      alive: true,
      // <1 while popping in.
      pop: 1,
    };
  });

  // ── Live projectiles, keyed by the server's id ──
  const shots = new Map();

  // ── Pools ──
  const puffs = createParticlePool(
    scene,
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshLambertMaterial({ flatShading: true }),
    520,
  );
  const stars = createParticlePool(
    scene,
    starGeometry(),
    new THREE.MeshBasicMaterial(),
    120,
  );
  const skids = createSkids(scene);

  // Ground rings that race outwards from a blast. Few at a time; pooled.
  const ringGeometry = new THREE.RingGeometry(0.82, 1, 40);
  ringGeometry.rotateX(-Math.PI / 2);
  const rings = [];

  const flashLight = new THREE.PointLight(0xffaa44, 0, 30, 2);
  scene.add(flashLight);

  // Karts to trail this frame, from trackKarts(), and what each laid last.
  let tracked = [];
  const trails = new Map();
  let clock = 0;

  /* A cluster of fire puffs that cools to grey smoke: the cartoon explosion. */
  function explosion(x, y, z, radius) {
    const n = Math.round(10 + radius * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.15 + Math.random() * 0.5);
      const hot = i < n * 0.45;
      puffs.spawn({
        x: x + Math.cos(a) * r * 0.4, y: y + 0.4 + Math.random() * 0.8, z: z + Math.sin(a) * r * 0.4,
        vx: Math.cos(a) * r * 3.2, vy: 2 + Math.random() * 4, vz: Math.sin(a) * r * 3.2,
        drag: 4.2, rise: 1.5,
        size: radius * (0.22 + Math.random() * 0.18),
        grow: 0.8,
        life: 0.55 + Math.random() * 0.5,
        color: hot ? PUFF_COLORS.fireHot : PUFF_COLORS.fireMid,
        fade: PUFF_COLORS.fireOut,
        spin: 1.5,
      });
    }
    ring(x, y + 0.06, z, radius * 1.3, 0xfff1c4);
    flashLight.position.set(x, y + 1.2, z);
    flashLight.intensity = 70;
  }

  function ring(x, y, z, radius, color) {
    const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.2);
    scene.add(mesh);
    rings.push({ mesh, t: 0, life: 0.35, radius });
  }

  /* White and mint stars bursting up and out: the pickup "you got something". */
  function starBurst(x, y, z, count = 9, colors = [0xffffff, 0xb8ffcf, 0xfff3a0]) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 3.5 + Math.random() * 2.5;
      stars.spawn({
        x, y, z,
        vx: Math.cos(a) * sp, vy: 3 + Math.random() * 3, vz: Math.sin(a) * sp,
        drag: 3.5, rise: -4,
        size: 0.22 + Math.random() * 0.12,
        grow: 0.2,
        life: 0.55 + Math.random() * 0.25,
        color: colors[i % colors.length],
        spin: 6,
      });
    }
  }

  function sparks(x, y, z, color) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      stars.spawn({
        x, y, z,
        vx: Math.cos(a) * 5, vy: 2 + Math.random() * 3, vz: Math.sin(a) * 5,
        drag: 5, rise: -6, size: 0.14, grow: 0, life: 0.3, color, spin: 9,
      });
    }
  }

  /* Tyre smoke and skid marks for one kart this frame. */
  function trailKart(k, dt) {
    const sin = Math.sin(k.yaw);
    const cos = Math.cos(k.yaw);
    // Rear wheel contact points in world space (+z forward, +x to the left).
    const lx = k.x + REAR_AXLE * sin + REAR_TRACK * cos;
    const lz = k.z + REAR_AXLE * cos - REAR_TRACK * sin;
    const rx = k.x + REAR_AXLE * sin - REAR_TRACK * cos;
    const rz = k.z + REAR_AXLE * cos + REAR_TRACK * sin;

    let st = trails.get(k.id);
    if (!st) { st = { lx, lz, rx, rz, laying: false, smoke: 0, wreckSmoke: 0 }; trails.set(k.id, st); }

    if (!k.alive) {
      // A wreck smoulders: dark puffs rolling up off it until it respawns.
      st.laying = false;
      st.wreckSmoke += dt * 7;
      while (st.wreckSmoke >= 1) {
        st.wreckSmoke -= 1;
        puffs.spawn({
          x: k.x + (Math.random() - 0.5) * 0.8, y: k.y + 0.9, z: k.z + (Math.random() - 0.5) * 0.8,
          vx: (Math.random() - 0.5) * 0.6, vy: 1.6 + Math.random(), vz: (Math.random() - 0.5) * 0.6,
          drag: 1.2, rise: 0.6, size: 0.42 + Math.random() * 0.3, grow: 1.4,
          life: 1.5 + Math.random() * 0.6, color: PUFF_COLORS.wreck, fade: 0x9a9eab, spin: 0.8,
        });
      }
      st.lx = lx; st.lz = lz; st.rx = rx; st.rz = rz;
      return;
    }

    // Marks and smoke while sliding: drifting, or cornering hard at speed.
    const speed = Math.abs(k.speed || 0);
    const sliding = k.grounded && speed > 7 && (k.drifting || Math.abs(k.yawRate || 0) > 1.5);
    const jumped = Math.hypot(lx - st.lx, lz - st.lz) > 2.5; // respawn or teleport
    if (sliding && st.laying && !jumped) {
      const y = k.y + 0.04;
      skids.lay(st.lx, st.lz, lx, lz, y, clock);
      skids.lay(st.rx, st.rz, rx, rz, y, clock);
    }
    st.laying = sliding;

    if (sliding) {
      st.smoke += dt * (k.drifting ? 22 : 12);
      while (st.smoke >= 1) {
        st.smoke -= 1;
        const left = Math.random() < 0.5;
        puffs.spawn({
          x: left ? lx : rx, y: k.y + 0.3, z: left ? lz : rz,
          vx: -sin * 1.5 + (Math.random() - 0.5) * 1.2, vy: 0.8 + Math.random() * 0.8, vz: -cos * 1.5 + (Math.random() - 0.5) * 1.2,
          drag: 2.5, rise: 0.4, size: 0.32 + Math.random() * 0.2, grow: 1.1,
          life: 0.55 + Math.random() * 0.3, color: PUFF_COLORS.tyre, spin: 1,
        });
      }
    } else {
      st.smoke = 0;
    }
    st.lx = lx; st.lz = lz; st.rx = rx; st.rz = rz;
  }

  return {
    /** `dead` is the list of crate indices the server says are collected. */
    syncCrates(dead) {
      const deadSet = new Set(dead);
      crates.forEach((c, i) => {
        const shouldLive = !deadSet.has(i);
        if (shouldLive === c.alive) return;
        if (shouldLive) {
          c.pop = 0.01; // grows back with an overshoot
        } else {
          // The crate bursts into stars where it stood.
          const p = c.mesh.position;
          starBurst(p.x, c.base + CRATE_HOVER, p.z, 10);
          for (let k = 0; k < 4; k++) {
            puffs.spawn({
              x: p.x, y: c.base + CRATE_HOVER, z: p.z,
              vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3,
              drag: 4, size: 0.35, grow: 0.8, life: 0.45, color: 0xffffff, spin: 1,
            });
          }
        }
        c.alive = shouldLive;
      });
    },

    syncProjectiles(list) {
      const seen = new Set();
      for (const p of list) {
        seen.add(p.i);
        let entry = shots.get(p.i);
        if (!entry) {
          const def = WEAPONS[p.w];
          if (!def) continue;
          const mesh = projectileMesh(def);
          mesh.position.set(p.x, p.y, p.z);
          scene.add(mesh);
          entry = {
            mesh,
            def,
            target: new THREE.Vector3(p.x, p.y, p.z),
            flame: mesh.getObjectByName('flame'),
            blink: mesh.getObjectByName('blink'),
            trail: mesh.userData.trail,
            puff: 0,
          };
          shots.set(p.i, entry);
        }
        entry.target.set(p.x, p.y, p.z);
        entry.mesh.rotation.y = p.a;
      }
      for (const [id, entry] of shots) {
        if (seen.has(id)) continue;
        scene.remove(entry.mesh);
        disposeTree(entry.mesh);
        shots.delete(id);
      }
    },

    /**
     * Karts to leave tyre marks, tyre smoke and wreck smoke for, this frame:
     * [{ id, x, y, z, yaw, speed, yawRate, drifting, grounded, alive }].
     */
    trackKarts(list) {
      tracked = list;
    },

    handleEvent(e) {
      if (e.t === 'blast') {
        explosion(e.x, e.y, e.z, Math.max(2, e.r ?? 4));
      } else if (e.t === 'spark') {
        sparks(e.x, e.y + 0.5, e.z, WEAPONS[e.w]?.color ?? 0xffe14d);
      } else if (e.t === 'kill') {
        // The kart goes up in a small fireball; trackKarts keeps the wreck
        // smoking afterwards. No big translucent shell: it used to wash a
        // disc of colour over the very view the death message sits on.
        explosion(e.x, e.y, e.z, 2.4);
      } else if (e.t === 'pickup') {
        starBurst(e.x, e.y + 1, e.z, 8);
      }
    },

    update(dt, elapsed) {
      clock = elapsed;

      for (const c of crates) {
        c.mesh.visible = c.alive;
        if (!c.alive) continue;

        // A lazy tumble and a bob, like a toy hanging on a string: always
        // moving, so it catches the eye across the arena, never frantic.
        const bob = Math.sin(elapsed * 2.0 + c.phase);
        c.cube.position.y = CRATE_HOVER + bob * 0.2;
        c.cube.rotation.y += dt * 1.1;
        c.cube.rotation.x = Math.sin(elapsed * 0.9 + c.phase) * 0.35;
        c.cube.rotation.z = Math.cos(elapsed * 0.7 + c.phase) * 0.3;

        // The shadow shrinks and fades as the crate rises.
        c.shadow.scale.setScalar(1 - bob * 0.1);
        c.shadow.material.opacity = 0.24 - bob * 0.05;

        if (c.pop < 1) {
          c.pop = Math.min(1, c.pop + dt * 3.6);
          // A single clean overshoot, then settle exactly on 1.
          const t = c.pop;
          c.mesh.scale.setScalar(t * (1 + Math.sin(t * Math.PI) * 0.25));
        } else if (c.mesh.scale.x !== 1) {
          c.mesh.scale.setScalar(1);
        }
      }

      for (const entry of shots.values()) {
        // Snapshots land at 20 Hz; glide between them so shots do not stutter.
        entry.mesh.position.lerp(entry.target, 1 - Math.exp(-28 * dt));
        if (entry.flame) entry.flame.scale.setScalar(0.75 + Math.random() * 0.5);
        if (entry.blink) entry.blink.visible = Math.sin(elapsed * 10) > -0.2;
        if (entry.trail != null) {
          entry.puff += dt * 26;
          while (entry.puff >= 1) {
            entry.puff -= 1;
            const p = entry.mesh.position;
            puffs.spawn({
              x: p.x, y: p.y, z: p.z,
              vx: (Math.random() - 0.5) * 0.6, vy: 0.4, vz: (Math.random() - 0.5) * 0.6,
              drag: 3, size: 0.2 + Math.random() * 0.1, grow: 1.4, life: 0.5, color: entry.trail, spin: 1,
            });
          }
        }
      }

      for (const k of tracked) trailKart(k, dt);
      // Forget karts that left so a returning id does not draw a mark across the map.
      if (trails.size > tracked.length) {
        const live = new Set(tracked.map((k) => k.id));
        for (const id of trails.keys()) if (!live.has(id)) trails.delete(id);
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) {
          scene.remove(r.mesh);
          r.mesh.material.dispose();
          rings.splice(i, 1);
          continue;
        }
        r.mesh.scale.setScalar(r.radius * (0.2 + (1 - (1 - k) * (1 - k)) * 0.8));
        r.mesh.material.opacity = 0.8 * (1 - k);
      }

      flashLight.intensity *= Math.exp(-9 * dt);
      if (flashLight.intensity < 0.5) flashLight.intensity = 0;

      puffs.update(dt);
      stars.update(dt);
      skids.update(elapsed);
    },

    dispose() {
      for (const c of crates) {
        scene.remove(c.mesh);
        c.shadow.material.dispose();
        c.cube.geometry.dispose();
        c.cube.material.dispose();
      }
      crates.length = 0;
      for (const entry of shots.values()) { scene.remove(entry.mesh); disposeTree(entry.mesh); }
      shots.clear();
      for (const r of rings) { scene.remove(r.mesh); r.mesh.material.dispose(); }
      rings.length = 0;
      ringGeometry.dispose();
      puffs.dispose();
      stars.dispose();
      skids.dispose();
      trails.clear();
      scene.remove(flashLight);
    },
  };
}
