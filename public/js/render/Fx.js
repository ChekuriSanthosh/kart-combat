/**
 * Everything that is not a kart or the arena: mystery crates, projectiles in
 * flight, explosions, pickups and hit sparks.
 *
 * None of this decides anything. The server owns pickups, damage and blasts;
 * this module only draws what the snapshots and event stream describe.
 */

import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { disposeTree } from './materials.js';

/** Canvas texture for the crate faces: a fat question mark on a bright panel. */
let questionTexture = null;
function questionMark() {
  if (questionTexture) return questionTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#fff6d8');
  grad.addColorStop(1, '#ffd24a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 120, 120);

  ctx.font = 'bold 92px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#7a4a00';
  ctx.strokeText('?', 64, 70);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('?', 64, 70);

  questionTexture = new THREE.CanvasTexture(canvas);
  questionTexture.colorSpace = THREE.SRGBColorSpace;
  questionTexture.anisotropy = 4;
  return questionTexture;
}

/**
 * The mystery crate. A floating question-mark cube with a glow disc on the
 * ground beneath it, so players can spot one across the arena and still judge
 * where it actually sits.
 */
function crateMesh(color) {
  const g = new THREE.Group();

  const cube = new THREE.Group();
  cube.name = 'cube';
  g.add(cube);

  const panel = new THREE.MeshStandardMaterial({
    map: questionMark(),
    color,
    roughness: 0.35,
    metalness: 0.15,
    emissive: color,
    emissiveIntensity: 0.45,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), panel);
  body.castShadow = true;
  cube.add(body);

  // Chunky edge trim reads well at a distance and hides the cube's hard seams.
  const trim = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.25, metalness: 0.5,
    emissive: 0xfff0b0, emissiveIntensity: 0.55,
  });
  for (const axis of ['x', 'y', 'z']) {
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(
          axis === 'x' ? 1.18 : 0.11,
          axis === 'y' ? 1.18 : 0.11,
          axis === 'z' ? 1.18 : 0.11,
        ), trim);
        if (axis === 'x') bar.position.set(0, a * 0.56, b * 0.56);
        else if (axis === 'y') bar.position.set(a * 0.56, 0, b * 0.56);
        else bar.position.set(a * 0.56, b * 0.56, 0);
        cube.add(bar);
      }
    }
  }

  // Ground glow so the crate's position is unambiguous while it floats.
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 28),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.32, depthWrite: false,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.04;
  halo.name = 'halo';
  g.add(halo);

  return g;
}

function projectileMesh(def) {
  const g = new THREE.Group();
  const color = def.color;
  const glow = (c, i = 0.8) => new THREE.MeshStandardMaterial({
    color: c, emissive: c, emissiveIntensity: i, roughness: 0.35, metalness: 0.2,
  });

  switch (def.mesh) {
    case 'rocket': {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 4, 10), glow(color, 0.4));
      body.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.34, 10), glow(0xffcc33, 1.0));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.48;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.6, 8), glow(0xff8800, 1.6));
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = -0.5;
      flame.name = 'flame';
      for (let i = 0; i < 3; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.2), glow(0xdddddd, 0.2));
        fin.position.z = -0.28;
        fin.rotation.z = (i / 3) * Math.PI * 2;
        fin.position.x = Math.cos((i / 3) * Math.PI * 2) * 0.17;
        fin.position.y = Math.sin((i / 3) * Math.PI * 2) * 0.17;
        g.add(fin);
      }
      g.add(body, tip, flame);
      break;
    }
    case 'bullet':
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), glow(color, 1.4)));
      break;
    case 'snowball':
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), glow(color, 0.7)));
      break;
    case 'bomb': {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 }));
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 6), glow(0xffaa33, 1.4));
      fuse.position.y = 0.48;
      fuse.name = 'flame';
      g.add(ball, fuse);
      break;
    }
    case 'mine': {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.2, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.4 }));
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), glow(0xff2222, 2));
      light.position.y = 0.16;
      light.name = 'flame';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), glow(0x999999, 0.1));
        spike.position.set(Math.cos(a) * 0.46, 0.06, Math.sin(a) * 0.46);
        spike.rotation.z = -Math.PI / 2;
        spike.rotation.y = -a;
        g.add(spike);
      }
      g.add(disc, light);
      break;
    }
    default:
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), glow(color)));
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function createFx(scene, boxPositions) {
  const CRATE_COLORS = [0xff3b5c, 0x4ecdc4, 0xa55eea, 0x45aaf2, 0xfebf2f, 0x26de81];

  // ── Mystery crates ──
  const crates = boxPositions.map((p, i) => {
    const color = CRATE_COLORS[i % CRATE_COLORS.length];
    const mesh = crateMesh(color);
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    return {
      mesh,
      color,
      cube: mesh.getObjectByName('cube'),
      halo: mesh.getObjectByName('halo'),
      base: p.y,
      // Staggered so a ring of crates ripples instead of pulsing in lockstep.
      phase: (i * 2.399) % (Math.PI * 2),
      alive: true,
      // <1 while popping in, >1 for the flash as it is taken.
      pop: 1,
    };
  });

  // ── Live projectiles, keyed by the server's id ──
  const shots = new Map();
  const bursts = [];
  const sparkPool = [];

  const flashLight = new THREE.PointLight(0xffaa44, 0, 30, 2);
  scene.add(flashLight);

  function makeSpark(color) {
    const spark = sparkPool.pop() || new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 6),
      new THREE.MeshStandardMaterial({ transparent: true }),
    );
    spark.material.color.set(color);
    spark.material.emissive.set(color);
    spark.material.emissiveIntensity = 1.6;
    spark.material.opacity = 1;
    spark.visible = true;
    return spark;
  }

  function burst(x, y, z, radius, color, count, life) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const bits = [];
    for (let i = 0; i < count; i++) {
      const spark = makeSpark(color);
      const dir = new THREE.Vector3(
        Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5,
      ).normalize().multiplyScalar(radius * (0.6 + Math.random() * 0.9));
      spark.position.set(0, 0, 0);
      spark.scale.setScalar(0.5 + Math.random());
      group.add(spark);
      bits.push({ spark, dir });
    }
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    group.add(shell);
    scene.add(group);
    bursts.push({ group, bits, shell, t: 0, life, radius });
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
          // Burst where it stood so grabbing one feels like an event.
          burst(c.mesh.position.x, c.base + 0.8, c.mesh.position.z, 1.8, c.color, 10, 0.4);
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
          entry = { mesh, def, target: new THREE.Vector3(p.x, p.y, p.z) };
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

    handleEvent(e) {
      if (e.t === 'blast') {
        const def = WEAPONS[e.w];
        burst(e.x, e.y, e.z, e.r, def?.color ?? 0xffaa33, 14, 0.55);
        flashLight.position.set(e.x, e.y + 1, e.z);
        flashLight.intensity = 60;
      } else if (e.t === 'spark') {
        const def = WEAPONS[e.w];
        burst(e.x, e.y, e.z, 1.2, def?.color ?? 0xffffff, 6, 0.3);
      } else if (e.t === 'kill') {
        burst(e.x, e.y + 0.6, e.z, 4.5, 0xffd166, 20, 0.8);
      } else if (e.t === 'pickup' || e.t === 'boxUp') {
        burst(e.x, e.y + 0.7, e.z, 1.6, 0x9ae6ff, 8, 0.35);
      }
    },

    update(dt, elapsed) {
      for (const c of crates) {
        c.mesh.visible = c.alive;
        if (!c.alive) continue;

        // One steady axis of spin and one gentle bob. Anything more reads as
        // noise; this is legible from across the arena and at a standstill.
        c.cube.rotation.y += dt * 1.2;
        const bob = Math.sin(elapsed * 2.0 + c.phase);
        c.cube.position.y = 1.1 + bob * 0.18;

        // The halo tracks the bob so the crate always looks anchored.
        c.halo.scale.setScalar(0.94 + bob * 0.06);
        c.halo.material.opacity = 0.26 - bob * 0.06;

        if (c.pop < 1) {
          c.pop = Math.min(1, c.pop + dt * 3.6);
          // A single clean overshoot, then settle exactly on 1.
          const t = c.pop;
          c.mesh.scale.setScalar(t * (1 + Math.sin(t * Math.PI) * 0.22));
        } else if (c.mesh.scale.x !== 1) {
          c.mesh.scale.setScalar(1);
        }
      }

      for (const entry of shots.values()) {
        // Snapshots land at 20 Hz; glide between them so shots do not stutter.
        entry.mesh.position.lerp(entry.target, 1 - Math.exp(-28 * dt));
        const flame = entry.mesh.getObjectByName('flame');
        if (flame) flame.scale.setScalar(0.7 + Math.random() * 0.6);
      }

      flashLight.intensity *= Math.exp(-9 * dt);
      if (flashLight.intensity < 0.5) flashLight.intensity = 0;

      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.t += dt;
        const k = b.t / b.life;
        if (k >= 1) {
          for (const bit of b.bits) {
            b.group.remove(bit.spark);
            bit.spark.visible = false;
            sparkPool.push(bit.spark);
          }
          scene.remove(b.group);
          b.shell.geometry.dispose();
          b.shell.material.dispose();
          bursts.splice(i, 1);
          continue;
        }
        const ease = 1 - (1 - k) * (1 - k);
        for (const bit of b.bits) {
          bit.spark.position.copy(bit.dir).multiplyScalar(ease);
          bit.spark.position.y -= ease * ease * b.radius * 0.35;
          bit.spark.material.opacity = 1 - k;
        }
        b.shell.scale.setScalar(b.radius * (0.3 + ease * 1.1));
        b.shell.material.opacity = 0.5 * (1 - k);
      }
    },

    dispose() {
      for (const c of crates) { scene.remove(c.mesh); disposeTree(c.mesh); }
      crates.length = 0;
      for (const entry of shots.values()) { scene.remove(entry.mesh); disposeTree(entry.mesh); }
      shots.clear();
      for (const b of bursts) { scene.remove(b.group); disposeTree(b.group); }
      bursts.length = 0;
      for (const s of sparkPool) disposeTree(s);
      sparkPool.length = 0;
      scene.remove(flashLight);
    },
  };
}
