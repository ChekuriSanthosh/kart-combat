/**
 * Turns a map blueprint into Three.js meshes.
 *
 * Every solid's mesh is generated from the exact numbers the physics uses, so
 * a wall can never be drawn somewhere other than where it blocks. The toy
 * look only ever softens a solid — rounded edges inside the same box, a
 * rounded top on the same cylinder — and everything else is decoration that
 * never touches collision.
 *
 * Static decoration is merged into a couple of vertex-coloured meshes (see
 * createBatch), so an arena full of trees, posts, studs and flags costs a
 * handful of draw calls rather than hundreds.
 */

import * as THREE from 'three';
import { topAt } from '/shared/collision.js';
import { createMaterialLibrary, disposeTree } from './materials.js';
import {
  roundedBoxGeometry, roundedCylinderGeometry, createBatch, batchMesh, xf,
} from './toyGeometry.js';
import { PROTO, addMesa, addPalm, addCactus, addTree, hash } from './props.js';
import { buildBackdrop } from './Backdrop.js';
import { createToyLights } from './lighting.js';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

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

/** A double-sided flag pennant: a downward triangle, 1 m wide and 1 m deep. */
const PENNANT = (() => {
  const g = new THREE.BufferGeometry();
  const p = [-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0];
  // Both windings, so it is visible from either side with a front-side material.
  g.setAttribute('position', new THREE.Float32BufferAttribute([...p, p[0], p[1], p[2], p[6], p[7], p[8], p[3], p[4], p[5]], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  return g;
})();

/* Low-detail prototypes for props that come in the hundreds. */
const CORN_STALK = new THREE.CylinderGeometry(0.055, 0.085, 1, 5);
const CORN_LEAF = new THREE.ConeGeometry(0.34, 1.1, 4);
const POST = roundedCylinderGeometry(1, 1, { top: 0.5, radial: 8, arc: 2 });
const BALE_RING = new THREE.TorusGeometry(1, 0.035, 4, 28);
const RING_TUBE = new THREE.TorusGeometry(1, 0.12, 8, 40);
for (const g of [CORN_STALK, CORN_LEAF, POST, BALE_RING, RING_TUBE]) g.deleteAttribute('uv');

/**
 * Is this solid's base resting on something? Grounded shapes keep a square
 * base (no groove where they meet the floor); floating platforms are rounded
 * underneath too, which is what you see of them from below.
 */
function isSupported(solid, map) {
  const floor = map.floorY ?? 0;
  if (floor > -100 && solid.y <= floor + 0.05) return true;
  for (const other of map.solids) {
    if (other === solid) continue;
    const top = topAt(other, solid.x, solid.z);
    if (top !== null && Math.abs(top - solid.y) < 0.06) return true;
  }
  return false;
}

/**
 * Builds the render side of one solid. Meshes that need their own material
 * are returned; parts that can share the vertex-coloured batch are added to
 * it (`ctx.batch`, or `ctx.spinBatch` for solids riding the dish).
 */
function buildSolid(solid, ctx) {
  const { map, materials } = ctx;
  const spec = ctx.spec(solid.mat);
  const mat = solid.tint !== undefined ? ctx.variant(solid.mat, solid.tint) : materials.get(solid.mat);
  const color = solid.tint ?? materials.color(solid.mat);
  const batch = solid.spins ? ctx.spinBatch : ctx.batch;
  let mesh = null;

  if (solid.t === 'box') {
    const supported = isSupported(solid, map);
    const r = spec.round ?? Math.min(0.85, 0.22 * Math.min(solid.w, solid.h, solid.d));
    mesh = new THREE.Mesh(ctx.boxGeometry(solid.w, solid.h, solid.d, r, !supported), mat);
    mesh.position.set(solid.x, solid.y + solid.h / 2, solid.z);
    mesh.rotation.y = solid.rotY || 0;
    if (spec.studs) {
      // Toy-brick studs across the top, about one per 1.3 m.
      const nx = Math.max(1, Math.round(solid.w / 1.3));
      const nz = Math.max(1, Math.round(solid.d / 1.3));
      const base = xf(solid.x, solid.y + solid.h, solid.z, solid.rotY || 0);
      const sr = Math.min(solid.w / nx, solid.d / nz) * 0.3;
      for (let i = 0; i < nx; i++) {
        for (let k = 0; k < nz; k++) {
          const lx = -solid.w / 2 + (i + 0.5) * (solid.w / nx);
          const lz = -solid.d / 2 + (k + 0.5) * (solid.d / nz);
          batch.add(POST, color, base.clone().multiply(xf(lx, -0.05, lz, 0, sr, 0.32, sr)));
        }
      }
    }
  } else if (solid.t === 'ramp') {
    mesh = new THREE.Mesh(rampGeometry(solid.w, solid.len, solid.rise), mat);
    mesh.position.set(solid.x, solid.y, solid.z);
    mesh.rotation.y = solid.rotY || 0;
  } else if (solid.t === 'ring') {
    mesh = buildRing(solid, spec, ctx);
  } else if (solid.inner && solid.rise !== undefined) {
    // A band of a smooth bowl: just the sloped surface from its inner edge up
    // to its outer one, the very line topAt() follows. Neighbouring bands meet
    // at the same height, so together they draw one continuous dish. Drawn as
    // a lathe so every band merges into one spinning mesh.
    const top = solid.y + solid.h;
    const profile = [
      new THREE.Vector2(solid.r, top),
      new THREE.Vector2(solid.inner, top - solid.rise),
    ];
    const geo = new THREE.LatheGeometry(profile, 128);
    geo.deleteAttribute('uv');
    ctx.dish.add(geo, color);
    ctx.own(geo);
  } else if (solid.inner) {
    // A terrace of the dish: tread plus the riser down to the next one in,
    // with a bevelled lip between them. Drawn as a lathe so all eighteen merge
    // into one spinning mesh.
    const top = solid.y + solid.h;
    const lip = 0.12;
    const profile = [
      new THREE.Vector2(solid.r, top),
      new THREE.Vector2(solid.inner + lip, top),
      new THREE.Vector2(solid.inner, top - lip),
      new THREE.Vector2(solid.inner, top - 0.5),
    ];
    const geo = new THREE.LatheGeometry(profile, 96);
    geo.deleteAttribute('uv');
    ctx.dish.add(geo, color);
    ctx.own(geo);
  } else {
    const supported = isSupported(solid, map);
    const opts = {
      top: solid.r * (spec.boulder ? 0.5 : spec.bale ? 0.28 : spec.ring ? 0.32 : 0.16),
      bottom: supported ? 0 : Math.min(solid.r * 0.06, 0.8),
      bulge: spec.boulder ? 0.07 : spec.bale ? 0.05 : 0,
      inset: spec.boulder ? 0.1 : 0,
      radial: solid.r > 6 ? 72 : solid.r > 2.5 ? 32 : 24,
    };
    mesh = new THREE.Mesh(ctx.own(roundedCylinderGeometry(solid.r, solid.h, opts)), mat);
    mesh.position.set(solid.x, solid.y, solid.z);
    if (spec.ring !== undefined) {
      // Pinball bumper: a bright ring round the crown and another at the foot.
      const ring = spec.ring;
      batch.add(RING_TUBE, ring, xf(solid.x, solid.y + solid.h * 0.86, solid.z, 0, solid.r * 0.98, solid.r * 0.98, solid.r * 1.5, Math.PI / 2));
      batch.add(RING_TUBE, ring, xf(solid.x, solid.y + 0.25, solid.z, 0, solid.r * 1.02, solid.r * 1.02, solid.r * 2.2, Math.PI / 2));
    }
    if (spec.bale) {
      // The rolled-up spiral of a round bale, drawn as rings on its top.
      for (const k of [0.3, 0.55, 0.8]) {
        batch.add(BALE_RING, spec.baleLine ?? 0xd99a1e, xf(solid.x, solid.y + solid.h + 0.005, solid.z, 0, solid.r * k * 0.86, solid.r * k * 0.86, 1, Math.PI / 2));
      }
    }
  }

  if (!mesh) return null;
  mesh.traverse((o) => {
    if (!o.isMesh || o.userData.noShadow) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return mesh;
}

/**
 * A ring wall: a kerb of chunky rounded blocks you can read at a glance
 * (striped when the palette entry lists `stripes`), and optionally a
 * near-invisible glass sleeve above it so the full barrier height is hinted
 * without walling off the view of the arena.
 */
function buildRing(solid, spec, ctx) {
  const group = new THREE.Group();
  const kerbH = Math.min(spec.kerb ?? 1.1, solid.h);
  const depth = spec.kerbDepth ?? 1.2;
  const centre = solid.r + depth / 2;
  const count = Math.max(24, Math.round((TAU * centre) / (spec.blockLen ?? 3)));
  const chord = 2 * centre * Math.tan(Math.PI / count) + 0.04;
  const stripes = spec.stripes ?? [spec.color];
  const geo = ctx.boxGeometry(chord, kerbH, depth, Math.min(0.4, kerbH * 0.35), false, 2);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    ctx.batch.add(geo, stripes[i % stripes.length], xf(
      solid.x + Math.cos(a) * centre, solid.y + kerbH / 2, solid.z + Math.sin(a) * centre,
      Math.PI / 2 - a,
    ));
  }
  if (spec.glass !== false && solid.h > kerbH + 0.5) {
    const glass = new THREE.Mesh(
      ctx.own(new THREE.CylinderGeometry(solid.r, solid.r, solid.h - kerbH, 96, 1, true)),
      ctx.materials.lambert({
        color: spec.glassColor ?? 0xd6efff, transparent: true, opacity: 0.08,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    glass.position.set(solid.x, solid.y + kerbH + (solid.h - kerbH) / 2, solid.z);
    glass.userData.noShadow = true;
    group.add(glass);
  }
  return group;
}

/** Yellow chevrons on launch ramps, pointing up the slope, so they read as jumps. */
function launchMarkings(solid, ctx) {
  const base = xf(solid.x, solid.y, solid.z, solid.rotY || 0);
  const theta = Math.atan2(solid.rise, solid.len);
  const arm = solid.w * 0.36;
  const phi = 0.75;
  for (let i = 0; i < 3; i++) {
    const t = 0.2 + i * 0.27;
    const along = -solid.len / 2 + t * solid.len;
    for (const s of [-1, 1]) {
      const m = base.clone()
        .multiply(new THREE.Matrix4().makeTranslation(0, solid.rise * t + 0.04, along))
        .multiply(new THREE.Matrix4().makeRotationX(-theta))
        .multiply(new THREE.Matrix4().makeTranslation(s * (arm / 2) * Math.sin(phi), 0, 0))
        .multiply(new THREE.Matrix4().makeRotationY(-s * phi))
        .multiply(new THREE.Matrix4().makeScale(0.6, 0.1, arm));
      ctx.batch.add(PROTO.cube, ctx.theme.chevron ?? 0xffd23f, m);
    }
  }
}

/** A flat decal mesh (painted circles, patches) that never z-fights the floor. */
function decal(geo, material) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  return mesh;
}

function buildDecor(d, ctx) {
  const { materials, theme } = ctx;
  const batch = d.spins ? ctx.spinBatch : ctx.batch;
  // Everything this decor adds to the batch is placed relative to it.
  const base = xf(d.x, d.y, d.z, d.rotY || 0);
  const put = (geo, color, local) => batch.add(geo, color, local ? base.clone().multiply(local) : base);
  const g = new THREE.Group();
  g.position.set(d.x, d.y, d.z);
  g.rotation.y = d.rotY || 0;

  switch (d.kind) {
    case 'ground': {
      // Round by default: a square ground plane shows its corners against the
      // sky and makes the world look like a floating tile.
      const mesh = new THREE.Mesh(
        ctx.own(d.round
          ? new THREE.CircleGeometry(d.size / 2, 128)
          : new THREE.PlaneGeometry(d.size, d.size)),
        materials.get(d.mat || 'sand'),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -0.02;
      mesh.receiveShadow = true;
      g.add(mesh);
      return g;
    }
    case 'patch': {
      const m = ctx.decalMaterial(d.mat);
      const patch = decal(ctx.own(new THREE.CircleGeometry(d.r, 28)), m);
      patch.position.y = 0.01;
      g.add(patch);
      return g;
    }
    case 'paintRing': {
      const ring = decal(ctx.own(new THREE.RingGeometry(d.r - (d.w ?? 0.5), d.r, 128)), ctx.decalMaterial(null, d.color ?? 0xffffff));
      ring.position.y = 0.01;
      g.add(ring);
      return g;
    }
    case 'flag': {
      put(PROTO.stick, 0xffffff, xf(0, d.height / 2, 0, 0, 0.13, d.height, 0.13));
      put(PROTO.ball, 0xffd23f, xf(0, d.height + 0.1, 0, 0, 0.26));
      const hues = theme.flags ?? [0xff4a4a, 0x45d65a, 0x2a7de1, 0xffd23f];
      const cloth = new THREE.Mesh(ctx.clothGeometry, materials.flat(hues[d.tint % hues.length], THREE.DoubleSide));
      cloth.position.set(0, d.height - 0.75, 0);
      cloth.castShadow = true;
      cloth.userData.flutter = hash(d.x * 13.1 + d.z * 7.7) * TAU;
      g.add(cloth);
      return g;
    }
    case 'barrier': {
      // A row of alternating red and white rounded blocks hugging the wall.
      const n = Math.max(2, Math.round(d.len / 1.4));
      const len = d.len / n;
      const geo = ctx.boxGeometry(len - 0.08, 0.9, 0.8, 0.28, false, 2);
      const tones = d.colors ?? [0xff4a4a, 0xffffff];
      for (let i = 0; i < n; i++) {
        put(geo, tones[i % tones.length], xf(-d.len / 2 + (i + 0.5) * len, 0.45, 0));
      }
      return null;
    }
    case 'mesa':
      addMesa(batch, base, 0, 0, d.r, d.h, theme.mesaBands ?? [0xe9844a, 0xf6b26b], Math.round(d.x * 3 + d.z), -2);
      return null;
    case 'palm':
      addPalm(batch, base, 0, 0, d.h, Math.round(d.x * 7 + d.z * 3));
      return null;
    case 'cactus':
      addCactus(batch, base, 0, 0, d.h, Math.round(d.x * 5 + d.z * 11));
      return null;
    case 'tree':
      addTree(batch, base, 0, 0, d.h, Math.round(d.x * 5 + d.z * 11), theme.trees);
      return null;
    case 'bunting': {
      // Two poles and a sagging string of pennants between them.
      const half = d.w / 2;
      for (const s of [-1, 1]) {
        put(PROTO.stick, 0xffffff, xf(s * half, d.h / 2, 0, 0, 0.16, d.h, 0.16));
        put(PROTO.ball, 0xffd23f, xf(s * half, d.h + 0.15, 0, 0, 0.3));
      }
      const n = Math.round(d.w / 1.3);
      const hues = theme.flags ?? [0xff4a4a, 0xffd23f, 0x2a7de1, 0x45d65a];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = -half + t * d.w;
        const sag = Math.sin(t * Math.PI) * 1.1;
        put(PENNANT, hues[i % hues.length], xf(x, d.h - 0.3 - sag, 0, 0, 0.95, 1.15, 1));
      }
      return null;
    }
    case 'cropField': {
      put(PROTO.cube, d.soil ?? 0xc98a4a, xf(0, 0.02, 0, 0, d.w, 0.04, d.d));
      const rowD = (d.d / d.rows) * 0.45;
      for (let i = 0; i < d.rows; i++) {
        put(ctx.boxGeometry(d.w * 0.96, 0.55, rowD, 0.2, false, 1), d.crop ?? 0x62c83a,
          xf(0, 0.27, -d.d / 2 + (i + 0.5) * (d.d / d.rows)));
      }
      return null;
    }
    case 'pond': {
      // Bright water with the floor checker in a lighter blue, ringed by a
      // pale bank. Visual only: karts splash straight across.
      const water = decal(ctx.own(new THREE.CircleGeometry(d.r, 64)), materials.get('water'));
      water.position.y = 0.04;
      g.add(water);
      const bank = new THREE.LatheGeometry([
        new THREE.Vector2(d.r + 1.6, 0),
        new THREE.Vector2(d.r + 1.1, 0.16),
        new THREE.Vector2(d.r + 0.2, 0.16),
        new THREE.Vector2(d.r - 0.2, 0.02),
      ], 64);
      bank.deleteAttribute('uv');
      ctx.own(bank);
      put(bank, d.bank ?? 0xf3e7c4);
      // A few lily pads to say "pond" from across the field.
      for (let i = 0; i < 5; i++) {
        const a = hash(i + d.x) * TAU;
        const rr = d.r * (0.3 + hash(i * 3 + d.z) * 0.55);
        put(PROTO.stick, 0x45d65a, xf(Math.cos(a) * rr, 0.07, Math.sin(a) * rr, 0, 0.7, 0.04, 0.7));
      }
      return g;
    }
    case 'barnShell': {
      // The walls are real solids; this is the trim, roof and gables that sit
      // on top of them, which is why it has no collider of its own.
      const halfW = d.w / 2;
      const trim = 0xffffff;
      const roof = d.roof ?? 0x8e4b3a;
      const pitch = 0.55;
      const run = halfW + 0.7;
      const rise = run * Math.tan(pitch);
      const slab = run / Math.cos(pitch);
      for (const side of [-1, 1]) {
        put(ctx.boxGeometry(slab, 0.45, d.d + 1.6, 0.18), roof, xf(
          side * run / 2, d.h + 0.15 + rise / 2, 0, 0, 1, 1, 1, 0, -side * pitch,
        ));
        // White trim: corner posts and a beam along the top of each wall.
        for (const end of [-1, 1]) {
          put(ctx.boxGeometry(1.7, d.h + 0.1, 1.7, 0.3, false), trim,
            xf(side * (halfW - 0.65), (d.h + 0.1) / 2, end * (d.d / 2 - 0.6)));
        }
        put(ctx.boxGeometry(1.6, 0.5, d.d, 0.2), trim, xf(side * (halfW - 0.65), d.h, 0));
      }
      const ridge = new THREE.Shape();
      ridge.moveTo(-run, 0);
      ridge.lineTo(run, 0);
      ridge.lineTo(0, rise);
      ridge.closePath();
      const gable = ctx.own(new THREE.ExtrudeGeometry(ridge, { depth: 0.5, bevelEnabled: false }));
      gable.deleteAttribute('uv');
      for (const end of [-1, 1]) {
        put(gable, d.wall ?? 0xe8443a, xf(0, d.h + 0.15, end * (d.d / 2) - 0.25));
        // White X-brace over the doorway, the classic barn-door read.
        for (const s of [-1, 1]) {
          put(PROTO.cube, trim, xf(0, d.h + 0.15 + rise * 0.33, end * (d.d / 2 + 0.32), 0, rise * 0.95, 0.35, 0.16, 0, s * 0.62));
        }
      }
      put(ctx.boxGeometry(0.7, 0.7, d.d + 1.8, 0.3), trim, xf(0, d.h + 0.15 + rise, 0));
      return null;
    }
    case 'siloCap': {
      put(PROTO.dome, d.cap ?? 0x4a98f0, xf(0, -0.02, 0, 0, d.r * 1.04, d.r * 0.8, d.r * 1.04));
      put(PROTO.ball, 0xffffff, xf(0, d.r * 0.78, 0, 0, 0.45));
      // Painted bands down the silo, so a column of cream reads as a silo.
      for (const y of d.bands ?? [-10.5, -5.5]) {
        put(PROTO.stick, d.band ?? 0xe8443a, xf(0, y, 0, 0, d.r + 0.06, 0.8, d.r + 0.06));
      }
      return null;
    }
    case 'windmill': {
      // The tower itself is the collider's own mesh (a white rounded column),
      // so what you see is exactly what you hit; the old tower was drawn twice
      // the collider's width and karts sank into it. This adds the red band,
      // the cap and the door, plus the sails: at 16 m tall it is the thing
      // players navigate by, so it has to be legible from across the field.
      put(PROTO.stick, 0xe8443a, xf(0, d.h * 0.55, 0, 0, d.r * 1.07, 0.9, d.r * 1.07));
      put(PROTO.cone, 0xe8443a, xf(0, d.h + d.r * 0.75, 0, 0, d.r * 1.55, d.r * 1.9, d.r * 1.55));
      put(ctx.boxGeometry(1.8, 3.0, 0.5, 0.25, false), 0x2a7de1, xf(0, 1.5, d.r - 0.1));

      // The sails turn, so they are a real node marked for the frame loop.
      const sails = new THREE.Group();
      sails.position.set(0, d.h * 0.9, d.r + 1.0);
      const sailMat = materials.flat(0xffffff);
      const armMat = materials.flat(0x9a5b2e);
      const armGeo = ctx.own(new THREE.BoxGeometry(0.45, 11, 0.45));
      const bladeGeo = ctx.own(roundedBoxGeometry(2.6, 8.5, 0.22, 0.1, 1));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        const arm = new THREE.Mesh(armGeo, armMat);
        arm.position.set(Math.sin(a) * 5.5, Math.cos(a) * 5.5, 0);
        arm.rotation.z = -a;
        const blade = new THREE.Mesh(bladeGeo, sailMat);
        blade.position.set(Math.sin(a) * 6.2, Math.cos(a) * 6.2, 0.3);
        blade.rotation.z = -a;
        blade.castShadow = true;
        sails.add(arm, blade);
      }
      const hub = new THREE.Mesh(ctx.own(new THREE.SphereGeometry(0.8, 12, 8)), materials.flat(0xffd23f));
      sails.add(hub);
      sails.userData.spinRate = 0.55;
      g.add(sails);
      return g;
    }
    case 'fenceLine': {
      // A white picket ring: one post per step and two rails between posts.
      const step = (TAU * d.r) / d.posts;
      const railGeo = ctx.boxGeometry(step + 0.3, 0.2, 0.14, 0.06, true, 1);
      for (let i = 0; i < d.posts; i++) {
        const a = (i / d.posts) * TAU;
        put(POST, d.color ?? 0xffffff, xf(Math.cos(a) * d.r, 0, Math.sin(a) * d.r, 0, 0.2, d.h + 0.2, 0.2));
        const mid = ((i + 0.5) / d.posts) * TAU;
        for (const railY of [d.h * 0.42, d.h * 0.78]) {
          put(railGeo, d.color ?? 0xffffff, xf(Math.cos(mid) * d.r, railY, Math.sin(mid) * d.r, -mid + Math.PI / 2));
        }
      }
      return null;
    }
    case 'treeline': {
      for (let i = 0; i < d.count; i++) {
        const a = d.phase + (i / d.count) * TAU;
        const h = d.h + ((i * 7919) % 400) / 100;
        addTree(batch, base, Math.cos(a) * d.r, Math.sin(a) * d.r, h, i, theme.trees);
      }
      return null;
    }
    case 'tractor': {
      put(ctx.boxGeometry(1.9, 1.2, 3.1, 0.35), d.body ?? 0xff4a4a, xf(0, 1.15, 0));
      put(ctx.boxGeometry(1.6, 1.2, 1.3, 0.3), d.cab ?? 0xffd23f, xf(0, 2.25, -0.6));
      put(ctx.boxGeometry(1.4, 0.2, 1.5, 0.08), 0xffffff, xf(0, 2.95, -0.6));
      put(PROTO.stick, 0x5a5a66, xf(0.5, 2.6, 1.0, 0, 0.12, 1.4, 0.12));
      for (const [wx, wz, wr] of [[-1.05, -1.0, 0.95], [1.05, -1.0, 0.95], [-1.0, 1.1, 0.6], [1.0, 1.1, 0.6]]) {
        put(PROTO.stick, 0x3a3a46, xf(wx, wr, wz, 0, wr, 0.5, wr, 0, Math.PI / 2));
        put(PROTO.stick, 0xffd23f, xf(wx * 1.06, wr, wz, 0, wr * 0.5, 0.52, wr * 0.5, 0, Math.PI / 2));
      }
      return null;
    }
    case 'cornPatch': {
      // Two metres of corn with no collider: it hides people without stopping
      // them. Positions are derived from the indices rather than random, so
      // the field is identical on every client without needing a seed.
      for (let r = 0; r < d.rows; r++) {
        for (let c = 0; c < d.per; c++) {
          const jx = (((r * 73 + c * 149) % 100) / 100 - 0.5) * 0.9;
          const jz = (((r * 191 + c * 37) % 100) / 100 - 0.5) * 0.9;
          const h = 2.0 + ((r * 17 + c * 29) % 60) / 100;
          const x = -d.w / 2 + (c + 0.5) * (d.w / d.per) + jx;
          const z = -d.d / 2 + (r + 0.5) * (d.d / d.rows) + jz;
          const spin = ((r * 53 + c * 97) % 628) / 100;
          put(CORN_STALK, 0x58b830, xf(x, h * 0.5, z, spin, 1, h, 1));
          put(CORN_LEAF, (r + c) % 3 ? 0x7ed957 : 0x9be35a, xf(x, h * 0.78, z, spin));
          if ((r * 7 + c * 3) % 4 === 0) put(PROTO.ball, 0xffd23f, xf(x + 0.12, h * 0.62, z, spin, 0.12, 0.3, 0.12));
        }
      }
      return null;
    }
    case 'waterTower': {
      put(roundedCylinderGeometry(d.r, 4.6, { top: 0.6, bottom: 0.6, radial: 20, arc: 3 }), d.tank ?? 0x7fbaff, xf(0, 0, 0));
      put(PROTO.cone, 0xe8443a, xf(0, 5.4, 0, 0, d.r * 1.12, 1.9, d.r * 1.12));
      put(PROTO.stick, 0xffffff, xf(0, 2.6, 0, 0, d.r + 0.05, 0.5, d.r + 0.05));
      // Splayed legs down to the base of the collider below it.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        put(PROTO.stick, 0xffffff, xf(Math.cos(a) * d.r * 0.62, -5.5, Math.sin(a) * d.r * 0.62, 0, 0.2, 11, 0.2, Math.sin(a) * 0.1, -Math.cos(a) * 0.1));
      }
      return null;
    }
    case 'floatIsle': {
      // A little floating island that bobs: rounded rock, grass cap, a tree.
      const isle = createBatch();
      const id = new THREE.Matrix4();
      const rr = d.r;
      isle.add(PROTO.cone, d.rock ?? 0xc98a5a, xf(0, -rr * 0.55, 0, 0, rr * 0.85, rr * 1.4, rr * 0.85, Math.PI));
      isle.add(ctx.own(roundedCylinderGeometry(rr, rr * 0.35, { top: rr * 0.15, bottom: rr * 0.1, radial: 18, arc: 3 })), d.grass ?? 0x58d935, xf(0, -rr * 0.2, 0));
      addTree(isle, id, rr * 0.2, -rr * 0.1, rr * 1.1, Math.round(rr * 10), theme.trees);
      const mesh = batchMesh(isle, ctx.vertexMaterial, { castShadow: false, receiveShadow: false });
      mesh.matrixAutoUpdate = true;
      g.add(mesh);
      g.userData.drift = hash(d.x + d.z) * TAU;
      g.userData.baseY = d.y;
      return g;
    }
    case 'candyPole': {
      // White pole wound with coloured bands, topped with a big ball.
      const bands = 7;
      for (let i = 0; i < bands; i++) {
        put(PROTO.stick, i % 2 ? 0xffffff : (d.color ?? 0xff6fae),
          xf(0, (i + 0.5) * (d.h / bands), 0, 0, 0.35, d.h / bands + 0.01, 0.35));
      }
      put(PROTO.ball, d.top ?? 0xffd23f, xf(0, d.h + 0.6, 0, 0, 0.9));
      return null;
    }
    case 'centreEmblem': {
      const hues = theme.emblem ?? [0xff4a4a, 0xffd23f, 0x2a7de1, 0x45d65a];
      const wedges = 8;
      for (let i = 0; i < wedges; i++) {
        const wedge = new THREE.CircleGeometry(d.r, 10, (i / wedges) * TAU, TAU / wedges);
        wedge.rotateX(-Math.PI / 2);
        wedge.deleteAttribute('uv');
        put(ctx.own(wedge), hues[i % hues.length]);
      }
      put(ctx.own(roundedCylinderGeometry(2, 0.3, { top: 0.25, radial: 32 })), 0xffffff, xf(0, -0.02, 0));
      return null;
    }
    case 'drum': {
      // The outside of the stadium bowl. The terraces only draw their treads
      // and risers, so without this the dish would hover over the lawn.
      const geo = new THREE.LatheGeometry([new THREE.Vector2(d.r, 0), new THREE.Vector2(d.r, d.h)], 96);
      geo.deleteAttribute('uv');
      put(ctx.own(geo), d.color ?? 0x2a7de1);
      return null;
    }
    case 'grooveRing':
      put(RING_TUBE, theme.groove ?? 0xffd23f, xf(0, 0, 0, 0, d.r, d.r, 1, Math.PI / 2));
      return null;
    case 'floodlight': {
      put(PROTO.stick, 0xffffff, xf(0, d.h / 2, 0, 0, 0.35, d.h, 0.35));
      put(ctx.boxGeometry(3.2, 2.0, 0.8, 0.3), 0x2a7de1, xf(0, d.h, 0, Math.atan2(-d.x, -d.z)));
      put(ctx.boxGeometry(2.8, 1.6, 0.2, 0.15), 0xfff3b0, xf(0, d.h, 0, Math.atan2(-d.x, -d.z))
        .multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.42)));
      return null;
    }
    case 'stands': {
      // Tiered grandstands all the way round, in coloured sections, with a
      // roof-line of flags: the stadium is a place with a crowd, not a bowl in
      // the dark.
      const sectors = d.sectors ?? 16;
      const hues = theme.seats ?? [0xff4a4a, 0x2a7de1, 0xffd23f, 0x45d65a];
      for (let s = 0; s < sectors; s++) {
        const a0 = (s / sectors) * TAU;
        const a = a0 + TAU / sectors / 2;
        for (let row = 0; row < d.rows; row++) {
          const rr = d.r + row * d.step;
          const len = 2 * rr * Math.tan(Math.PI / sectors) * 0.96;
          const y = d.base + row * d.rise;
          put(ctx.boxGeometry(len, d.rise + 0.4, d.step + 0.2, 0.35, false, 1),
            row % 2 ? hues[s % hues.length] : 0xffffff,
            xf(Math.cos(a) * rr, y + (d.rise + 0.4) / 2 - 0.2, Math.sin(a) * rr, Math.PI / 2 - a));
        }
        // Back wall behind the top row, then a pennant pole on each sector.
        const back = d.r + d.rows * d.step + 0.4;
        const topY = d.base + d.rows * d.rise;
        put(ctx.boxGeometry(2 * back * Math.tan(Math.PI / sectors) * 0.98, topY - d.base + 1.5, 1.0, 0.4, false, 1), 0xb3dbff,
          xf(Math.cos(a) * back, d.base + (topY - d.base + 1.5) / 2 - 0.4, Math.sin(a) * back, Math.PI / 2 - a));
        put(PROTO.stick, 0xffffff, xf(Math.cos(a0) * back, topY + 3, Math.sin(a0) * back, 0, 0.14, 6, 0.14));
        put(PENNANT, hues[(s + 1) % hues.length], xf(Math.cos(a0) * back, topY + 5.4, Math.sin(a0) * back, -a0, 1.6, 1.4, 1, 0, Math.PI / 2));
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * @param {object} map blueprint from shared/maps
 * @returns {{ group, materials, spinner, sun, update, dispose }}
 */
export function buildMap(map) {
  const group = new THREE.Group();
  group.name = map.id;
  const theme = map.theme;
  const materials = createMaterialLibrary(theme);
  const owned = [];
  const boxCache = new Map();
  const variants = new Map();
  const decals = new Map();

  const ctx = {
    map,
    theme,
    materials,
    batch: createBatch(),
    spinBatch: createBatch(),
    dish: createBatch(),
    vertexMaterial: materials.lambert({ vertexColors: true }),
    clothGeometry: (() => {
      const geo = new THREE.PlaneGeometry(2.2, 1.3);
      geo.translate(1.1, 0, 0);
      owned.push(geo);
      return geo;
    })(),
    own(x) { owned.push(x); return x; },
    spec(name) {
      const p = theme.palette?.[name];
      return typeof p === 'object' && p !== null ? p : { color: p ?? 0xcccccc };
    },
    /** A palette material in another colour, for solids carrying a `tint`. */
    variant(name, tint) {
      const key = `${name}#${tint}`;
      let m = variants.get(key);
      if (!m) {
        m = materials.make({ ...ctx.spec(name), color: tint });
        variants.set(key, m);
      }
      return m;
    },
    /** Rounded boxes come in a few sizes repeated many times; build each once. */
    boxGeometry(w, h, d, r, roundBottom = true, seg = 3) {
      const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}|${roundBottom}|${seg}`;
      let geo = boxCache.get(key);
      if (!geo) {
        geo = roundedBoxGeometry(w, h, d, r, seg, roundBottom);
        boxCache.set(key, geo);
        owned.push(geo);
      }
      return geo;
    },
    decalMaterial(name, color) {
      const key = name ?? `#${color}`;
      let m = decals.get(key);
      if (!m) {
        m = name ? materials.make(ctx.spec(name)) : materials.lambert({ color });
        decals.set(key, m);
      }
      return m;
    },
  };

  // The dish spins, so anything marked `spins` lives under its own pivot.
  const spinner = new THREE.Group();
  group.add(spinner);

  for (const solid of map.solids) {
    const mesh = buildSolid(solid, ctx);
    if (mesh) (solid.spins ? spinner : group).add(mesh);
    if (solid.launch) launchMarkings(solid, ctx);
  }

  const flutterers = [];
  const drifters = [];
  const spinners = [];
  for (const d of map.visuals || []) {
    const node = buildDecor(d, ctx);
    if (!node) continue;
    (d.spins ? spinner : group).add(node);
    node.traverse((o) => {
      if (o.userData.flutter !== undefined) flutterers.push(o);
      if (o.userData.drift !== undefined) drifters.push(o);
      if (o.userData.spinRate !== undefined) spinners.push(o);
    });
  }

  // Merge everything static into as few meshes as possible.
  const staticMesh = batchMesh(ctx.batch, ctx.vertexMaterial);
  if (staticMesh) group.add(staticMesh);
  const spinMesh = batchMesh(ctx.spinBatch, ctx.vertexMaterial);
  if (spinMesh) spinner.add(spinMesh);
  if (ctx.dish.count) {
    const dishSpec = theme.dish ?? {};
    const dishMat = materials.make({ color: 0xffffff, vertexColors: true, polar: dishSpec.polar ?? -0.06, wedges: dishSpec.wedges ?? 24, size: dishSpec.ring ?? 2 });
    const dishMesh = batchMesh(ctx.dish, dishMat);
    spinner.add(dishMesh);
  }

  const backdrop = buildBackdrop(theme);
  group.add(backdrop.group);

  // ── Lighting rig: the shared toy rig, its shadow box fitted to the arena ──
  const lights = createToyLights({
    shadowSize: (map.arenaRadius || 46) * 1.12,
    target: [0, 0, 0],
    bounce: theme.bounce,
  });
  group.add(lights);

  let t = 0;
  return {
    group,
    materials,
    spinner,
    sun: lights.userData.sun,
    update(dt) {
      t += dt;
      if (map.spin) spinner.rotation.y += map.spin.omega * dt;
      for (const f of flutterers) f.rotation.y = Math.sin(t * 2 + f.userData.flutter) * 0.35;
      for (const sp of spinners) sp.rotation.z += sp.userData.spinRate * dt;
      for (const d of drifters) {
        d.rotation.y += dt * 0.05;
        d.position.y = (d.userData.baseY ?? 0) + Math.sin(t * 0.4 + d.userData.drift) * 1.5;
      }
      backdrop.update(dt);
    },
    dispose() {
      disposeTree(group);
      backdrop.dispose();
      for (const o of owned) o.dispose?.();
      materials.dispose();
    },
  };
}

export { UP };
