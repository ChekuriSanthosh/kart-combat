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
      // Round by default: a square ground plane shows its corners against the
      // sky and makes the world look like a floating tile.
      const mesh = new THREE.Mesh(
        d.round
          ? new THREE.CircleGeometry(d.size / 2, 64)
          : new THREE.PlaneGeometry(d.size, d.size),
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
    case 'cropField': {
      // Visual only. Rows of crop give the field its farm read and cost the
      // player nothing — you drive straight through them.
      const soil = new THREE.Mesh(
        new THREE.PlaneGeometry(d.w, d.d),
        materials.make({ color: 0x8a6434, roughness: 1, metalness: 0 }),
      );
      soil.rotation.x = -Math.PI / 2;
      soil.position.y = 0.02;
      soil.receiveShadow = true;
      g.add(soil);

      // Every row is the same box in a different place, which is the exact
      // shape of problem instancing solves: one draw call for the whole field
      // instead of one per row.
      const rowMat = materials.make({ color: 0x7fae3a, roughness: 0.95, metalness: 0 });
      const rowGeo = new THREE.BoxGeometry(d.w * 0.96, 0.55, (d.d / d.rows) * 0.45);
      const rows = new THREE.InstancedMesh(rowGeo, rowMat, d.rows);
      rows.castShadow = true;
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < d.rows; i++) {
        m4.makeTranslation(0, 0.28, -d.d / 2 + (i + 0.5) * (d.d / d.rows));
        rows.setMatrixAt(i, m4);
      }
      rows.instanceMatrix.needsUpdate = true;
      g.add(rows);
      g.rotation.y = d.rotY || 0;
      break;
    }
    case 'pond': {
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(d.r, 32),
        materials.make({
          color: 0x2f7fb5, roughness: 0.15, metalness: 0.5,
          transparent: true, opacity: 0.85,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.05;
      g.add(water);
      const bank = new THREE.Mesh(
        new THREE.RingGeometry(d.r, d.r + 1.4, 32),
        materials.make({ color: 0x8a7a4a, roughness: 1, metalness: 0 }),
      );
      bank.rotation.x = -Math.PI / 2;
      bank.position.y = 0.03;
      g.add(bank);
      break;
    }
    case 'barnShell': {
      // The walls are real solids; this is the roof and gable that sit on top
      // of them, which is why it has no collider of its own.
      // Was near-black (0x4a4f58) which read as a hole in the map from above.
      const roofMat = materials.make({ color: 0x8c6239, roughness: 0.85, metalness: 0.05 });
      const plankMat = materials.get('barnWall');
      for (const side of [-1, 1]) {
        const pitch = new THREE.Mesh(new THREE.BoxGeometry(d.w * 0.72, 0.4, d.d + 1.4), roofMat);
        pitch.position.set(side * d.w * 0.22, d.h + 1.2, 0);
        pitch.rotation.z = side * -0.5;
        pitch.castShadow = true;
        pitch.receiveShadow = true;
        g.add(pitch);
      }
      // Gable ends, raised so the doorway underneath stays open.
      for (const end of [-1, 1]) {
        const gable = new THREE.Mesh(new THREE.BoxGeometry(d.w, 2.2, 0.4), plankMat);
        gable.position.set(0, d.h + 0.6, end * (d.d / 2));
        gable.castShadow = true;
        g.add(gable);
      }
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, d.d + 1.4), roofMat);
      ridge.position.y = d.h + 2.6;
      g.add(ridge);
      break;
    }
    case 'siloCap': {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(d.r, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
        materials.make({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.55 }),
      );
      dome.castShadow = true;
      g.add(dome);
      break;
    }
    case 'windmill': {
      // A tapered stone tower with a red cap: at 15 m tall it is the thing
      // players navigate by, so it has to be legible from across the field.
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(d.r * 1.5, d.r * 2.3, d.h, 14),
        materials.make({ color: 0xe8dcc0, roughness: 0.85, metalness: 0.03 }),
      );
      tower.position.y = d.h / 2;
      tower.castShadow = true;
      tower.receiveShadow = true;
      g.add(tower);

      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(d.r * 1.58, d.r * 1.72, 0.9, 14),
        materials.make({ color: 0xb8352c, roughness: 0.7, metalness: 0.08 }),
      );
      band.position.y = d.h * 0.52;
      g.add(band);

      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(d.r * 1.9, d.r * 2.2, 14),
        materials.make({ color: 0xb8352c, roughness: 0.7, metalness: 0.1 }),
      );
      cap.position.y = d.h + d.r * 1.0;
      cap.castShadow = true;
      g.add(cap);

      // The sails turn. Registered as a spinner so the frame loop drives it.
      const sails = new THREE.Group();
      sails.position.set(0, d.h * 0.92, d.r * 2.1);
      const sailMat = materials.make({ color: 0xf4efe2, roughness: 0.75, metalness: 0 });
      const armMat = materials.make({ color: 0x6b4a2a, roughness: 0.9, metalness: 0 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 11, 0.4), armMat);
        arm.position.set(Math.sin(a) * 5.5, Math.cos(a) * 5.5, 0);
        arm.rotation.z = -a;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(2.4, 8.5, 0.16), sailMat);
        blade.position.set(Math.sin(a) * 6.2, Math.cos(a) * 6.2, 0.3);
        blade.rotation.z = -a;
        blade.castShadow = true;
        sails.add(arm, blade);
      }
      // Marked rather than registered directly: the frame loop collects
      // animated nodes by userData, the same way flags and sky shards work.
      sails.userData.spinRate = 0.55;
      g.add(sails);
      break;
    }
    case 'fenceLine': {
      // A 68-post fence was 204 separate meshes and the single biggest draw
      // call cost on the map. Two instanced meshes draw the whole perimeter.
      const postMat = materials.make({ color: 0xe8dcc0, roughness: 0.85, metalness: 0.03 });
      const postGeo = new THREE.CylinderGeometry(0.16, 0.19, d.h, 6);
      const railGeo = new THREE.BoxGeometry(0.12, 0.16, (Math.PI * 2 * d.r) / d.posts + 0.3);

      const posts = new THREE.InstancedMesh(postGeo, postMat, d.posts);
      const rails = new THREE.InstancedMesh(railGeo, postMat, d.posts * 2);
      posts.castShadow = true;
      rails.castShadow = true;

      const mat = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const one = new THREE.Vector3(1, 1, 1);
      let railIdx = 0;
      for (let i = 0; i < d.posts; i++) {
        const a = (i / d.posts) * Math.PI * 2;
        mat.makeTranslation(Math.cos(a) * d.r, d.h / 2, Math.sin(a) * d.r);
        posts.setMatrixAt(i, mat);

        const mid = ((i + 0.5) / d.posts) * Math.PI * 2;
        for (const railY of [d.h * 0.42, d.h * 0.78]) {
          pos.set(Math.cos(mid) * d.r, railY, Math.sin(mid) * d.r);
          quat.setFromAxisAngle(UP, -mid);
          mat.compose(pos, quat, one);
          rails.setMatrixAt(railIdx++, mat);
        }
      }
      posts.instanceMatrix.needsUpdate = true;
      rails.instanceMatrix.needsUpdate = true;
      g.add(posts, rails);
      break;
    }
    case 'treeline': {
      // One node for the whole treeline rather than one per tree: 26 trees of
      // four meshes each would be 104 draw calls for scenery nobody can touch.
      const trunkMat = materials.make({ color: 0x6b4a2a, roughness: 1, metalness: 0 });
      const leafMat = materials.make({ color: 0x3f7a2e, roughness: 1, metalness: 0 });
      const n = d.count;
      const trunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.34, 0.5, 1, 7), trunkMat, n,
      );
      const leaves = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0), leafMat, n * 3,
      );
      trunks.castShadow = true;
      leaves.castShadow = true;

      const mat = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      let leafIdx = 0;
      for (let i = 0; i < n; i++) {
        const a = d.phase + (i / n) * Math.PI * 2;
        const tx = Math.cos(a) * d.r;
        const tz = Math.sin(a) * d.r;
        // Deterministic variation, so the treeline is not a row of clones and
        // is still identical on every client.
        const h = d.h + ((i * 7919) % 400) / 100;

        pos.set(tx, h * 0.22, tz);
        quat.setFromAxisAngle(UP, a);
        scl.set(1, h * 0.45, 1);
        mat.compose(pos, quat, scl);
        trunks.setMatrixAt(i, mat);

        for (let b = 0; b < 3; b++) {
          const rad = h * (0.34 - b * 0.06);
          pos.set(tx, h * (0.5 + b * 0.2), tz);
          quat.setFromAxisAngle(UP, a + b);
          scl.set(rad, rad, rad);
          mat.compose(pos, quat, scl);
          leaves.setMatrixAt(leafIdx++, mat);
        }
      }
      trunks.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      g.add(trunks, leaves);
      break;
    }
    case 'tractor': {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 1.1, 3.0),
        materials.make({ color: 0x2e7d32, roughness: 0.6, metalness: 0.25 }),
      );
      body.position.y = 1.1;
      body.castShadow = true;
      g.add(body);
      const cab = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.0, 1.2),
        materials.make({ color: 0x1b5e20, roughness: 0.55, metalness: 0.3 }),
      );
      cab.position.set(0, 2.1, -0.6);
      cab.castShadow = true;
      g.add(cab);
      const tyreMat = materials.make({ color: 0x23242a, roughness: 0.95, metalness: 0 });
      for (const [wx, wz, wr] of [[-1.05, 1.0, 0.95], [1.05, 1.0, 0.95], [-1.0, -1.1, 0.6], [1.0, -1.1, 0.6]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.45, 12), tyreMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, wr, wz);
        w.castShadow = true;
        g.add(w);
      }
      g.rotation.y = d.rotY || 0;
      break;
    }
    case 'cornPatch': {
      // Two metres of corn with no collider: it hides people without stopping
      // them. Every stalk is the same mesh in a different place, so the whole
      // field is two draw calls however dense it gets.
      const stalkMat = materials.make({ color: 0x4f8a2b, roughness: 1, metalness: 0 });
      const leafMat = materials.make({ color: 0x74ad3c, roughness: 1, metalness: 0 });
      const total = d.rows * d.per;

      const stalks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.055, 0.085, 1, 5), stalkMat, total,
      );
      const leaves = new THREE.InstancedMesh(
        new THREE.ConeGeometry(0.34, 1.1, 4), leafMat, total,
      );
      stalks.castShadow = true;
      leaves.castShadow = true;

      const mat = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      let i = 0;
      for (let r = 0; r < d.rows; r++) {
        for (let c = 0; c < d.per; c++) {
          // Jitter is derived from the indices rather than random, so the
          // field is identical on every client without needing a seed.
          const jx = (((r * 73 + c * 149) % 100) / 100 - 0.5) * 0.9;
          const jz = (((r * 191 + c * 37) % 100) / 100 - 0.5) * 0.9;
          const h = 2.0 + ((r * 17 + c * 29) % 60) / 100;
          const x = -d.w / 2 + (c + 0.5) * (d.w / d.per) + jx;
          const z = -d.d / 2 + (r + 0.5) * (d.d / d.rows) + jz;
          const spin = ((r * 53 + c * 97) % 628) / 100;

          pos.set(x, h * 0.5, z);
          quat.setFromAxisAngle(UP, spin);
          scl.set(1, h, 1);
          mat.compose(pos, quat, scl);
          stalks.setMatrixAt(i, mat);

          pos.set(x, h * 0.78, z);
          scl.set(1, 1, 1);
          mat.compose(pos, quat, scl);
          leaves.setMatrixAt(i, mat);
          i++;
        }
      }
      stalks.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      g.add(stalks, leaves);
      g.rotation.y = d.rotY || 0;
      break;
    }
    case 'waterTower': {
      const tankMat = materials.make({ color: 0xc9d2da, roughness: 0.5, metalness: 0.45 });
      const legMat = materials.make({ color: 0x7c848d, roughness: 0.7, metalness: 0.3 });
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r, 4.6, 14), tankMat);
      tank.position.y = 2.3;
      tank.castShadow = true;
      g.add(tank);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(d.r * 1.1, 1.8, 14), tankMat);
      roof.position.y = 5.5;
      roof.castShadow = true;
      g.add(roof);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 1.02, d.r * 1.02, 0.5, 14),
        materials.make({ color: 0xb8352c, roughness: 0.7, metalness: 0.1 }));
      band.position.y = 2.6;
      g.add(band);
      // Splayed legs down to the base of the collider below it.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 11, 6), legMat);
        leg.position.set(Math.cos(a) * d.r * 0.62, -5.5, Math.sin(a) * d.r * 0.62);
        leg.rotation.x = Math.sin(a) * 0.1;
        leg.rotation.z = -Math.cos(a) * 0.1;
        leg.castShadow = true;
        g.add(leg);
      }
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
  const spinners = [];
  for (const d of map.visuals || []) {
    const node = buildDecor(d, materials, map.theme);
    (d.spins ? spinner : group).add(node);
    node.traverse((o) => {
      if (o.userData.flutter !== undefined) flutterers.push(o);
      if (o.userData.drift !== undefined) drifters.push(o);
      if (o.userData.spinRate !== undefined) spinners.push(o);
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
      for (const sp of spinners) sp.rotation.z += sp.userData.spinRate * dt;
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
