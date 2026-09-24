/**
 * The kart: a chunky cartoon go-kart with a helmeted driver, plus the name and
 * health tag that floats above it.
 *
 * The group's origin sits at the point where the wheels touch the ground,
 * which is exactly what `state.y` means in the shared physics — so the mesh
 * lands where the simulation says it does.
 */

import * as THREE from 'three';
import { disposeTree } from './materials.js';

const WHEEL_R = 0.42;

function shade(hex, amount) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return c;
}

export function createKartMesh(color = 0xe74c3c, name = 'Player', { showTag = true } = {}) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12 });
  const darkMat = new THREE.MeshStandardMaterial({ color: shade(color, -0.18), roughness: 0.5 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2f3542, roughness: 0.6, metalness: 0.2 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe8edf3, roughness: 0.25, metalness: 0.85 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1f2026, roughness: 0.95 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf2c199, roughness: 0.8 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x101820, roughness: 0.1, metalness: 0.5,
    emissive: 0x2b4a6b, emissiveIntensity: 0.3,
  });
  const materials = [bodyMat, darkMat, trimMat, chromeMat, tyreMat, skinMat, visorMat];

  const add = (mesh, parent = body) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ── Chassis: a rounded tub with a tapered nose ──
  const tub = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.52, 2.0), bodyMat));
  tub.position.set(0, 0.52, 0);

  const nose = add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.36, 0.8), bodyMat));
  nose.position.set(0, 0.46, 1.25);

  const snout = add(new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.26, 0.4), darkMat));
  snout.position.set(0, 0.4, 1.7);

  // Side pods over the wheels
  for (const sx of [-1, 1]) {
    const pod = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 1.7), darkMat));
    pod.position.set(sx * 0.82, 0.5, 0);
  }

  // Rear engine block + exhausts
  const engine = add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.62), trimMat));
  engine.position.set(0, 0.78, -1.05);
  for (const sx of [-1, 1]) {
    const pipe = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 8), chromeMat));
    pipe.position.set(sx * 0.3, 1.1, -1.25);
    pipe.rotation.x = 0.45;
  }

  // Front bumper bar
  const bumper = add(new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.2, 0.22), trimMat));
  bumper.position.set(0, 0.3, 1.92);

  // ── Driver ──
  const seat = add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.18), trimMat));
  seat.position.set(0, 1.03, -0.6);

  const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.32, 4, 10), darkMat));
  torso.position.set(0, 1.14, -0.32);

  const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 14), skinMat));
  head.position.set(0, 1.62, -0.26);

  const helmet = add(new THREE.Mesh(
    new THREE.SphereGeometry(0.33, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
    bodyMat,
  ));
  helmet.position.set(0, 1.62, -0.26);

  const visor = add(new THREE.Mesh(
    new THREE.SphereGeometry(0.335, 16, 10, -0.9, 1.8, Math.PI * 0.34, Math.PI * 0.28),
    visorMat,
  ));
  visor.position.set(0, 1.62, -0.26);

  // Steering column + wheel, animated with the steering input
  const steering = new THREE.Group();
  steering.position.set(0, 1.08, 0.42);
  steering.rotation.x = -0.55;
  body.add(steering);
  const column = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), trimMat), steering);
  column.rotation.x = Math.PI / 2;
  const wheelRim = add(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 16), trimMat), steering);
  wheelRim.position.z = 0.2;

  for (const sx of [-1, 1]) {
    const arm = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8), darkMat));
    arm.position.set(sx * 0.26, 1.22, 0.1);
    arm.rotation.x = 1.15;
    arm.rotation.z = sx * -0.18;
  }

  // ── Wheels ──
  const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.36, 16);
  const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.38, 8);
  const wheels = [];
  for (const spec of [
    { x: -0.88, z: 0.92, front: true },
    { x: 0.88, z: 0.92, front: true },
    { x: -0.9, z: -0.95, front: false },
    { x: 0.9, z: -0.95, front: false },
  ]) {
    const mount = new THREE.Group();
    mount.position.set(spec.x, WHEEL_R, spec.z);
    const spinner = new THREE.Group();
    const tyre = add(new THREE.Mesh(tyreGeo, tyreMat), spinner);
    tyre.rotation.z = Math.PI / 2;
    const hub = add(new THREE.Mesh(hubGeo, chromeMat), spinner);
    hub.rotation.z = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const spoke = add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.3), chromeMat), spinner);
      spoke.rotation.x = (i / 4) * Math.PI;
    }
    mount.add(spinner);
    group.add(mount);
    wheels.push({ mount, spinner, front: spec.front, baseY: WHEEL_R });
  }

  // ── Name / health tag ──
  const tag = createTag(name);
  tag.position.y = 2.6;
  group.add(tag);

  // ── Status effects ──
  const shieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 20, 14),
    new THREE.MeshStandardMaterial({
      color: 0x55ccff, transparent: true, opacity: 0.28,
      emissive: 0x55ccff, emissiveIntensity: 0.6, side: THREE.DoubleSide,
    }),
  );
  shieldBubble.position.y = 0.9;
  shieldBubble.visible = false;
  group.add(shieldBubble);
  materials.push(shieldBubble.material);

  const iceBlock = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 1.9, 2.5),
    new THREE.MeshStandardMaterial({
      color: 0xbfeeff, transparent: true, opacity: 0.55,
      roughness: 0.1, metalness: 0.1, emissive: 0x3aa8ff, emissiveIntensity: 0.3,
    }),
  );
  iceBlock.position.y = 0.95;
  iceBlock.visible = false;
  group.add(iceBlock);
  materials.push(iceBlock.material);

  const boostFlames = [];
  for (const sx of [-1, 1]) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.9, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffc93c, emissive: 0xff7b00, emissiveIntensity: 1.6,
        transparent: true, opacity: 0.9,
      }),
    );
    flame.position.set(sx * 0.3, 1.28, -1.55);
    flame.rotation.x = Math.PI / 2 - 0.45;
    flame.visible = false;
    body.add(flame);
    boostFlames.push(flame);
    materials.push(flame.material);
  }

  let spinAngle = 0;
  let steerSmooth = 0;
  let flashTimer = 0;
  /** Cached so the material walk only runs when invisibility actually flips. */
  let lastGhost = 1;
  let tagName = name;
  let tagHp = 100;

  return {
    group,
    body,
    materials,

    setColor(next) {
      bodyMat.color.set(next);
      darkMat.color.copy(shade(next, -0.18));
    },

    setLabel(nextName, hp) {
      if (nextName === tagName && Math.abs(hp - tagHp) < 1) return;
      tagName = nextName;
      tagHp = hp;
      paintTag(tag, nextName, hp);
    },

    flash() { flashTimer = 0.25; },

    /**
     * @param {object} view render pose: { x, y, z, yaw, speed, yawRate, drifting,
     *   grounded, steer, boost, shield, stunned, alive }
     */
    apply(view, dt) {
      group.position.set(view.x, view.y, view.z);
      group.rotation.y = view.yaw;

      // Body roll and pitch sell the weight transfer.
      const targetRoll = THREE.MathUtils.clamp(-view.yawRate * (view.drifting ? 0.16 : 0.09), -0.4, 0.4);
      const targetPitch = THREE.MathUtils.clamp(
        (view.grounded ? -view.accel * 0.012 : 0.1), -0.16, 0.16,
      );
      const a = 1 - Math.exp(-11 * dt);
      body.rotation.z += (targetRoll - body.rotation.z) * a;
      body.rotation.x += (targetPitch - body.rotation.x) * a;
      // Drifting swings the whole kart sideways relative to travel.
      const targetSlip = view.drifting ? -Math.sign(view.yawRate || 1) * 0.38 : 0;
      group.rotation.y += 0;
      body.rotation.y += (targetSlip - body.rotation.y) * a;

      spinAngle += view.speed * (1 / WHEEL_R) * dt;
      steerSmooth += (THREE.MathUtils.clamp(view.steer, -1, 1) * 0.5 - steerSmooth) * (1 - Math.exp(-13 * dt));
      for (const w of wheels) {
        w.spinner.rotation.x = spinAngle;
        if (w.front) w.mount.rotation.y = steerSmooth;
      }

      steering.rotation.z = -steerSmooth * 1.6;

      shieldBubble.visible = !!view.shield;
      if (shieldBubble.visible) {
        shieldBubble.rotation.y += dt * 1.6;
        shieldBubble.material.opacity = 0.2 + Math.sin(performance.now() * 0.006) * 0.08;
      }
      iceBlock.visible = !!view.stunned;
      const boosting = !!view.boost;
      for (const f of boostFlames) {
        f.visible = boosting;
        if (boosting) f.scale.setScalar(0.8 + Math.random() * 0.5);
      }

      if (flashTimer > 0) {
        flashTimer = Math.max(0, flashTimer - dt);
        const k = flashTimer / 0.25;
        bodyMat.emissive.setHex(0xff2222);
        bodyMat.emissiveIntensity = k * 1.2;
        group.scale.setScalar(1 + k * 0.12);
      } else if (group.scale.x !== 1) {
        bodyMat.emissiveIntensity = 0;
        group.scale.setScalar(1);
      }

      // Invisibility: gone entirely for everyone else, a faint ghost for the
      // player using it — you need to see where your own kart is, but nobody
      // watching should get a silhouette to aim at.
      const ghost = view.invisible ? (view.isLocal ? 0.22 : 0) : 1;
      if (ghost !== lastGhost) {
        lastGhost = ghost;
        for (const m of materials) {
          m.transparent = ghost < 1;
          m.opacity = ghost < 1 ? ghost : (m === shieldBubble.material ? 0.28 : 1);
          m.depthWrite = ghost >= 1;
        }
      }

      group.visible = view.alive !== false && ghost > 0;
      // Your own name over your own kart just blocks the view.
      const tagAlpha = showTag && !view.invisible ? (view.tagOpacity ?? 1) : 0;
      tag.visible = group.visible && tagAlpha > 0.03;
      tag.material.opacity = tagAlpha;

      // Sprites shrink and grow with perspective like any other geometry, so a
      // kart that drives up alongside you gets a name plate across half the
      // screen. Scale against camera distance to hold a roughly constant size,
      // clamped so tags stay legible far away without dwarfing a nearby kart.
      if (tag.visible && view.camDist) {
        const k = Math.min(1.35, Math.max(0.55, view.camDist / TAG_REF_DIST));
        tag.scale.set(TAG_W * k, TAG_H * k, 1);
      }
    },

    dispose() {
      disposeTree(group);
      tag.material.map?.dispose();
      tag.material.dispose();
    },
  };
}

/* ── Name + health sprite ───────────────────────────────────────────── */

const TAG_W = 3.2;
const TAG_H = 0.96;
/** Camera distance at which a tag draws at its nominal size. */
const TAG_REF_DIST = 11;


function createTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 96;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false,
  }));
  sprite.scale.set(TAG_W, TAG_H, 1);
  sprite.renderOrder = 10;
  sprite.userData.canvas = canvas;
  paintTag(sprite, name, 100);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintTag(sprite, name, hp) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  ctx.clearRect(0, 0, W, canvas.height);

  ctx.fillStyle = 'rgba(12,16,26,0.72)';
  roundRect(ctx, 6, 4, W - 12, 46, 14);
  ctx.fill();

  ctx.font = 'bold 30px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(String(name).slice(0, 14), W / 2, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(name).slice(0, 14), W / 2, 28);

  // Health bar
  const bx = 18;
  const bw = W - 36;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, bx, 58, bw, 18, 9);
  ctx.fill();
  const frac = Math.max(0, Math.min(1, hp / 100));
  const hue = 120 * frac;
  ctx.fillStyle = `hsl(${hue}, 85%, 52%)`;
  roundRect(ctx, bx + 2, 60, Math.max(4, (bw - 4) * frac), 14, 7);
  ctx.fill();

  sprite.material.map.needsUpdate = true;
}
