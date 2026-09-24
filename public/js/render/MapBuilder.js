/**
 * Turns a map blueprint into Three.js meshes.
 *
 * Every solid's mesh is generated from the exact numbers the physics uses, so
 * a wall can never be drawn somewhere other than where it blocks. Decoration
 * is built separately and never touches collision.
 */

import * as THREE from 'three';
import { createMaterialLibrary, disposeTree, stripeTexture } from './materials.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Triangular prism matching the physics ramp: low at local -Z, high at +Z. */
function rampGeometry(w, len, rise) {
  const shape = new THREE.Shape();
  shape.moveTo(-len / 2, 0);
  shape.lineTo(len / 2, 0);
  shape.lineTo(len / 2, rise);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  // Shape X is "along the ramp" and extrusion Z is "across": swap them so the
  // slope climbs along local +Z like the collider does.
  geo.rotateY(-Math.PI / 2);
  return geo;
}

/** Flat annulus + outer skirt, used for the Beyblade dish terraces. */
function terraceGroup(solid, material) {
  const g = new THREE.Group();
  const top = solid.y + solid.h;
  const face = new THREE.Mesh(
    new THREE.RingGeometry(solid.inner, solid.r, 72, 1),
    material,
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = top;
  face.receiveShadow = true;
  g.add(face);

  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(solid.inner, solid.inner, 0.45, 72, 1, true),
    material,
  );
  skirt.position.y = top - 0.22;
  skirt.castShadow = true;
  g.add(skirt);
  return g;
}

function buildSolid(solid, materials) {
  const mat = materials.get(solid.mat);
  let mesh;

  if (solid.t === 'box') {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(solid.w, solid.h, solid.d), mat);
    mesh.position.set(solid.x, solid.y + solid.h / 2, solid.z);
    mesh.rotation.y = solid.rotY || 0;
  } else if (solid.t === 'ramp') {
    mesh = new THREE.Mesh(rampGeometry(solid.w, solid.len, solid.rise), mat);
    mesh.position.set(solid.x, solid.y, solid.z);
    mesh.rotation.y = solid.rotY || 0;
  } else if (solid.t === 'ring') {
    // A solid kerb you can read at a glance, with near-invisible glass above so
    // the barrier is obvious without walling off the view of the arena.
    mesh = new THREE.Group();
    const KERB = 1.1;
    const kerb = new THREE.Mesh(
      new THREE.CylinderGeometry(solid.r, solid.r, KERB, 80, 1, true),
      materials.make({
        color: mat.color, roughness: 0.4, metalness: 0.35,
        emissive: mat.color, emissiveIntensity: 0.45, side: THREE.DoubleSide,
      }),
    );
    kerb.position.y = solid.y + KERB / 2;
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(solid.r, solid.r, solid.h - KERB, 80, 1, true),
      materials.make({
        color: mat.color, roughness: 0.1, metalness: 0.1,
        emissive: mat.color, emissiveIntensity: 0.1,
        transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    glass.position.y = solid.y + KERB + (solid.h - KERB) / 2;
    mesh.add(kerb, glass);
    mesh.position.set(solid.x, 0, solid.z);
  } else if (solid.inner) {
    mesh = terraceGroup(solid, mat);
  } else {
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(solid.r, solid.r * 1.04, solid.h, solid.r > 4 ? 24 : 16),
      mat,
    );
    mesh.position.set(solid.x, solid.y + solid.h / 2, solid.z);
  }

  mesh.traverse?.((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  if (mesh.isMesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return mesh;
}

/** Chevrons painted on launch ramps so players read them as jumps. */
function launchMarkings(solid, materials) {
  const g = new THREE.Group();
  const mat = materials.make({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5,
    transparent: true, opacity: 0.9,
  });
  for (let i = 0; i < 3; i++) {
    const t = 0.15 + i * 0.28;
    const chevron = new THREE.Mesh(new THREE.BoxGeometry(solid.w * 0.55, 0.06, 0.55), mat);
    const alongZ = -solid.len / 2 + t * solid.len;
    chevron.position.set(0, solid.rise * t + 0.08, alongZ);
    chevron.rotation.x = -Math.atan2(solid.rise, solid.len);
    g.add(chevron);
  }
  g.position.set(solid.x, solid.y, solid.z);
  g.rotation.y = solid.rotY || 0;
  return g;
}

function buildDecor(d, materials, theme) {
  const g = new THREE.Group();
  g.position.set(d.x, d.y, d.z);

  switch (d.kind) {
    case 'ground': {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(d.size, d.size),
        materials.get(d.mat || 'sand'),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -0.02;
      mesh.receiveShadow = true;
      g.add(mesh);
      break;
    }
    case 'flag': {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.15, d.height, 8),
        materials.make({ color: 0xf2f2f2, roughness: 0.5, metalness: 0.4 }),
      );
      pole.position.y = d.height / 2;
      pole.castShadow = true;
      const hues = [0xff4757, 0x2ed573, 0x1e90ff, 0xffd32a];
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 1.3),
        materials.make({
          color: hues[d.tint % hues.length], side: THREE.DoubleSide, roughness: 0.8,
        }),
      );
      cloth.position.set(1.1, d.height - 0.9, 0);
      cloth.userData.flutter = Math.random() * Math.PI * 2;
      g.add(pole, cloth);
      break;
    }
    case 'barrier': {
      const post = materials.make({ color: 0xf2f2f2, roughness: 0.6, metalness: 0.2 });
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(d.len, 0.5, 0.2),
        materials.get('barrier'),
      );
      rail.position.y = 1.0;
      rail.castShadow = true;
      g.add(rail);
      for (const t of [-0.5, 0, 0.5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), post);
        leg.position.set(t * d.len * 0.9, 0.6, 0);
        leg.castShadow = true;
        g.add(leg);
      }
      g.rotation.y = d.rotY || 0;
      break;
    }
    case 'patch': {
      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(d.r, 18),
        materials.make({
          color: materials.get(d.mat).color, roughness: 1, metalness: 0,
          transparent: true, opacity: 0.55, depthWrite: false,
        }),
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.y = 0.015;
      patch.receiveShadow = true;
      g.add(patch);
      break;
    }
    case 'mesa': {
      const rock = new THREE.Mesh(
        new THREE.CylinderGeometry(d.r * 0.72, d.r, d.h, 7, 1),
        materials.make({ color: 0xb5794a, roughness: 1, metalness: 0 }),
      );
      rock.position.y = d.h / 2 - 2;
      g.add(rock);
      break;
    }
    case 'banner': {
      const tex = stripeTexture('#ff4757', '#ffe66d', 8);
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(d.w, 3),
        materials.make({ map: tex, side: THREE.DoubleSide, roughness: 0.85 }),
      );
      cloth.position.y = 4.4;
      cloth.rotation.y = d.rotY || 0;
      g.add(cloth);
      break;
    }
    case 'voidGrid': {
      const grid = new THREE.GridHelper(d.size, 48, theme.accent, theme.accentAlt);
      grid.material.transparent = true;
      grid.material.opacity = 0.14;
      g.add(grid);
      break;
    }
    case 'deckGlow': {
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(d.r - 1.6, d.r, 80),
        materials.make({
          color: theme.accent, emissive: theme.accent, emissiveIntensity: 1.1,
          transparent: true, opacity: 0.8, side: THREE.DoubleSide,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      g.add(disc);
      break;
    }
    case 'skyShard': {
      const shard = new THREE.Mesh(
        new THREE.IcosahedronGeometry(d.r, 0),
        materials.make({
          color: 0x2b1b55, roughness: 0.6, metalness: 0.3,
          emissive: theme.accentAlt, emissiveIntensity: 0.12,
        }),
      );
      shard.userData.drift = Math.random() * Math.PI * 2;
      g.add(shard);
      break;
    }
    case 'pylon': {
      const shaftMat = materials.make({ color: 0x3a4472, roughness: 0.5, metalness: 0.5 });
      const lampMat = materials.make({
        color: theme.accent, emissive: theme.accent, emissiveIntensity: 1.4,
      });
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, d.h, 8), shaftMat);
      post.position.y = d.h / 2;
      post.castShadow = true;
      const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), lampMat);
      beacon.position.y = d.h + 0.5;
      beacon.userData.drift = Math.random() * Math.PI * 2;
      for (let i = 0; i < 3; i++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 6, 14), lampMat);
        band.rotation.x = Math.PI / 2;
        band.position.y = 1.6 + i * (d.h - 2.6) / 2;
        g.add(band);
      }
      g.add(post, beacon);
      break;
    }
    case 'cage': {
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(d.r, d.r, d.h, 64, 1, true),
        materials.make({
          color: 0xa8d8ff, transparent: true, opacity: 0.12,
          side: THREE.DoubleSide, roughness: 0.4, metalness: 0.3,
          emissive: 0x3b78ff, emissiveIntensity: 0.15,
        }),
      );
      shell.position.y = d.h / 2;
      g.add(shell);
      const barMat = materials.make({
        color: 0xd0e8ff, roughness: 0.35, metalness: 0.6,
        emissive: 0x7ab8ff, emissiveIntensity: 0.25,
      });
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, d.h, 0.22), barMat);
        bar.position.set(Math.cos(a) * d.r, d.h / 2, Math.sin(a) * d.r);
        g.add(bar);
      }
      for (const y of [4, 10, 16, d.h]) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.16, 8, 64), barMat);
        hoop.rotation.x = Math.PI / 2;
        hoop.position.y = y;
        g.add(hoop);
      }
      break;
    }
    case 'dishRim': {
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(d.r, 0.55, 12, 80),
        materials.make({
          color: theme.accent, roughness: 0.35, metalness: 0.5,
          emissive: theme.accent, emissiveIntensity: 0.4,
        }),
      );
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      break;
    }
    case 'centreEmblem': {
      const mats = [theme.accent, theme.accentAlt];
      for (let i = 0; i < 8; i++) {
        const wedge = new THREE.Mesh(
          new THREE.CircleGeometry(d.r, 12, (i / 8) * Math.PI * 2, Math.PI / 4),
          materials.make({
            color: mats[i % 2], transparent: true, opacity: 0.4,
            emissive: mats[i % 2], emissiveIntensity: 0.25,
          }),
        );
        wedge.rotation.x = -Math.PI / 2;
        g.add(wedge);
      }
      break;
    }
    case 'grooveRing': {
      const groove = new THREE.Mesh(
        new THREE.TorusGeometry(d.r, 0.13, 8, 90),
        materials.make({
          color: theme.accentAlt, emissive: theme.accentAlt, emissiveIntensity: 0.5,
        }),
      );
      groove.rotation.x = Math.PI / 2;
      g.add(groove);
      break;
    }
    case 'floodlight': {
      const hues = [0xff3355, 0x33aaff, 0xffd32a];
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.4, d.h, 8),
        materials.make({ color: 0x59606e, roughness: 0.5, metalness: 0.5 }),
      );
      post.position.y = d.h / 2;
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(1.0, 12, 10),
        materials.make({
          color: 0xffffff, emissive: hues[d.tint % 3], emissiveIntensity: 1.6,
        }),
      );
      lamp.position.y = d.h;
      lamp.lookAt(0, 0, 0);
      g.add(post, lamp);
      break;
    }
    default:
      break;
  }
  return g;
}

/**
 * @param {object} map blueprint from shared/maps
 * @returns {{ group, materials, update, dispose }}
 */
export function buildMap(map) {
  const group = new THREE.Group();
  group.name = map.id;
  const materials = createMaterialLibrary(map.theme);

  // The dish spins, so anything marked `spins` lives under its own pivot.
  const spinner = new THREE.Group();
  group.add(spinner);

  for (const solid of map.solids) {
    const mesh = buildSolid(solid, materials);
    (solid.spins ? spinner : group).add(mesh);
    if (solid.launch) group.add(launchMarkings(solid, materials));
  }

  const flutterers = [];
  const drifters = [];
  for (const d of map.visuals || []) {
    const node = buildDecor(d, materials, map.theme);
    (d.spins ? spinner : group).add(node);
    node.traverse((o) => {
      if (o.userData.flutter !== undefined) flutterers.push(o);
      if (o.userData.drift !== undefined) drifters.push(o);
    });
  }

  // ── Lighting rig ──
  const theme = map.theme;
  const lights = new THREE.Group();
  lights.add(new THREE.AmbientLight(theme.ambient.color, theme.ambient.intensity));
  lights.add(new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity));

  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.position.set(theme.sun.x, theme.sun.y, theme.sun.z);
  sun.castShadow = true;
  // Size the shadow frustum to the arena. Three reads `projectionMatrix`
  // directly when rendering the shadow map, so the explicit
  // updateProjectionMatrix() below is required — without it the frustum stays
  // at the default ±5 and shadows only appear in a tiny patch at the origin.
  const extent = (map.arenaRadius || 46) * 1.15;
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -extent;
  shadowCam.right = extent;
  shadowCam.top = extent;
  shadowCam.bottom = -extent;
  shadowCam.near = 20;
  shadowCam.far = 260;
  shadowCam.updateProjectionMatrix();
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  lights.add(sun);
  lights.add(sun.target);
  group.add(lights);

  let t = 0;
  return {
    group,
    materials,
    spinner,
    sun,
    update(dt) {
      t += dt;
      if (map.spin) spinner.rotation.y += map.spin.omega * dt;
      for (const f of flutterers) f.rotation.y = Math.sin(t * 2 + f.userData.flutter) * 0.35;
      for (const d of drifters) {
        d.rotation.x += dt * 0.12;
        d.rotation.y += dt * 0.09;
        d.position.y = Math.sin(t * 0.4 + d.userData.drift) * 1.5;
      }
    },
    dispose() {
      disposeTree(group);
      materials.dispose();
    },
  };
}

export { UP };
