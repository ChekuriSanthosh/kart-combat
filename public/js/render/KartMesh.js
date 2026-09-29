/**
 * The kart and its driver.
 *
 * Both are picked from a set of cosmetics rather than being one fixed model,
 * so the chassis and the character are built separately and bolted together.
 * A rival is only ever seen from behind at speed, so each variant is shaped to
 * be identifiable by silhouette — a colour swap alone would be invisible at
 * the distance anyone actually plays at.
 *
 * The group's origin sits at the point where the wheels touch the ground,
 * which is exactly what `state.y` means in the shared physics — so the mesh
 * lands where the simulation says it does.
 */

import * as THREE from 'three';
import { disposeTree } from './materials.js';
import {
  CHARACTERS, KARTS, DEFAULT_CHARACTER, DEFAULT_KART,
} from '/shared/cosmetics.js';

function shade(hex, amount) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return c;
}

/**
 * Chassis shapes. Each gets the shared material set and an `add` helper, and
 * is responsible only for the bodywork — wheels and driver are bolted on by
 * the caller so every variant gets them in the same place.
 */
const CHASSIS = {
  classic(add, M) {
    const tub = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.52, 2.0), M.body));
    tub.position.set(0, 0.52, 0);
    const nose = add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.36, 0.8), M.body));
    nose.position.set(0, 0.46, 1.25);
    const snout = add(new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.26, 0.4), M.dark));
    snout.position.set(0, 0.4, 1.7);
    for (const sx of [-1, 1]) {
      const pod = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 1.7), M.dark));
      pod.position.set(sx * 0.82, 0.5, 0);
    }
    const engine = add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.62), M.trim));
    engine.position.set(0, 0.78, -1.05);
    for (const sx of [-1, 1]) {
      const pipe = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 8), M.chrome));
      pipe.position.set(sx * 0.3, 1.1, -1.25);
      pipe.rotation.x = 0.45;
    }
    const bumper = add(new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.2, 0.22), M.trim));
    bumper.position.set(0, 0.3, 1.92);
  },

  monster(add, M) {
    // Tall and short-bodied so the enormous wheels dominate the silhouette.
    const tub = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 1.8), M.body));
    tub.position.set(0, 1.05, 0);
    const skid = add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 2.3), M.trim));
    skid.position.set(0, 0.62, 0);
    // Roll cage: the read-at-distance feature.
    for (const sx of [-1, 1]) {
      const bar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 8), M.chrome));
      bar.position.set(sx * 0.62, 1.9, -0.45);
      bar.rotation.z = sx * 0.16;
    }
    const roof = add(new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 0.5), M.chrome));
    roof.position.set(0, 2.5, -0.45);
    const grille = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.2), M.dark));
    grille.position.set(0, 1.0, 1.0);
  },

  hotrod(add, M) {
    // Very long nose, cab pushed right to the back.
    const tub = add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.46, 1.5), M.body));
    tub.position.set(0, 0.5, -0.45);
    const hood = add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.4, 2.1), M.body));
    hood.position.set(0, 0.52, 1.25);
    const tip = add(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.24, 0.5), M.dark));
    tip.position.set(0, 0.48, 2.45);
    // Stacks: four chrome pipes standing proud of the hood.
    for (const sx of [-1, 1]) {
      for (const dz of [0.55, 1.15]) {
        const stack = add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.62, 8), M.chrome));
        stack.position.set(sx * 0.6, 0.95, dz);
        stack.rotation.x = -0.28;
      }
    }
    const spoiler = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.42), M.trim));
    spoiler.position.set(0, 1.05, -1.3);
    for (const sx of [-1, 1]) {
      const stay = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.12), M.trim));
      stay.position.set(sx * 0.5, 0.88, -1.3);
    }
  },

  bubble(add, M) {
    // One rounded pod: the only variant with no hard edges at all.
    const shell = add(new THREE.Mesh(new THREE.SphereGeometry(0.92, 18, 14), M.body));
    shell.position.set(0, 0.78, -0.05);
    shell.scale.set(0.92, 0.78, 1.12);
    const skirt = add(new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.95, 0.3, 18), M.dark));
    skirt.position.set(0, 0.34, -0.05);
    const canopy = add(new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.visor,
    ));
    canopy.position.set(0, 1.12, 0.12);
    const light = add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M.chrome));
    light.position.set(0, 0.72, 1.0);
  },

  tractor(add, M) {
    // Upright cab over a narrow snout, the way a real one reads from behind.
    const snout = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.5), M.body));
    snout.position.set(0, 0.85, 0.95);
    const cab = add(new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.85, 1.25), M.body));
    cab.position.set(0, 1.15, -0.45);
    const chimney = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.95, 8), M.chrome));
    chimney.position.set(0.42, 1.55, 1.2);
    const lid = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), M.dark));
    lid.position.set(0.42, 2.05, 1.2);
    // Rear fenders arched over the big back wheels.
    for (const sx of [-1, 1]) {
      const fender = add(new THREE.Mesh(
        new THREE.TorusGeometry(0.72, 0.09, 6, 12, Math.PI), M.dark,
      ));
      fender.position.set(sx * 0.78, 0.7, -0.85);
      fender.rotation.y = Math.PI / 2;
    }
    const grille = add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.34, 0.18), M.trim));
    grille.position.set(0, 0.85, 1.72);
  },

  rocket(add, M) {
    // Low, finned and pointed: a sled with an engine strapped on.
    const fuse = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.5, 6, 12), M.body));
    fuse.position.set(0, 0.62, 0.05);
    fuse.rotation.x = Math.PI / 2;
    const cone = add(new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.95, 12), M.dark));
    cone.position.set(0, 0.62, 1.62);
    cone.rotation.x = Math.PI / 2;
    // Three fins, the feature that names it.
    for (const [fx, rz] of [[-1, 0.5], [1, -0.5]]) {
      const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.8), M.trim));
      fin.position.set(fx * 0.5, 0.72, -0.95);
      fin.rotation.z = rz * 0.34;
    }
    const tail = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.7), M.trim));
    tail.position.set(0, 1.05, -1.0);
    const nozzle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.5, 12), M.chrome));
    nozzle.position.set(0, 0.62, -1.2);
    nozzle.rotation.x = Math.PI / 2;
  },
};

/**
 * Character heads. The body underneath is shared; only what sits above the
 * shoulders changes, because that is the part that clears the headrest and is
 * actually visible from a chase camera.
 */
const HEADS = {
  rooster(add, M, at) {
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 14), M.skin));
    head.position.copy(at);
    const beak = add(new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 8), M.beak));
    beak.position.set(at.x, at.y - 0.03, at.z + 0.3);
    beak.rotation.x = Math.PI / 2;
    // Comb: three fins along the crown.
    for (let i = 0; i < 3; i++) {
      const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.17 - i * 0.03, 0.13), M.accent));
      fin.position.set(at.x, at.y + 0.32, at.z + 0.12 - i * 0.14);
    }
    const wattle = add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.accent));
    wattle.position.set(at.x, at.y - 0.21, at.z + 0.2);
  },

  astronaut(add, M, at) {
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 12), M.skin));
    head.position.copy(at);
    const helmet = add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 14), M.helmet));
    helmet.position.copy(at);
    const visor = add(new THREE.Mesh(
      new THREE.SphereGeometry(0.365, 16, 12, -1.0, 2.0, Math.PI * 0.3, Math.PI * 0.36), M.visor,
    ));
    visor.position.copy(at);
    const pack = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.52, 0.26), M.accent));
    pack.position.set(at.x, at.y - 0.42, at.z - 0.34);
  },

  robot(add, M, at) {
    const head = add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.42), M.skin));
    head.position.copy(at);
    // A single glowing eye bar, which reads even in silhouette.
    const eye = add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.06), M.glow));
    eye.position.set(at.x, at.y + 0.03, at.z + 0.23);
    const stalk = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), M.trim));
    stalk.position.set(at.x, at.y + 0.37, at.z);
    const bulb = add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), M.glow));
    bulb.position.set(at.x, at.y + 0.54, at.z);
    for (const sx of [-1, 1]) {
      const ear = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8), M.trim));
      ear.position.set(at.x + sx * 0.27, at.y, at.z);
      ear.rotation.z = Math.PI / 2;
    }
  },

  bandit(add, M, at) {
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 14), M.skin));
    head.position.copy(at);
    const mask = add(new THREE.Mesh(
      new THREE.SphereGeometry(0.288, 16, 10, -0.9, 1.8, Math.PI * 0.4, Math.PI * 0.3), M.accent,
    ));
    mask.position.copy(at);
    // Wide brim: unmistakable from above and behind.
    const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.05, 16), M.hat));
    brim.position.set(at.x, at.y + 0.26, at.z);
    const crown = add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.32, 14), M.hat));
    crown.position.set(at.x, at.y + 0.42, at.z);
    const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.08, 14), M.accent));
    band.position.set(at.x, at.y + 0.3, at.z);
  },

  diver(add, M, at) {
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 14), M.skin));
    head.position.copy(at);
    const strap = add(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 6, 16), M.trim));
    strap.position.copy(at);
    strap.rotation.y = Math.PI / 2;
    for (const sx of [-1, 1]) {
      const lens = add(new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), M.visor));
      lens.position.set(at.x + sx * 0.12, at.y + 0.04, at.z + 0.22);
    }
    // Snorkel, curving up past the ear.
    const tube = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.58, 8), M.accent));
    tube.position.set(at.x + 0.3, at.y + 0.2, at.z - 0.02);
    tube.rotation.z = 0.2;
    const bend = add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.045, 6, 10, Math.PI), M.accent));
    bend.position.set(at.x + 0.22, at.y + 0.48, at.z - 0.02);
    bend.rotation.y = Math.PI / 2;
  },

  knight(add, M, at) {
    const helm = add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.52, 12), M.skin));
    helm.position.copy(at);
    const dome = add(new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M.skin,
    ));
    dome.position.set(at.x, at.y + 0.24, at.z);
    const slit = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.06), M.dark));
    slit.position.set(at.x, at.y + 0.04, at.z + 0.27);
    // Plume: the tall feature that makes a knight legible at range.
    for (let i = 0; i < 4; i++) {
      const tuft = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), M.accent));
      tuft.position.set(at.x, at.y + 0.44 + i * 0.13, at.z - i * 0.05);
      tuft.rotation.x = -i * 0.14;
    }
  },
};

export function createKartMesh(color = 0xe74c3c, name = 'Player', opts = {}) {
  const { showTag = true } = opts;
  const charDef = CHARACTERS[opts.character] || CHARACTERS[DEFAULT_CHARACTER];
  const kartDef = KARTS[opts.kart] || KARTS[DEFAULT_KART];
  const WHEEL_R = kartDef.wheel;

  const group = new THREE.Group();
  const body = new THREE.Group();
  // Ride height lifts the whole body so big wheels do not swallow the chassis.
  body.position.y = kartDef.ride;
  body.scale.x = kartDef.wide;
  group.add(body);

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12 });
  const darkMat = new THREE.MeshStandardMaterial({ color: shade(color, -0.18), roughness: 0.5 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2f3542, roughness: 0.6, metalness: 0.2 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe8edf3, roughness: 0.25, metalness: 0.85 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1f2026, roughness: 0.95 });
  const skinMat = new THREE.MeshStandardMaterial({ color: charDef.skin, roughness: 0.8 });
  const accentMat = new THREE.MeshStandardMaterial({ color: charDef.accent, roughness: 0.65 });
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.7 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x5c4030, roughness: 0.85 });
  const helmetMat = new THREE.MeshStandardMaterial({
    color: 0xf2f5f8, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.55,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: charDef.accent, emissive: charDef.accent, emissiveIntensity: 1.6, roughness: 0.3,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x101820, roughness: 0.1, metalness: 0.5,
    emissive: 0x2b4a6b, emissiveIntensity: 0.3,
  });
  const materials = [bodyMat, darkMat, trimMat, chromeMat, tyreMat, skinMat,
    accentMat, beakMat, hatMat, helmetMat, glowMat, visorMat];

  const add = (mesh, parent = body) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const M = {
    body: bodyMat, dark: darkMat, trim: trimMat, chrome: chromeMat,
    skin: skinMat, accent: accentMat, beak: beakMat, hat: hatMat,
    helmet: helmetMat, glow: glowMat, visor: visorMat,
  };

  // ── Chassis ──
  (CHASSIS[kartDef.id] || CHASSIS.classic)(add, M);

  // ── Driver ──
  // The pod has a canopy over the seat, so its driver sits lower and there is
  // no headrest to clear.
  const seated = kartDef.id === 'bubble' ? 0.86 : 1.03;
  const seat = add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.18), trimMat));
  seat.position.set(0, seated, -0.6);

  const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.32, 4, 10), accentMat));
  torso.position.set(0, seated + 0.11, -0.32);

  const headAt = new THREE.Vector3(0, seated + 0.59, -0.26);
  (HEADS[charDef.id] || HEADS.rooster)(add, M, headAt);

  // Steering column + wheel, animated with the steering input
  const steering = new THREE.Group();
  steering.position.set(0, seated + 0.05, 0.42);
  steering.rotation.x = -0.55;
  body.add(steering);
  const column = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), trimMat), steering);
  column.rotation.x = Math.PI / 2;
  const wheelRim = add(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 16), trimMat), steering);
  wheelRim.position.z = 0.2;

  for (const sx of [-1, 1]) {
    const arm = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8), accentMat));
    arm.position.set(sx * 0.26, seated + 0.19, 0.1);
    arm.rotation.x = 1.15;
    arm.rotation.z = sx * -0.18;
  }

  // ── Wheels ──
  // Track and wheelbase scale with the chassis so a monster truck stands on
  // its tyres rather than through them.
  const tyreW = 0.36 * (0.8 + WHEEL_R);
  const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, tyreW, 16);
  const hubGeo = new THREE.CylinderGeometry(WHEEL_R * 0.4, WHEEL_R * 0.4, tyreW + 0.02, 8);
  const trackX = 0.88 * kartDef.wide + (WHEEL_R - 0.42) * 0.5;
  const wheels = [];
  for (const spec of [
    { x: -trackX, z: 0.92, front: true },
    { x: trackX, z: 0.92, front: true },
    { x: -trackX, z: -0.95, front: false },
    { x: trackX, z: -0.95, front: false },
  ]) {
    const mount = new THREE.Group();
    mount.position.set(spec.x, WHEEL_R, spec.z);
    const spinner = new THREE.Group();
    const tyre = add(new THREE.Mesh(tyreGeo, tyreMat), spinner);
    tyre.rotation.z = Math.PI / 2;
    const hub = add(new THREE.Mesh(hubGeo, chromeMat), spinner);
    hub.rotation.z = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const spoke = add(new THREE.Mesh(
        new THREE.BoxGeometry(WHEEL_R * 0.95, 0.07, WHEEL_R * 0.72), chromeMat,
      ), spinner);
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
  /** What each material was built with, so ghosting can be undone exactly. */
  const baseOpacity = new Map(
    materials.map((m) => [m, { opacity: m.opacity, transparent: !!m.transparent }]),
  );
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
          const base = baseOpacity.get(m);
          m.transparent = ghost < 1 || base.transparent;
          // Restore what the material was built with rather than forcing 1.
          // Several are meant to stay see-through — the astronaut's helmet,
          // the freeze block, the boost flames — and hardcoding a single
          // exception for the shield made all the others turn solid the first
          // time anybody used the invisibility cheat.
          m.opacity = ghost < 1 ? ghost * base.opacity : base.opacity;
          m.depthWrite = ghost >= 1 && !base.transparent;
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
