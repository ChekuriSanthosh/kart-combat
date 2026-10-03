/**
 * Toy scenery props, written straight into a batch (see toyGeometry.js).
 *
 * Nothing here collides with anything: these are the cacti, palms, banded
 * mesas, bubbly trees and clouds that make an arena read as a themed
 * playground rather than a floor in a void. Shapes are a handful of soft
 * primitives in bright flat colours, so they sit in the same visual language
 * as the karts. Every prop is deterministic for a given `seed`, so all
 * clients draw the same world.
 */

import * as THREE from 'three';
import { roundedCylinderGeometry, xf } from './toyGeometry.js';

/*
 * Shared prototypes. The batch only reads them, so one of each serves every
 * prop. They are small and live for the page's lifetime, which is cheaper
 * than rebuilding them for every arena.
 */
const PROTO = {
  ball: new THREE.SphereGeometry(1, 14, 10),
  dome: new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  stick: new THREE.CylinderGeometry(1, 1, 1, 10, 1),
  taper: new THREE.CylinderGeometry(0.72, 1, 1, 12, 1),
  drum: new THREE.CylinderGeometry(0.9, 1, 1, 14, 1),
  cone: new THREE.ConeGeometry(1, 1, 10, 1),
  cube: new THREE.BoxGeometry(1, 1, 1),
  pill: roundedCylinderGeometry(1, 1, { top: 0.6, radial: 12, arc: 4 }),
  pebble: roundedCylinderGeometry(1, 1, { top: 0.55, bulge: 0.08, inset: 0.12, radial: 14, arc: 4 }),
};
for (const g of Object.values(PROTO)) g.deleteAttribute('uv');
export { PROTO };

/** Cheap deterministic 0..1 noise from an integer seed. */
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A banded mesa: stacked, slightly tapering drums in alternating warm tones
 * with a domed cap — the layered rock formations that ring the desert.
 * `base` lets a mesa sink into the ground so it never shows a hard bottom.
 */
export function addMesa(batch, parent, x, z, r, h, bands, seed = 0, base = -2) {
  const tiers = Math.max(3, Math.round(h / 4.5));
  const tierH = (h - base) / (tiers + 0.6);
  let y = base;
  let rr = r;
  for (let i = 0; i < tiers; i++) {
    // Each drum narrows by 10% and the next starts a little inside it, so
    // the stack steps in with a ledge at every band.
    const m = xf(x, y, z, hash(seed * 3 + i) * Math.PI).premultiply(parent)
      .multiply(new THREE.Matrix4().makeScale(rr, tierH, rr))
      .multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0));
    batch.add(PROTO.drum, bands[i % bands.length], m);
    y += tierH;
    rr *= 0.85 + hash(seed + i) * 0.03;
  }
  // Rounded cap so the top reads as soft rock rather than a cut cylinder.
  batch.add(PROTO.dome, bands[tiers % bands.length],
    xf(x, y - 0.05, z, 0, rr * 1.02, tierH * 0.9, rr * 1.02).premultiply(parent));
}

/** A curvy palm: a leaning, segmented trunk and a drooping crown of fronds. */
export function addPalm(batch, parent, x, z, h, seed = 0, colors = {}) {
  const trunkA = colors.trunk ?? 0xd9893a;
  const trunkB = colors.trunkAlt ?? 0xe8a24e;
  const leaf = colors.leaf ?? 0x3ccf4a;
  const leafAlt = colors.leafAlt ?? 0x2fb83f;
  const lean = 0.25 + hash(seed) * 0.25;
  const heading = hash(seed + 7) * Math.PI * 2;
  const segs = 7;
  let px = 0;
  let py = 0;
  let pz = 0;
  const segH = h / segs;
  for (let i = 0; i < segs; i++) {
    // The lean grows towards the top, which is what makes the trunk curve.
    const tilt = lean * (i / segs) * 1.6;
    const rad = 0.42 * (1 - i * 0.07);
    const m = xf(x + px, py, z + pz, heading, 1, 1, 1, tilt)
      .multiply(new THREE.Matrix4().makeScale(rad, segH * 1.08, rad))
      .multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0))
      .premultiply(parent);
    batch.add(PROTO.taper, i % 2 ? trunkA : trunkB, m);
    py += Math.cos(tilt) * segH;
    px += Math.sin(tilt) * segH * Math.sin(heading);
    pz += Math.sin(tilt) * segH * Math.cos(heading);
  }
  const top = [x + px, py, z + pz];
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + hash(seed + i) * 0.4;
    const len = h * 0.36;
    // Each frond is a flattened ball pushed out from the crown and tipped down.
    const m = xf(top[0], top[1], top[2], a)
      .multiply(new THREE.Matrix4().makeRotationZ(-0.42 - hash(seed + i * 5) * 0.25))
      .multiply(new THREE.Matrix4().makeTranslation(len * 0.55, 0, 0))
      .multiply(new THREE.Matrix4().makeScale(len * 0.6, 0.16, 0.62))
      .premultiply(parent);
    batch.add(PROTO.ball, i % 2 ? leaf : leafAlt, m);
  }
  batch.add(PROTO.ball, 0x8a5a2b, xf(top[0], top[1] - 0.35, top[2], 0, 0.42).premultiply(parent));
}

/** A cartoon saguaro: rounded trunk, one or two elbowed arms, a flower. */
export function addCactus(batch, parent, x, z, h, seed = 0, color = 0x47c24a) {
  const r = h * 0.13;
  const base = parent.clone().multiply(xf(x, 0, z, hash(seed) * Math.PI));
  const put = (geo, col, lx, ly, lz, sx, sy, sz, rz = 0) => {
    batch.add(geo, col, base.clone().multiply(xf(lx, ly, lz, 0, sx, sy, sz, 0, rz)));
  };
  put(PROTO.pill, color, 0, 0, 0, r, h, r);
  const arms = 1 + Math.round(hash(seed + 2));
  for (let i = 0; i < arms; i++) {
    const side = i === 0 ? 1 : -1;
    const ay = h * (0.35 + hash(seed + 3 + i) * 0.2);
    const armH = h * (0.3 + hash(seed + 5 + i) * 0.12);
    const ar = r * 0.72;
    const reach = r * 1.7;
    // Elbow running out sideways from inside the trunk, then the arm rising
    // from its end.
    put(PROTO.stick, color, side * reach * 0.5, ay, 0, ar, reach, ar, Math.PI / 2);
    put(PROTO.pill, color, side * reach, ay - ar * 0.5, 0, ar, armH, ar);
  }
  put(PROTO.ball, 0xff7eb6, 0, h - r * 0.15, 0, r * 0.55, r * 0.4, r * 0.55);
}

/** A bubbly tree: a short trunk under two or three overlapping round puffs. */
export function addTree(batch, parent, x, z, h, seed = 0, colors = {}) {
  const trunk = colors.trunk ?? 0x9a5b2e;
  const leaves = colors.leaves ?? [0x3fbf3f, 0x56d24a, 0x2fae3c];
  const trunkH = h * 0.42;
  batch.add(PROTO.taper, trunk, xf(x, 0, z, 0, h * 0.07, trunkH, h * 0.07)
    .multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)).premultiply(parent));
  const puffs = 2 + Math.round(hash(seed + 1));
  for (let i = 0; i < puffs; i++) {
    const a = hash(seed + i * 3) * Math.PI * 2;
    const off = i === 0 ? 0 : h * 0.16;
    const rad = h * (i === 0 ? 0.34 : 0.24);
    batch.add(PROTO.ball, leaves[(seed + i) % leaves.length],
      xf(x + Math.cos(a) * off, trunkH + h * 0.18 + (i === 0 ? h * 0.08 : 0), z + Math.sin(a) * off, 0, rad, rad * 0.9, rad)
        .premultiply(parent));
  }
}

/** A puffy cloud: a cluster of squashed balls with a flattened underside. */
export function addCloud(batch, parent, x, y, z, size, seed = 0, color = 0xffffff) {
  const puffs = 4 + Math.round(hash(seed) * 2);
  for (let i = 0; i < puffs; i++) {
    const t = puffs > 1 ? i / (puffs - 1) - 0.5 : 0;
    const rad = size * (0.42 + hash(seed + i * 7) * 0.28) * (1 - Math.abs(t) * 0.7);
    batch.add(PROTO.ball, color, xf(
      x + t * size * 1.9,
      y + rad * 0.25 + hash(seed + i) * size * 0.12,
      z + (hash(seed + i * 13) - 0.5) * size * 0.6,
      0, rad, rad * 0.72, rad,
    ).premultiply(parent));
  }
}

/** A soft rounded hill (half an ellipsoid). */
export function addHill(batch, parent, x, z, r, h, color, base = -1) {
  batch.add(PROTO.dome, color, xf(x, base, z, 0, r, h - base, r).premultiply(parent));
}
