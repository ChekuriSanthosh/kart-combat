/**
 * The kart and its driver.
 *
 * Both are picked from a set of cosmetics rather than being one fixed model,
 * so the chassis and the character are built separately and bolted together.
 * The look is a toy go-kart with a chibi animal at the wheel: a head nearly as
 * wide as the kart, huge cartoon eyes and an open grin, because that is what
 * reads from a chase camera ten metres back — the face when a rival comes at
 * you, the ears and the exhaust cluster when you are behind them.
 *
 * Every kart is built from the same few dozen parts, so the parts are baked:
 * each chassis and each character is assembled once into one geometry per
 * material slot (paint, accent, tray, skin…) and cached for the page's life.
 * A kart in the arena is then about thirty draw calls that share geometry with
 * every other kart of the same make, instead of a hundred-odd unique meshes.
 * Materials stay per kart, because paint colour, hit flashes, invisibility
 * and the charred wreck are all per-kart state.
 *
 * The group's origin sits at the point where the wheels touch the ground,
 * which is exactly what `state.y` means in the shared physics — so the mesh
 * lands where the simulation says it does. +Z is forward.
 */

import * as THREE from 'three';
import { CHARACTERS, KARTS, validCharacter, validKart } from '/shared/cosmetics.js';
import { WEAPONS } from '/shared/weapons.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const FWD = new V3(0, 0, 1);

/** Paint for the parts that are the same on every kart. */
const FIXED = {
  tray: 0x2e3138,   // floor tray, bumpers, seat, pipe bodies: near-black but not black
  metal: 0x9aa1ab,  // engine block, shocks, roll hoop
  white: 0xf6f7f9,  // exhaust stems, gloves, eye whites, teeth
  tyre: 0x3c3f46,   // chunky dark grey, so the tread still shows its shape
  hub: 0xd6dae0,
  black: 0x15171c,  // pupils, lashes, whiskers
  mouth: 0x6e1626,
  tongue: 0xff6f8e,
};

/** A wreck's paint is lerped this far toward charcoal. */
const CHARCOAL = new THREE.Color(0x2a2a2c);
const CHAR_AMOUNT = 0.72;

/**
 * Where the driver sits relative to the top of the seat. Fixed for every
 * chassis so the baked driver (torso, arms on the wheel, head) fits them all;
 * each chassis only has to say where its seat is.
 */
const STEER_AT = new V3(0, 0.38, 0.5);
const STEER_TILT = 0.6;
const HEAD_AT = new V3(0, 1.06, 0.06);

/** Only the big shapes throw shadows: the tub and the head make the silhouette. */
const CAST_SHADOW = new Set(['tray', 'paint', 'skin']);
const RECEIVE_SHADOW = new Set(['paint', 'accent', 'tray', 'skin', 'detail', 'shirt', 'metal']);

/* ── Baking parts into shared geometry ──────────────────────────────── */

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new V3();
const _s = new V3();

/**
 * Matrix from a position ([x,y,z] or Vector3), a rotation ([x,y,z] Euler or a
 * Quaternion) and a scale (number or [x,y,z]).
 */
function xf(at = null, rot = null, scale = 1) {
  if (!at) _p.set(0, 0, 0);
  else if (at.isVector3) _p.copy(at);
  else _p.set(at[0], at[1], at[2]);
  if (!rot) _q.identity();
  else if (rot.isQuaternion) _q.copy(rot);
  else _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
  if (typeof scale === 'number') _s.setScalar(scale);
  else _s.set(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** Rotation taking +Y onto a direction (cylinders, cones and capsules run along Y). */
function alongY(dir) {
  return new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
}

/**
 * Collects primitives per material slot, then merges each slot into one
 * BufferGeometry. `pre` (optional) is applied in front of every part, which is
 * how a shifted view (a monster truck's lifted body) shares the part builders.
 */
function createParts(pre = null, slots = new Map()) {
  const put = (slot, geo, matrix, flip) => {
    if (!slots.has(slot)) slots.set(slot, []);
    slots.get(slot).push({ geo, matrix: pre ? pre.clone().multiply(matrix) : matrix, flip });
  };
  return {
    add(slot, geo, at = null, rot = null, scale = 1) {
      put(slot, geo, at?.isMatrix4 ? at : xf(at, rot, scale), false);
    },
    /** Inside-out: for the inner wall of an open tub, seen from above. */
    addFlipped(slot, geo, at = null, rot = null, scale = 1) {
      put(slot, geo, at?.isMatrix4 ? at : xf(at, rot, scale), true);
    },
    shifted(x, y, z) {
      const m = new THREE.Matrix4().makeTranslation(x, y, z);
      return createParts(pre ? pre.clone().multiply(m) : m, slots);
    },
    bake() {
      const out = {};
      const sources = new Set();
      for (const [slot, list] of slots) {
        out[slot] = mergeParts(list);
        for (const { geo } of list) sources.add(geo);
      }
      for (const g of sources) g.dispose();
      return out;
    },
  };
}

/** Concatenates transformed geometries into one indexed position+normal geometry. */
function mergeParts(list) {
  let vCount = 0;
  let iCount = 0;
  for (const { geo } of list) {
    vCount += geo.attributes.position.count;
    iCount += geo.index ? geo.index.count : geo.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  const v = new V3();
  const nm = new THREE.Matrix3();
  let vo = 0;
  let io = 0;
  for (const { geo, matrix, flip } of list) {
    const P = geo.attributes.position;
    const N = geo.attributes.normal;
    nm.getNormalMatrix(matrix);
    const sign = flip ? -1 : 1;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().multiplyScalar(sign);
      nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
    }
    // A mirrored placement or an inside-out part reverses the winding, so
    // swap two corners to keep the faces pointing the way their normals do.
    const reverse = (matrix.determinant() < 0) !== !!flip;
    const count = geo.index ? geo.index.count : P.count;
    for (let i = 0; i < count; i += 3) {
      const a = geo.index ? geo.index.getX(i) : i;
      const b = geo.index ? geo.index.getX(i + 1) : i + 1;
      const c = geo.index ? geo.index.getX(i + 2) : i + 2;
      idx[io + i] = a + vo;
      idx[io + i + 1] = (reverse ? c : b) + vo;
      idx[io + i + 2] = (reverse ? b : c) + vo;
    }
    vo += P.count;
    io += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  // Cached for the page's life and used by many karts: dispose() skips these.
  out.userData.shared = true;
  return out;
}

/* ── Primitive shapes ───────────────────────────────────────────────── */

const sphere = (r, w = 18, h = 12) => new THREE.SphereGeometry(r, w, h);
const capsule = (r, len, seg = 10) => new THREE.CapsuleGeometry(r, len, 4, seg);
const cylinder = (rTop, rBottom, h, seg = 14) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);

/** A box with every edge rounded: the difference between a toy and a crate. */
function roundedBox(w, h, d, r = 0.05) {
  r = Math.max(0.005, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
  const iw = w - 2 * r;
  const ih = h - 2 * r;
  const c = Math.min(r * 0.6, iw / 2, ih / 2);
  const s = new THREE.Shape();
  s.moveTo(-iw / 2 + c, -ih / 2);
  s.lineTo(iw / 2 - c, -ih / 2);
  s.quadraticCurveTo(iw / 2, -ih / 2, iw / 2, -ih / 2 + c);
  s.lineTo(iw / 2, ih / 2 - c);
  s.quadraticCurveTo(iw / 2, ih / 2, iw / 2 - c, ih / 2);
  s.lineTo(-iw / 2 + c, ih / 2);
  s.quadraticCurveTo(-iw / 2, ih / 2, -iw / 2, ih / 2 - c);
  s.lineTo(-iw / 2, -ih / 2 + c);
  s.quadraticCurveTo(-iw / 2, -ih / 2, -iw / 2 + c, -ih / 2);
  const depth = Math.max(0.002, d - 2 * r);
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 3,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * A solid drawn as a side profile and extruded across the kart. `draw`
 * receives a Shape whose x is the kart's z (forward) and whose y is height;
 * the result is `width` wide (bevel included) and centred on x = 0. The bevel
 * also grows the profile outline by `bevel` all round.
 */
function profileSolid(draw, width, bevel = 0.06) {
  const s = new THREE.Shape();
  draw(s);
  const depth = Math.max(0.002, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

/** Cylinder or cone spanning two points, radius rA at `a` and rB at `b`. */
function cylinderBetween(P, slot, a, b, rA, rB = rA, seg = 12) {
  const dir = new V3().subVectors(b, a);
  const mid = new V3().addVectors(a, b).multiplyScalar(0.5);
  P.add(slot, cylinder(rB, rA, dir.length(), seg), mid, alongY(dir));
}

function capsuleBetween(P, slot, a, b, r, seg = 10) {
  const dir = new V3().subVectors(b, a);
  const mid = new V3().addVectors(a, b).multiplyScalar(0.5);
  P.add(slot, capsule(r, Math.max(0.001, dir.length()), seg), mid, alongY(dir));
}

const vec = (a) => (a.isVector3 ? a.clone() : new V3(a[0], a[1], a[2]));

/* ── Shared go-kart parts ───────────────────────────────────────────── */
/*
 * Every chassis is assembled from these so the family resemblance is built
 * in: dark tray, rounded nose, two-tone side panels, bucket seat, grey engine
 * and the exhaust cluster. Slots: 'paint' is the player's colour, 'accent'
 * the chassis' contrasting second colour.
 */

function trayPlate(P, { w = 1.12, len = 2.5, y = 0.2, z = 0 } = {}) {
  P.add('tray', roundedBox(w, 0.1, len, 0.04), [0, y, z]);
}

function frontBumper(P, { z, w = 1.1, y = 0.24 }) {
  P.add('tray', capsule(0.07, w), [0, y, z], [0, 0, Math.PI / 2]);
  for (const sx of [-1, 1]) P.add('tray', roundedBox(0.07, 0.07, 0.32, 0.02), [sx * 0.3, y - 0.02, z - 0.16]);
}

/** Side nerf bars between the wheels, the low dark rails of a real kart. */
function nerfBars(P, { x = 0.86, z = 0, len = 0.86, y = 0.27, inner = 0.56 } = {}) {
  for (const sx of [-1, 1]) {
    P.add('tray', capsule(0.065, len), [sx * x, y, z], [Math.PI / 2, 0, 0]);
    for (const dz of [-len * 0.32, len * 0.32]) {
      P.add('tray', roundedBox(x - inner, 0.05, 0.08, 0.02), [sx * (x + inner) / 2, y - 0.04, z + dz]);
    }
  }
}

/** The rounded snout that sweeps up from the bumper to the dashboard. */
function noseCone(P, { tip = 1.36, top = 0.72, back = -0.12, width = 0.8, y0 = 0.22, slot = 'paint' } = {}) {
  const run = tip - back;
  P.add(slot, profileSolid((s) => {
    s.moveTo(back, y0);
    s.lineTo(tip, y0);
    s.lineTo(tip, y0 + 0.1);
    s.bezierCurveTo(tip - run * 0.35, y0 + 0.16, back + run * 0.42, top, back + run * 0.18, top);
    s.lineTo(back, top);
    s.lineTo(back, y0);
  }, width, 0.08));
}

/** Low accent panels down each flank: the second colour under the paint. */
function sidePanels(P, { front = 1.2, back = -0.62, top = 0.5, x = 0.5, t = 0.22, y0 = 0.2 } = {}) {
  const g = profileSolid((s) => {
    s.moveTo(back, y0);
    s.lineTo(front, y0);
    s.lineTo(front, y0 + 0.08);
    s.quadraticCurveTo(front - 0.2, top, front - 0.7, top);
    s.lineTo(back, top);
    s.lineTo(back, y0);
  }, t, 0.05);
  for (const sx of [-1, 1]) P.add('accent', g, [sx * x, 0, 0]);
}

/** Painted pods either side of the engine, over the inside of the rear wheels. */
function rearPods(P, { x = 0.47, z = -0.78, y = 0.46, len = 0.72 } = {}) {
  for (const sx of [-1, 1]) {
    P.add('paint', roundedBox(0.3, 0.3, len, 0.08), [sx * x, y, z]);
    P.add('accent', roundedBox(0.32, 0.1, len + 0.02, 0.04), [sx * x, y - 0.19, z]);
  }
}

function seat(P, { y = 0.32, z = -0.38, w = 0.56 } = {}) {
  P.add('tray', roundedBox(w, 0.12, 0.48, 0.04), [0, y, z]);
  P.add('tray', roundedBox(w + 0.04, 0.6, 0.12, 0.05), [0, y + 0.3, z - 0.28], [-0.2, 0, 0]);
}

/** Grey engine block with four bolts on its back face, seen dead centre from behind. */
function engine(P, { z = -1.02, y = 0.46, w = 0.58 } = {}) {
  P.add('metal', roundedBox(w, 0.36, 0.42, 0.05), [0, y, z]);
  P.add('metal', roundedBox(w * 0.76, 0.12, 0.34, 0.04), [0, y + 0.22, z + 0.02]);
  const bolt = cylinder(0.042, 0.042, 0.05, 8);
  for (const bx of [-0.13, 0.13]) {
    for (const by of [-0.07, 0.07]) P.add('tray', bolt, [bx, y + by, z - 0.215], [Math.PI / 2, 0, 0]);
  }
}

/**
 * One exhaust: a white stem out of the engine, an elbow, a dark pipe and a
 * coloured tip with a sooty mouth. Returns the tip as an anchor for the boost
 * flame, which then leaves the pipe the way the pipe points.
 */
function exhaustPipe(P, root, stemDir, pipeDir, { stem = 0.22, len = 0.34, r = 0.07 } = {}) {
  const a = vec(root);
  const sd = vec(stemDir).normalize();
  const pd = vec(pipeDir).normalize();
  const b = a.clone().addScaledVector(sd, stem);
  if (stem > 0) {
    cylinderBetween(P, 'white', a, b, r * 0.72);
    P.add('white', sphere(r * 0.78, 10, 8), b);
  }
  const c = b.clone().addScaledVector(pd, len);
  cylinderBetween(P, 'tray', b, c, r);
  const end = c.clone().addScaledVector(pd, 0.13);
  cylinderBetween(P, 'accent', c, end, r * 1.32, r * 1.45, 14);
  P.add('tray', cylinder(r * 1.05, r * 1.05, 0.02, 12), end.clone().addScaledVector(pd, 0.004), alongY(pd));
  return { pos: end, dir: pd, r: r * 1.3 };
}

/** The signature four-pipe cluster, two stacked either side of the engine. */
function exhaustCluster(P, { z = -1.06, scale = 1, style = 'bent' } = {}) {
  const r = 0.07 * scale;
  const out = [];
  for (const sx of [-1, 1]) {
    if (style === 'drag') {
      // Straight back and nearly level, like a dragster's zoomies.
      out.push(exhaustPipe(P, [sx * 0.22, 0.54, z - 0.02], [sx, 0, 0], [sx * 0.12, 0.1, -1],
        { stem: 0.08, len: 0.44, r }));
      out.push(exhaustPipe(P, [sx * 0.22, 0.36, z - 0.04], [sx, 0, 0], [sx * 0.2, 0.03, -1],
        { stem: 0.22, len: 0.38, r }));
    } else {
      out.push(exhaustPipe(P, [sx * 0.2, 0.55, z - 0.04], [sx, 0.3, -0.25], [sx * 0.25, 0.55, -0.8],
        { stem: 0.2, len: 0.34, r }));
      out.push(exhaustPipe(P, [sx * 0.2, 0.36, z - 0.06], [sx, 0, -0.2], [sx * 0.3, 0.2, -0.93],
        { stem: 0.28, len: 0.3, r }));
    }
  }
  return out;
}

function rearBumper(P, { z = -1.34, w = 1.25, y = 0.26 } = {}) {
  P.add('accent', capsule(0.075, w), [0, y, z], [0, 0, Math.PI / 2]);
  for (const sx of [-1, 1]) P.add('tray', roundedBox(0.06, 0.06, 0.26, 0.02), [sx * 0.32, y - 0.02, z + 0.14]);
}

/** Curved mudguard over a wheel: an annulus sector extruded across the tyre. */
function fender(P, slot, { x, y, z, r, w, t = 0.08, gap = 0.06, from = 0.08, to = 0.92 }) {
  const g = profileSolid((s) => {
    s.absarc(0, 0, r + gap + t, Math.PI * from, Math.PI * to, false);
    s.absarc(0, 0, r + gap, Math.PI * to, Math.PI * from, true);
  }, w, 0.025);
  P.add(slot, g, [x, y, z]);
}

/* ── Chassis ────────────────────────────────────────────────────────── */
/*
 * Each builder adds bodywork to the parts list and returns its anchors:
 *   seat      { y, z } top of the seat cushion — the driver is bolted on here
 *   wheels    { front, rear } each { x, z, r, w } (x is the outer track half)
 *   exhausts  [{ pos, dir, r }] pipe mouths, for the boost flames
 * Wheels and driver are added by the caller so every variant gets them the
 * same way. Silhouettes are kept distinct from behind, the angle that matters.
 */
const CHASSIS = {
  /** The base kart everything else is a variation of. */
  classic(P) {
    trayPlate(P, { w: 1.12, len: 2.5, z: 0.02 });
    frontBumper(P, { z: 1.4 });
    nerfBars(P, { x: 0.86, z: 0.04 });
    noseCone(P, { tip: 1.36, top: 0.72 });
    sidePanels(P, { front: 1.2 });
    rearPods(P);
    seat(P);
    engine(P);
    const exhausts = exhaustCluster(P);
    rearBumper(P);
    return {
      seat: { y: 0.38, z: -0.38 },
      wheels: { front: { x: 0.78, z: 0.98, r: 0.3, w: 0.28 }, rear: { x: 0.8, z: -0.9, r: 0.38, w: 0.38 } },
      exhausts,
    };
  },

  /** The same kart jacked up on huge tyres, with fenders, shocks and a hoop. */
  monster(P) {
    const LIFT = 0.3;
    const Q = P.shifted(0, LIFT, 0);
    trayPlate(Q, { w: 1.12, len: 2.5, z: 0.02 });
    nerfBars(Q, { x: 0.78, z: 0.04, len: 0.7 });
    noseCone(Q, { tip: 1.36, top: 0.72 });
    sidePanels(Q, { front: 1.2 });
    rearPods(Q);
    seat(Q);
    engine(Q);
    const exhausts = exhaustCluster(Q, { scale: 1.15 });
    for (const e of exhausts) e.pos.y += LIFT;
    rearBumper(Q, { w: 1.1 });

    const front = { x: 0.94, z: 1.0, r: 0.46, w: 0.38 };
    const rear = { x: 0.98, z: -0.92, r: 0.56, w: 0.46 };
    for (const wh of [front, rear]) {
      for (const sx of [-1, 1]) {
        const cx = sx * (wh.x - wh.w / 2);
        fender(P, 'accent', { x: cx, y: wh.r, z: wh.z, r: wh.r, w: wh.w + 0.08, t: 0.09 });
        cylinderBetween(P, 'metal', new V3(sx * 0.5, 0.5 + LIFT, wh.z), new V3(cx, wh.r, wh.z), 0.055);
      }
      // A visible axle between the big wheels reads as "off-roader" from behind.
      P.add('tray', cylinder(0.06, 0.06, wh.x * 2 - wh.w, 10), [0, wh.r, wh.z], [0, 0, Math.PI / 2]);
    }
    // Push bar on the nose and a roll hoop behind the seat, wider than the head.
    P.add('metal', capsule(0.08, 1.0), [0, 0.6, 1.66], [0, 0, Math.PI / 2]);
    for (const sx of [-1, 1]) cylinderBetween(P, 'metal', new V3(sx * 0.38, 0.6, 1.64), new V3(sx * 0.3, 0.3 + LIFT, 1.3), 0.05);
    P.add('metal', new THREE.TorusGeometry(0.66, 0.06, 8, 24, Math.PI), [0, 0.5 + LIFT, -0.8]);
    return {
      seat: { y: 0.38 + LIFT, z: -0.38 },
      wheels: { front, rear },
      exhausts,
    };
  },

  /** Long low nose, fat drag pipes and a rear wing you can see over the head. */
  hotrod(P) {
    trayPlate(P, { w: 1.0, len: 2.9, z: 0.22 });
    frontBumper(P, { z: 1.86, w: 0.8 });
    nerfBars(P, { x: 0.8, z: 0.18, len: 1.2, inner: 0.5 });
    noseCone(P, { tip: 1.84, top: 0.66, width: 0.68 });
    sidePanels(P, { front: 1.62, top: 0.46, x: 0.44 });
    rearPods(P, { x: 0.46 });
    seat(P);
    engine(P);
    // Supercharger scoop sticking up through the engine cover.
    P.add('accent', roundedBox(0.3, 0.2, 0.3, 0.05), [0, 0.8, -1.0]);
    P.add('tray', roundedBox(0.24, 0.05, 0.06, 0.02), [0, 0.86, -0.86]);
    const exhausts = exhaustCluster(P, { scale: 1.3, style: 'drag' });
    rearBumper(P, { w: 1.1 });
    // Rear wing on two struts, wider than the driver's head.
    P.add('accent', roundedBox(1.96, 0.07, 0.4, 0.03), [0, 1.14, -1.32], [0.08, 0, 0]);
    for (const sx of [-1, 1]) {
      P.add('paint', roundedBox(0.05, 0.36, 0.48, 0.02), [sx * 0.98, 1.08, -1.32]);
      P.add('tray', roundedBox(0.05, 0.56, 0.12, 0.02), [sx * 0.38, 0.86, -1.26]);
    }
    return {
      seat: { y: 0.38, z: -0.38 },
      wheels: { front: { x: 0.66, z: 1.32, r: 0.26, w: 0.22 }, rear: { x: 0.88, z: -0.82, r: 0.44, w: 0.5 } },
      exhausts,
    };
  },

  /** Fairground bumper car: an open round tub inside a fat rubber ring. */
  bubble(P) {
    trayPlate(P, { w: 0.9, len: 1.6, y: 0.14, z: 0 });
    const TUB = [1, 0.75, 1.16];
    const TUB_Y = 0.66;
    const tub = new THREE.SphereGeometry(0.9, 30, 12, 0, Math.PI * 2, Math.PI * 0.44, Math.PI * 0.56);
    P.add('paint', tub, [0, TUB_Y, -0.05], null, TUB);
    // Its inside, so looking down into the cockpit shows a dark tub, not a hole.
    P.addFlipped('tray', tub, [0, TUB_Y, -0.05], null, TUB.map((k) => k * 0.94));
    const rimY = TUB_Y + 0.9 * Math.cos(Math.PI * 0.44) * TUB[1];
    P.add('white', new THREE.TorusGeometry(0.88, 0.05, 8, 40), [0, rimY, -0.05], [Math.PI / 2, 0, 0], [1, TUB[2], 1]);
    P.add('accent', new THREE.TorusGeometry(0.98, 0.15, 10, 40), [0, 0.34, -0.05], [Math.PI / 2, 0, 0], [1, 1.13, 1]);
    for (const sx of [-1, 1]) P.add('white', sphere(0.09, 12, 8), [sx * 0.32, 0.56, 0.99]);
    seat(P, { y: 0.3, z: -0.25, w: 0.52 });
    P.add('metal', roundedBox(0.46, 0.24, 0.3, 0.05), [0, 0.72, -0.86]);
    const exhausts = [];
    for (const sx of [-1, 1]) {
      exhausts.push(exhaustPipe(P, [sx * 0.14, 0.78, -0.92], [sx, 0, 0], [sx * 0.3, 0.75, -0.6],
        { stem: 0.06, len: 0.32, r: 0.065 }));
    }
    return {
      seat: { y: 0.36, z: -0.25 },
      wheels: { front: { x: 0.66, z: 0.72, r: 0.24, w: 0.2 }, rear: { x: 0.66, z: -0.78, r: 0.24, w: 0.2 } },
      exhausts,
    };
  },

  /** Farm kart: bonnet up front, a tall stack, a perched seat between huge back wheels. */
  tractor(P) {
    trayPlate(P, { w: 0.8, len: 2.3, y: 0.3, z: 0.1 });
    P.add('paint', roundedBox(0.68, 0.48, 1.05, 0.1), [0, 0.66, 0.72]);
    P.add('accent', roundedBox(0.76, 0.14, 1.1, 0.05), [0, 0.4, 0.72]);
    P.add('tray', roundedBox(0.52, 0.36, 0.06, 0.02), [0, 0.66, 1.26]);
    P.add('accent', new THREE.TorusGeometry(0.17, 0.035, 8, 20), [0, 0.68, 1.3]);
    for (const sx of [-1, 1]) P.add('white', sphere(0.075, 12, 8), [sx * 0.26, 0.86, 1.2]);
    // Front axle beam: tractors have a narrow front track on a single beam.
    P.add('tray', cylinder(0.06, 0.06, 1.0, 10), [0, 0.3, 1.0], [0, 0, Math.PI / 2]);
    // The tall stack, with a painted tip, stands off the bonnet.
    const stackBase = new V3(0.22, 0.86, 0.92);
    const stackTop = new V3(0.22, 1.6, 0.92);
    cylinderBetween(P, 'tray', stackBase, stackTop, 0.07, 0.065);
    const stackEnd = stackTop.clone().add(new V3(0, 0.14, 0));
    cylinderBetween(P, 'accent', stackTop, stackEnd, 0.085, 0.095);
    P.add('tray', cylinder(0.075, 0.075, 0.02, 12), stackEnd.clone().add(new V3(0, 0.005, 0)));
    // Seat on a post above the rear axle.
    cylinderBetween(P, 'metal', new V3(0, 0.35, -0.55), new V3(0, 0.6, -0.55), 0.08);
    P.add('tray', roundedBox(0.6, 0.12, 0.5, 0.04), [0, 0.64, -0.55]);
    P.add('tray', roundedBox(0.64, 0.5, 0.12, 0.05), [0, 0.92, -0.82], [-0.18, 0, 0]);
    P.add('tray', cylinder(0.09, 0.09, 1.56, 12), [0, 0.62, -0.6], [0, 0, Math.PI / 2]);
    engine(P, { z: -1.06, y: 0.5, w: 0.5 });
    const exhausts = [
      { pos: stackEnd, dir: new V3(0, 1, 0), r: 0.09 },
    ];
    for (const sx of [-1, 1]) {
      exhausts.push(exhaustPipe(P, [sx * 0.16, 0.56, -1.2], [sx, 0, 0], [sx * 0.2, 0.6, -0.75],
        { stem: 0.08, len: 0.24, r: 0.055 }));
    }
    const rear = { x: 0.92, z: -0.6, r: 0.62, w: 0.42 };
    for (const sx of [-1, 1]) {
      fender(P, 'accent', {
        x: sx * (rear.x - rear.w / 2), y: rear.r, z: rear.z, r: rear.r, w: rear.w + 0.1, t: 0.1, from: 0.05, to: 0.82,
      });
      P.add('tray', roundedBox(0.3, 0.05, 0.5, 0.02), [sx * 0.42, 0.34, 0.25]);
    }
    rearBumper(P, { z: -1.32, w: 0.9, y: 0.36 });
    return {
      seat: { y: 0.7, z: -0.55 },
      wheels: { front: { x: 0.58, z: 1.0, r: 0.3, w: 0.22 }, rear },
      exhausts,
    };
  },

  /** Jet kart: a capsule fuselage with a nose cone, V fins and one big nozzle. */
  rocket(P) {
    trayPlate(P, { w: 0.8, len: 2.0, y: 0.14, z: 0 });
    P.add('tray', cylinder(0.06, 0.06, 1.3, 10), [0, 0.28, 0.85], [0, 0, Math.PI / 2]);
    P.add('tray', cylinder(0.06, 0.06, 1.36, 10), [0, 0.34, -0.75], [0, 0, Math.PI / 2]);
    P.add('paint', capsule(0.38, 1.4, 18), [0, 0.5, 0], [Math.PI / 2, 0, 0]);
    P.add('accent', new THREE.ConeGeometry(0.33, 0.64, 18), [0, 0.5, 1.2], [Math.PI / 2, 0, 0]);
    P.add('accent', cylinder(0.392, 0.392, 0.14, 24), [0, 0.5, 0.46], [Math.PI / 2, 0, 0]);
    P.add('tray', new THREE.TorusGeometry(0.34, 0.06, 8, 24), [0, 0.86, -0.3], [Math.PI / 2, 0, 0]);
    for (const sx of [-1, 1]) {
      P.add('accent', roundedBox(0.06, 0.6, 0.52, 0.025), [sx * 0.4, 0.98, -0.82], [0, 0, -sx * 0.6]);
      P.add('tray', cylinder(0.12, 0.12, 0.3, 12), [sx * 0.38, 0.4, 0.2], [Math.PI / 2, 0, 0]);
    }
    P.add('metal', cylinder(0.3, 0.38, 0.36, 22), [0, 0.5, -1.22], [Math.PI / 2, 0, 0]);
    P.add('accent', new THREE.TorusGeometry(0.38, 0.045, 8, 24), [0, 0.5, -1.4]);
    P.add('tray', cylinder(0.3, 0.3, 0.02, 20), [0, 0.5, -1.405], [Math.PI / 2, 0, 0]);
    return {
      seat: { y: 0.5, z: -0.3 },
      wheels: { front: { x: 0.76, z: 0.85, r: 0.28, w: 0.24 }, rear: { x: 0.82, z: -0.75, r: 0.34, w: 0.3 } },
      exhausts: [{ pos: new V3(0, 0.5, -1.41), dir: new V3(0, 0, -1), r: 0.3 }],
    };
  },
};

const chassisCache = new Map();

function chassisParts(id) {
  let c = chassisCache.get(id);
  if (!c) {
    const P = createParts();
    const anchors = (CHASSIS[id] || CHASSIS.classic)(P);
    c = { slots: P.bake(), anchors };
    chassisCache.set(id, c);
  }
  return c;
}

/* ── Wheels ─────────────────────────────────────────────────────────── */

/**
 * A chunky tyre: a rounded-rectangle cross-section spun round the axle, with
 * a light hub showing five bolt holes on its outer face and a cap in the
 * chassis' accent colour. Baked per size and side, axle along X.
 */
const wheelCache = new Map();

function wheelParts(r, w, side) {
  const key = `${r}:${w}:${side}`;
  let c = wheelCache.get(key);
  if (c) return c;
  const P = createParts();
  const corner = Math.min(0.07, w * 0.3, r * 0.25);
  const inner = r * 0.62;
  const pts = [new THREE.Vector2(inner, -w / 2)];
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - corner + Math.cos(a) * corner, -w / 2 + corner + Math.sin(a) * corner));
  }
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - corner + Math.cos(a) * corner, w / 2 - corner + Math.sin(a) * corner));
  }
  pts.push(new THREE.Vector2(inner, w / 2));
  P.add('tyre', new THREE.LatheGeometry(pts, 22), null, [0, 0, Math.PI / 2]);
  P.add('hub', cylinder(inner + 0.006, inner + 0.006, w - 0.05, 22), null, [0, 0, Math.PI / 2]);
  const face = side * (w / 2 - 0.025);
  const hole = cylinder(r * 0.1, r * 0.1, 0.02, 8);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    P.add('tyre', hole, [face + side * 0.004, Math.cos(a) * inner * 0.56, Math.sin(a) * inner * 0.56], [0, 0, Math.PI / 2]);
  }
  P.add('accent', cylinder(inner * 0.27, inner * 0.3, 0.05, 12), [face + side * 0.02, 0, 0], [0, 0, Math.PI / 2]);
  c = P.bake();
  wheelCache.set(key, c);
  return c;
}

/* ── Drivers ────────────────────────────────────────────────────────── */

/**
 * Surface maths for an ellipsoid head centred on the origin, radii [rx,ry,rz].
 * Features are placed by direction from the centre, so the same recipe fits
 * a wide frog and a tall bunny.
 */
function headKit(R) {
  const [rx, ry, rz] = R;
  const kit = {
    R,
    /** Surface point along a direction, plus the outward normal there. */
    point(dx, dy, dz, out = 0) {
      const d = new V3(dx, dy, dz).normalize();
      const t = 1 / Math.sqrt((d.x / rx) ** 2 + (d.y / ry) ** 2 + (d.z / rz) ** 2);
      const p = d.multiplyScalar(t);
      const n = new V3(p.x / (rx * rx), p.y / (ry * ry), p.z / (rz * rz)).normalize();
      p.addScaledVector(n, out);
      return { p, n };
    },
    /**
     * A local frame on the surface: +Z out of the head (blended toward
     * straight ahead by `face`, so eyes on a frog's crown still look forward),
     * +Y as close to world up as that allows. With `up`, +Y is the normal
     * instead — for ears and horns that grow out of the head.
     */
    frame([dx, dy, dz], { out = 0, face = 0, up = false, roll = 0 } = {}) {
      const { p, n } = kit.point(dx, dy, dz, out);
      let xAxis;
      let yAxis;
      let zAxis;
      if (up) {
        yAxis = n.clone();
        zAxis = FWD.clone().addScaledVector(yAxis, -FWD.dot(yAxis));
        if (zAxis.lengthSq() < 1e-6) zAxis.set(0, 0, 1);
        zAxis.normalize();
        xAxis = new V3().crossVectors(yAxis, zAxis);
      } else {
        zAxis = n.clone().lerp(FWD, face).normalize();
        xAxis = new V3().crossVectors(UP, zAxis);
        if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
        xAxis.normalize();
        yAxis = new V3().crossVectors(zAxis, xAxis);
      }
      const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(p);
      if (roll) m.multiply(new THREE.Matrix4().makeRotationZ(roll));
      return m;
    },
  };
  return kit;
}

/**
 * A flat shape painted onto the head: tessellated finely enough to follow
 * the curve, then every vertex is pushed onto the ellipsoid along its
 * direction from the centre and lifted a hair above it. Mouths, patches,
 * muzzles and stripes are all decals, so they stay crisp at any distance and
 * hug the head instead of floating off it like stuck-on discs.
 */
function decalGeometry(H, frame, shape, lift) {
  const flat = new THREE.ShapeGeometry(shape, 10);
  const P = flat.attributes.position;
  const index = flat.index;
  flat.computeBoundingBox();
  const size = flat.boundingBox.getSize(new V3());
  const depth = Math.max(0, Math.min(3, Math.ceil(Math.log2(Math.max(size.x, size.y) / 0.1))));
  let tris = [];
  for (let i = 0; i < index.count; i += 3) {
    tris.push([0, 1, 2].map((k) => new V3().fromBufferAttribute(P, index.getX(i + k))));
  }
  // Uniform subdivision, so neighbouring triangles share every new vertex and
  // the projected surface has no cracks.
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const [a, b, c] of tris) {
      const ab = a.clone().lerp(b, 0.5);
      const bc = b.clone().lerp(c, 0.5);
      const ca = c.clone().lerp(a, 0.5);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = next;
  }
  flat.dispose();
  const pos = new Float32Array(tris.length * 9);
  const nor = new Float32Array(tris.length * 9);
  let o = 0;
  const q = new V3();
  for (const tri of tris) {
    for (const v of tri) {
      q.copy(v).applyMatrix4(frame);
      const { p, n } = H.point(q.x, q.y, q.z, lift);
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
      nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z;
      o += 3;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** Height of each decal layer above the head, in metres. */
const LIFT = { patch: 0.006, mouth: 0.012, tongue: 0.019, teeth: 0.022 };

function ellipseShape(rx, ry, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  s.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false);
  return s;
}

function roundRectShape(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

/** Open-mouthed grin: a smile-curved top edge over a round bottom. */
function grinShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w, 0.04);
  s.quadraticCurveTo(0, -0.05, w, 0.04);
  s.absellipse(0, 0.04, w, h, 0, Math.PI, true);
  return s;
}

function triangleShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, -h);
  s.lineTo(-w / 2, 0);
  return s;
}

/**
 * The shared recipe every animal is built from: an ellipsoid head, huge
 * outlined eyes with a catch-light, an open grin with a tongue, and helpers
 * for the bits that make each species (ears, muzzles, noses, whiskers).
 *
 *   P  static head parts       E  eye parts (blink as one group)
 *   X  the 'X X' eyes a wreck shows instead
 */
function driverKit(R) {
  const H = headKit(R);
  const P = createParts();
  const X = createParts();
  let E = null;
  let eyeCentre = new V3();
  const eyeFrames = [];

  const kit = {
    H, P, X,
    /** Sphere on the surface, squashed along its own frame. */
    bump(slot, dir, r, scale = [1, 1, 1], { out = 0, face = 0, up = false, at = [0, 0, 0], roll = 0 } = {}) {
      P.add(slot, sphere(r, 16, 12), H.frame(dir, { out, face, up, roll }).multiply(xf(at, null, scale)));
    },
    /** Any geometry, placed in a surface frame. */
    part(slot, geo, dir, { out = 0, face = 0, up = false, roll = 0, at = [0, 0, 0], rot = null, scale = 1 } = {}) {
      P.add(slot, geo, H.frame(dir, { out, face, up, roll }).multiply(xf(at, rot, scale)));
    },
    /**
     * Lifts are spaced by millimetres so stacked decals (cheeks, mouth,
     * tongue, teeth) never fight over depth even on a distant kart.
     */
    decal(slot, dir, shape, { lift = LIFT.patch, roll = 0 } = {}) {
      P.add(slot, decalGeometry(H, H.frame(dir, { roll }), shape, lift));
    },

    eyes({ dx = 0.3, dy = 0.26, size = 1, face = 0.35, lashes = false, look = 0.035 } = {}) {
      const er = 0.25 * size;
      const frames = [-1, 1].map((sx) => H.frame([sx * dx, dy, 1], { out: -er * 0.25, face }));
      eyeCentre = new V3().setFromMatrixPosition(frames[0])
        .add(new V3().setFromMatrixPosition(frames[1])).multiplyScalar(0.5);
      // Eye parts are baked around the eyes' own centre, so the group can
      // blink by squashing in Y without the eyes sliding down the face.
      E = createParts(new THREE.Matrix4().makeTranslation(-eyeCentre.x, -eyeCentre.y, -eyeCentre.z));
      const front = er * 0.62;
      frames.forEach((F, i) => {
        const sx = i === 0 ? -1 : 1;
        eyeFrames.push({ F, er, sx });
        const at = (p, s) => F.clone().multiply(xf(p, null, s));
        E.add('white', sphere(er, 22, 16), at([0, 0, 0], [1, 1.2, 0.62]));
        E.add('black', sphere(er, 22, 16), at([0, 0, -0.022], [1.1, 1.29, 0.58]));
        const px = -sx * look * size;
        const py = -0.02 * size;
        const pz = front * 0.78;
        E.add('black', sphere(0.125 * size, 18, 14), at([px, py, pz], [1, 1.18, 0.5]));
        E.add('white', sphere(0.042 * size, 10, 8), at([px - 0.045 * size, py + 0.055 * size, pz + 0.05 * size], [1, 1, 0.6]));
        if (lashes) {
          // Three short strokes growing out of the outline at the top-outer
          // corner, splayed a little further out than radial.
          for (const deg of [38, 60, 82]) {
            const a = (deg * Math.PI) / 180;
            const len = 0.1 * size;
            const rx = er * 1.04 + len * 0.4;
            const ry = er * 1.22 + len * 0.4;
            E.add('black', roundedBox(0.036, len, 0.03, 0.012),
              F.clone().multiply(xf([sx * Math.cos(a) * rx, Math.sin(a) * ry, -0.01],
                [0, 0, sx * (a - Math.PI / 2 - 0.25)])));
          }
        }
        // Dizzy wreck eyes: a cross on each.
        for (const r of [Math.PI / 4, -Math.PI / 4]) {
          X.add('black', roundedBox(er * 1.3, 0.065, 0.05, 0.02), F.clone().multiply(xf([0, 0, front * 0.35], [0, 0, r])));
        }
      });
    },

    mouth({ dy = -0.42, w = 0.32, h = 0.26 } = {}) {
      const dir = [0, dy, 1];
      kit.decal('mouth', dir, grinShape(w, h), { lift: LIFT.mouth });
      kit.decal('tongue', dir, ellipseShape(w * 0.5, h * 0.36, 0, -h * 0.58), { lift: LIFT.tongue });
      kit.mouthAt = { dir, w, h };
    },
  };
  return {
    kit,
    finish() {
      return {
        head: P.bake(),
        eyes: E ? E.bake() : {},
        xeyes: X.bake(),
        eyeCentre,
        R,
      };
    },
  };
}

/** A copy of a shape moved within its own plane (Shape has no translate). */
function offsetShape(shape, dx, dy) {
  return new THREE.Shape(shape.getPoints(6).map((p) => new THREE.Vector2(p.x + dx, p.y + dy)));
}

/** Two buck teeth hanging from the top lip. Call after mouth(). */
function buckTeeth(kit) {
  for (const sx of [-1, 1]) {
    kit.decal('white', kit.mouthAt.dir, offsetShape(roundRectShape(0.085, 0.11, 0.025), sx * 0.048, -0.06),
      { lift: LIFT.teeth });
  }
}

/** Two little fangs at the corners of the top lip. Call after mouth(). */
function fangs(kit) {
  const { dir, w } = kit.mouthAt;
  for (const sx of [-1, 1]) {
    kit.decal('white', dir, offsetShape(triangleShape(0.07, 0.09), sx * w * 0.5, 0.01), { lift: LIFT.teeth });
  }
}

function whiskers(kit, { dy = -0.22, dx = 0.34, len = 0.32 } = {}) {
  for (const sx of [-1, 1]) {
    for (const a of [-0.22, 0.02, 0.26]) {
      kit.part('black', roundedBox(len, 0.022, 0.022, 0.008), [sx * dx, dy, 1], {
        at: [sx * (len * 0.42), 0, 0.03], rot: [0, 0, sx * a],
      });
    }
  }
}

/** A pointed ear: a flattened four-sided cone with a coloured inside. */
function pointedEar(kit, dir, { r = 0.22, h = 0.44, tilt = 0.25, sx, inner = 'nose', tip = null } = {}) {
  const roll = -sx * tilt;
  const cone = new THREE.ConeGeometry(r, h, 4, 1, false, Math.PI / 4);
  kit.part('skin', cone, dir, { up: true, out: -0.05, roll, at: [0, h * 0.45, 0], scale: [1, 1, 0.55] });
  kit.part(inner, new THREE.ConeGeometry(r * 0.62, h * 0.66, 4, 1, false, Math.PI / 4), dir,
    { up: true, out: -0.05, roll, at: [0, h * 0.34, r * 0.32], scale: [1, 1, 0.25] });
  if (tip) {
    kit.part(tip, new THREE.ConeGeometry(r * 0.42, h * 0.34, 4, 1, false, Math.PI / 4), dir,
      { up: true, out: -0.05, roll, at: [0, h * 0.8, 0.005], scale: [1.06, 1, 0.6] });
  }
}

/**
 * Species. Each names its head radii and the colours that are not the
 * character's skin/detail/accent, then adds its features. Skin and detail
 * colours come from shared/cosmetics.js; geometry lives only here.
 */
const SPECIES = {
  panda: {
    head: [0.76, 0.66, 0.68], nose: 0x1d1f24,
    build(k) {
      k.eyes({ dx: 0.3, dy: 0.24, lashes: true });
      for (const sx of [-1, 1]) {
        // Teardrop patches, bigger than the eyes and drooping outward, so a
        // black rim shows round the outer and lower edge of each eye.
        k.decal('detail', [sx * 0.44, 0.08, 1], ellipseShape(0.25, 0.34), { roll: sx * 0.6 });
        k.bump('detail', [sx * 0.6, 0.8, -0.12], 0.22, [1, 1, 0.55], { out: -0.07, up: true, at: [0, 0.04, 0] });
      }
      k.bump('nose', [0, -0.1, 1], 0.07, [1.5, 0.9, 0.7], { out: 0.0 });
      k.mouth({ dy: -0.42 });
    },
  },
  frog: {
    head: [0.8, 0.6, 0.68], nose: 0x1d1f24,
    build(k) {
      // Lid bumps behind the eyes, so they sit up on the crown like a frog's.
      for (const sx of [-1, 1]) k.bump('skin', [sx * 0.38, 0.74, 0.36], 0.27, [1, 1, 1], { out: -0.16 });
      k.eyes({ dx: 0.38, dy: 0.72, face: 0.6, lashes: true, size: 0.96 });
      k.decal('detail', [0, -0.68, 1], ellipseShape(0.42, 0.22));
      for (const sx of [-1, 1]) k.bump('black', [sx * 0.09, 0.05, 1], 0.03, [1, 1, 0.6]);
      k.mouth({ dy: -0.28, w: 0.48, h: 0.2 });
    },
  },
  mouse: {
    head: [0.7, 0.64, 0.66], nose: 0xff7aa0, patch: 0xffa8c0,
    build(k) {
      for (const sx of [-1, 1]) {
        k.bump('skin', [sx * 0.72, 0.72, -0.2], 0.34, [1, 1, 0.3], { out: 0.06, face: 0.55 });
        k.bump('patch', [sx * 0.72, 0.72, -0.2], 0.24, [1, 1, 0.2], { out: 0.06, face: 0.55, at: [0, 0, 0.07] });
      }
      k.eyes({ dx: 0.29, dy: 0.26 });
      k.decal('detail', [0, -0.34, 1], ellipseShape(0.34, 0.22));
      k.bump('nose', [0, -0.12, 1], 0.085, [1.2, 0.95, 0.9], { out: 0.02 });
      whiskers(k, { dy: -0.22, dx: 0.28 });
      k.mouth({ dy: -0.5, w: 0.22, h: 0.16 });
      buckTeeth(k);
    },
  },
  cat: {
    head: [0.76, 0.64, 0.66], nose: 0xff7a9a, patch: 0xd8661a,
    build(k) {
      for (const sx of [-1, 1]) pointedEar(k, [sx * 0.5, 0.84, -0.05], { sx, inner: 'nose' });
      k.eyes({ dx: 0.3, dy: 0.24 });
      for (const sx of [-1, 1]) k.decal('detail', [sx * 0.15, -0.36, 1], ellipseShape(0.2, 0.15));
      k.bump('nose', [0, -0.12, 1], 0.07, [1.4, 0.85, 0.7]);
      whiskers(k, { dy: -0.26, dx: 0.32 });
      k.mouth({ dy: -0.47, w: 0.27, h: 0.19 });
      fangs(k);
      // Tabby stripes on the crown and the back of the head: the cat's tell
      // from behind, where its face is never seen.
      for (const dx of [-0.24, 0, 0.24]) {
        k.decal('patch', [dx, 0.88, 0.45], roundRectShape(0.08, 0.3, 0.035));
        k.decal('patch', [dx * 1.2, 0.35, -1], roundRectShape(0.09, 0.4, 0.04));
      }
    },
  },
  bunny: {
    head: [0.7, 0.66, 0.66], nose: 0xff8fb0,
    build(k) {
      for (const sx of [-1, 1]) {
        k.part('skin', capsule(0.13, 0.62, 12), [sx * 0.24, 1, -0.1],
          { up: true, out: -0.06, roll: -sx * 0.16, at: [0, 0.4, 0], scale: [1, 1, 0.75] });
        k.part('detail', capsule(0.075, 0.5, 10), [sx * 0.24, 1, -0.1],
          { up: true, out: -0.06, roll: -sx * 0.16, at: [0, 0.42, 0.09], scale: [1, 1, 0.3] });
        k.decal('detail', [sx * 0.5, -0.24, 1], ellipseShape(0.11, 0.07));
      }
      k.eyes({ dx: 0.29, dy: 0.24, lashes: true });
      k.bump('nose', [0, -0.12, 1], 0.07, [1.3, 0.9, 0.8]);
      k.mouth({ dy: -0.46, w: 0.26, h: 0.2 });
      buckTeeth(k);
    },
  },
  fox: {
    head: [0.76, 0.64, 0.68], nose: 0x1d1f24, patch: 0x2a1f1c,
    build(k) {
      for (const sx of [-1, 1]) {
        pointedEar(k, [sx * 0.48, 0.84, -0.08], { sx, h: 0.52, r: 0.23, tilt: 0.3, inner: 'detail', tip: 'patch' });
        k.decal('detail', [sx * 0.62, -0.32, 0.8], ellipseShape(0.22, 0.16), { roll: sx * 0.4 });
      }
      k.decal('detail', [0, -0.42, 1], ellipseShape(0.42, 0.28));
      k.eyes({ dx: 0.3, dy: 0.24 });
      k.bump('nose', [0, -0.1, 1], 0.08, [1.4, 0.9, 0.85], { out: 0.02 });
      k.mouth({ dy: -0.5, w: 0.25, h: 0.17 });
    },
  },
  monkey: {
    head: [0.72, 0.64, 0.66], nose: 0x4a2a18,
    build(k) {
      for (const sx of [-1, 1]) {
        k.bump('skin', [sx, 0.12, 0.05], 0.25, [1, 1, 0.45], { out: 0.04 });
        k.bump('detail', [sx, 0.12, 0.05], 0.17, [1, 1, 0.3], { out: 0.14 });
        k.decal('detail', [sx * 0.27, 0.22, 1], ellipseShape(0.27, 0.3));
      }
      k.decal('detail', [0, -0.36, 1], ellipseShape(0.44, 0.31));
      for (const [dx, dy] of [[-0.08, 0.98], [0.04, 1], [0.14, 0.94]]) k.bump('skin', [dx, dy, 0.25], 0.13, [1, 1.2, 1], { out: -0.03 });
      k.eyes({ dx: 0.28, dy: 0.24 });
      for (const sx of [-1, 1]) k.bump('nose', [sx * 0.06, -0.14, 1], 0.035, [1, 1, 0.6]);
      k.mouth({ dy: -0.48, w: 0.3, h: 0.2 });
    },
  },
  penguin: {
    head: [0.74, 0.68, 0.68], nose: 0xffa31a,
    build(k) {
      for (const sx of [-1, 1]) k.decal('detail', [sx * 0.27, 0.12, 1], ellipseShape(0.36, 0.44));
      k.decal('detail', [0, -0.34, 1], ellipseShape(0.52, 0.38));
      for (const sx of [-1, 1]) k.decal('tongue', [sx * 0.5, -0.24, 1], ellipseShape(0.1, 0.065));
      k.eyes({ dx: 0.29, dy: 0.24 });
      k.part('nose', new THREE.ConeGeometry(0.11, 0.24, 12), [0, -0.12, 1], { at: [0, 0, 0.08], rot: [Math.PI / 2, 0, 0], scale: [1.3, 1, 0.8] });
      for (const [dx, tilt] of [[-0.1, 0.35], [0, 0], [0.1, -0.35]]) {
        k.part('skin', new THREE.ConeGeometry(0.07, 0.24, 8), [dx, 1, 0.1], { up: true, out: -0.04, roll: tilt, at: [0, 0.1, 0] });
      }
      k.mouth({ dy: -0.5, w: 0.26, h: 0.18 });
    },
  },
};

/**
 * Torso, arms and gloves, relative to the top of the seat. The same for every
 * chassis because every chassis puts its steering wheel at STEER_AT from the
 * seat, so the hands always land on the rim.
 */
function torsoParts() {
  const P = createParts();
  P.add('shirt', capsule(0.21, 0.16, 12), [0, 0.3, -0.02]);
  const rimAt = (x) => STEER_AT.clone().add(new V3(x, 0.06, 0).applyAxisAngle(new V3(1, 0, 0), STEER_TILT));
  for (const sx of [-1, 1]) {
    const shoulder = new V3(sx * 0.21, 0.44, 0.0);
    const hand = rimAt(sx * 0.17);
    capsuleBetween(P, 'shirt', shoulder, hand, 0.068, 8);
    P.add('white', sphere(0.08, 12, 10), hand);
  }
  return P.bake();
}

const driverCache = new Map();
let torsoCache = null;

function driverParts(id) {
  let d = driverCache.get(id);
  if (d) return d;
  const spec = SPECIES[id] || SPECIES.panda;
  const { kit, finish } = driverKit(spec.head);
  kit.P.add('skin', sphere(1, 36, 26), null, null, spec.head);
  spec.build(kit);
  d = { ...finish(), spec };
  torsoCache ||= torsoParts();
  d.torso = torsoCache;
  driverCache.set(id, d);
  return d;
}

/** Steering wheel: rim in the XY plane, column running down local +Z into the dash. */
let steeringCache = null;
function steeringParts() {
  if (steeringCache) return steeringCache;
  const P = createParts();
  P.add('tray', new THREE.TorusGeometry(0.19, 0.035, 8, 22));
  P.add('tray', roundedBox(0.36, 0.04, 0.03, 0.012));
  P.add('tray', cylinder(0.04, 0.04, 0.44, 8), [0, 0, 0.22], [Math.PI / 2, 0, 0]);
  P.add('accent', cylinder(0.055, 0.055, 0.04, 12), [0, 0, -0.01], [Math.PI / 2, 0, 0]);
  steeringCache = P.bake();
  return steeringCache;
}

/* ── Effects geometry (shared) ──────────────────────────────────────── */

const fxCache = {};

/** Unit sphere, scaled per kart for the shield and spawn bubbles. */
function bubbleGeometry() {
  if (!fxCache.bubble) {
    fxCache.bubble = new THREE.SphereGeometry(1, 36, 24);
    fxCache.bubble.userData.shared = true;
  }
  return fxCache.bubble;
}

function iceGeometry() {
  if (!fxCache.ice) {
    fxCache.ice = roundedBox(1, 1, 1, 0.08);
    fxCache.ice.userData.shared = true;
  }
  return fxCache.ice;
}

/** Cone with its base on the origin and its point at +Y 1: scaled and aimed per pipe. */
function flameGeometry() {
  if (!fxCache.flame) {
    const g = new THREE.ConeGeometry(1, 1, 10);
    g.translate(0, 0.5, 0);
    g.userData.shared = true;
    fxCache.flame = g;
  }
  return fxCache.flame;
}

/** Four black balls with white spikes, laid out on the orbit ring. */
function orbitParts() {
  if (fxCache.orbit) return fxCache.orbit;
  const radius = WEAPONS.spikes?.radius ?? 2.6;
  const P = createParts();
  const dirs = [];
  for (const sx of [-1, 1]) {
    dirs.push(new V3(sx, 0, 0), new V3(0, sx, 0), new V3(0, 0, sx));
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) dirs.push(new V3(sx, sy, sz).normalize());
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const c = new V3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    P.add('ball', sphere(0.32, 16, 12), c);
    for (const d of dirs) {
      P.add('spike', new THREE.ConeGeometry(0.075, 0.26, 8), c.clone().addScaledVector(d, 0.38), alongY(d));
    }
  }
  fxCache.orbit = P.bake();
  return fxCache.orbit;
}

/** Three little stars circling a wrecked driver's head. */
function dizzyParts() {
  if (fxCache.dizzy) return fxCache.dizzy;
  const star = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.055 : 0.13;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(star, {
    depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 1,
  });
  const P = createParts();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    P.add('star', g, [Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55], [0, -a + Math.PI / 2, 0]);
  }
  fxCache.dizzy = P.bake();
  return fxCache.dizzy;
}

/** Soft four-point twinkle for the spawn sparkles, drawn once. */
function sparkleTexture() {
  if (fxCache.sparkle) return fxCache.sparkle;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 20);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(32, 2);
  g.quadraticCurveTo(35, 29, 62, 32);
  g.quadraticCurveTo(35, 35, 32, 62);
  g.quadraticCurveTo(29, 35, 2, 32);
  g.quadraticCurveTo(29, 29, 32, 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;
  fxCache.sparkle = t;
  return t;
}

/**
 * Bubble shield: see-through in the middle and brighter at the rim, which is
 * what makes a sphere read as a bubble rather than a tinted ball. Opacity
 * lives on the material like any other (so invisibility can fade it) and is
 * fed to the shader each frame along with the pulse.
 */
function bubbleMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
        float a = uAlpha * (0.14 + 0.62 * pow(rim, 2.2));
        gl_FragColor = vec4(uColor + vec3(0.4) * pow(rim, 3.0), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}

/* ── Paint ──────────────────────────────────────────────────────────── */

/**
 * The chassis' accent colour, unless the player's own colour is too close to
 * it to tell apart (a blue player in a blue-trimmed kart), in which case its
 * alternate.
 */
function accentFor(primary, kartDef) {
  const a = new THREE.Color(primary).getHSL({});
  const b = new THREE.Color(kartDef.accent).getHSL({});
  const dh = Math.min(Math.abs(a.h - b.h), 1 - Math.abs(a.h - b.h));
  const bothColourful = a.s > 0.3 && b.s > 0.3;
  const clash = bothColourful ? dh < 0.08 : Math.abs(a.l - b.l) < 0.18 && dh < 0.2;
  return clash ? kartDef.accentAlt : kartDef.accent;
}

/* ── The kart ───────────────────────────────────────────────────────── */

/**
 * @param {number} color  the player's paint
 * @param {string} name   shown on the tag over a rival's kart
 * @param {object} opts   { showTag = true, character, kart, local = false }
 *   local    the player's own kart: its tag carries no name, only the health
 *            bar (and only while setLabel's showBar is true). A local kart
 *            always gets that bar-only tag, whatever showTag says.
 *   showTag  false builds no tag at all (menu previews, thumbnails).
 */
export function createKartMesh(color = 0xe74c3c, name = 'Player', opts = {}) {
  const { showTag = true, local = false } = opts;
  const charDef = CHARACTERS[validCharacter(opts.character)];
  const kartDef = KARTS[validKart(opts.kart)];
  const chassis = chassisParts(kartDef.id);
  const driver = driverParts(charDef.id);
  const { anchors } = chassis;

  /* Materials: one per slot, per kart, created on first use. */
  const materials = [];
  const bySlot = new Map();
  const slotColor = {
    paint: color,
    accent: accentFor(color, kartDef),
    skin: charDef.skin,
    detail: charDef.detail,
    shirt: charDef.accent,
    nose: driver.spec.nose ?? 0xff8fa8,
    patch: driver.spec.patch ?? charDef.detail,
    star: 0xffd23f,
    ...FIXED,
  };
  const mat = (slot) => {
    let m = bySlot.get(slot);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: slotColor[slot] ?? 0xff00ff });
      bySlot.set(slot, m);
      materials.push(m);
    }
    return m;
  };

  const group = new THREE.Group();
  // Heading first, then the lean to the ground in the kart's own frame: with
  // the default XYZ order a pitch would be applied around the world X axis and
  // tip the kart sideways whenever it is not facing straight down Z.
  group.rotation.order = 'YXZ';
  const body = new THREE.Group();
  group.add(body);

  /** One mesh per baked slot. Static, so their local matrices are set once. */
  const addBaked = (parent, slots, { fx = false } = {}) => {
    const out = [];
    for (const [slot, geo] of Object.entries(slots)) {
      const m = new THREE.Mesh(geo, mat(slot));
      m.castShadow = !fx && CAST_SHADOW.has(slot);
      m.receiveShadow = !fx && RECEIVE_SHADOW.has(slot);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      if (fx) m.userData.fx = true;
      parent.add(m);
      out.push(m);
    }
    return out;
  };

  // ── Chassis ──
  addBaked(body, chassis.slots);

  // ── Driver ──
  const seatAt = anchors.seat;
  const driverGroup = new THREE.Group();
  driverGroup.position.set(0, seatAt.y, seatAt.z);
  body.add(driverGroup);
  addBaked(driverGroup, driver.torso);

  const steering = new THREE.Group();
  steering.position.copy(STEER_AT);
  steering.rotation.x = STEER_TILT;
  driverGroup.add(steering);
  addBaked(steering, steeringParts());

  const head = new THREE.Group();
  head.position.copy(HEAD_AT);
  driverGroup.add(head);
  addBaked(head, driver.head);
  const eyes = new THREE.Group();
  eyes.position.copy(driver.eyeCentre);
  head.add(eyes);
  addBaked(eyes, driver.eyes);
  const xEyes = addBaked(head, driver.xeyes, { fx: true });
  for (const m of xEyes) m.visible = false;
  const dizzy = new THREE.Group();
  dizzy.position.set(0, driver.R[1] + 0.12, 0);
  dizzy.visible = false;
  head.add(dizzy);
  addBaked(dizzy, dizzyParts(), { fx: true });
  // The stars only ever show on a wreck, so they are the one thing not charred.
  mat('star').emissive.set(0x8a6a00);
  mat('star').userData.keepColor = true;

  // ── Wheels ──
  // They live in `group`, not `body`, so body roll does not lift them off
  // the ground, and each spins by its own radius.
  const wheels = [];
  for (const [which, spec] of Object.entries(anchors.wheels)) {
    for (const sx of [-1, 1]) {
      const mount = new THREE.Group();
      mount.position.set(sx * (spec.x - spec.w / 2), spec.r, spec.z);
      const spinner = new THREE.Group();
      mount.add(spinner);
      addBaked(spinner, wheelParts(spec.r, spec.w, sx));
      group.add(mount);
      wheels.push({ mount, spinner, front: which === 'front', r: spec.r });
    }
  }

  // ── Measure the model at rest, for the tag height and effect sizes ──
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  group.traverse((o) => {
    if (!o.isMesh || o.userData.fx) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    bounds.union(tmpBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  const size = bounds.getSize(new V3());
  const centre = bounds.getCenter(new V3());

  // ── Name / health tag ──
  const hasTag = local || showTag;
  const tag = hasTag ? createTag({ name, hp: 100, badge: null, showBar: true, local }) : null;
  if (tag) {
    tag.position.y = bounds.max.y + TAG_GAP;
    group.add(tag);
  }

  // ── Status effects ──
  const bubbleR = 0.5 * Math.max(size.x, size.z) * 1.06;
  const bubbleY = Math.min(centre.y, 0.95);

  const fxMesh = (geo, material, parent = group) => {
    const m = new THREE.Mesh(geo, material);
    m.userData.fx = true;
    m.visible = false;
    parent.add(m);
    materials.push(material);
    return m;
  };

  const shieldBubble = fxMesh(bubbleGeometry(), bubbleMaterial(0x55ccff));
  shieldBubble.scale.setScalar(bubbleR * 1.06);
  shieldBubble.position.y = bubbleY;
  shieldBubble.renderOrder = 2;

  const spawnBubble = fxMesh(bubbleGeometry(), bubbleMaterial(0x45e85e));
  spawnBubble.scale.setScalar(bubbleR);
  spawnBubble.position.y = bubbleY;
  spawnBubble.renderOrder = 2;

  const SPARKLES = 14;
  const sparkleGeo = new THREE.BufferGeometry();
  sparkleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKLES * 3), 3));
  sparkleGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKLES * 4), 4));
  const sparkleMat = new THREE.PointsMaterial({
    size: 0.34, map: sparkleTexture(), vertexColors: true, transparent: true, depthWrite: false,
  });
  const sparkles = new THREE.Points(sparkleGeo, sparkleMat);
  sparkles.userData.fx = true;
  sparkles.visible = false;
  sparkles.frustumCulled = false;
  sparkles.renderOrder = 3;
  group.add(sparkles);
  materials.push(sparkleMat);
  const sparkleState = Array.from({ length: SPARKLES }, () => ({ a: 0, r: 0, y: 0, v: 0, top: 0 }));
  const resetSparkle = (s, scatter) => {
    s.a = Math.random() * Math.PI * 2;
    s.r = bubbleR * (0.35 + Math.random() * 0.6);
    s.top = 1.6 + Math.random() * 1.2;
    s.y = scatter ? Math.random() * s.top : 0;
    s.v = 0.7 + Math.random() * 0.9;
  };
  for (const s of sparkleState) resetSparkle(s, true);

  const iceBlock = fxMesh(iceGeometry(), new THREE.MeshLambertMaterial({
    color: 0xbfeeff, transparent: true, opacity: 0.55, emissive: 0x3aa8ff, emissiveIntensity: 0.3,
  }));
  iceBlock.scale.set(size.x + 0.2, size.y + 0.15, size.z + 0.2);
  iceBlock.position.copy(centre);

  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa62b, transparent: true, opacity: 0.92 });
  materials.push(flameMat);
  const boostFlames = anchors.exhausts.map((e) => {
    const f = new THREE.Mesh(flameGeometry(), flameMat);
    f.userData.fx = true;
    f.userData.r = e.r;
    f.position.copy(e.pos);
    f.quaternion.copy(alongY(e.dir));
    f.visible = false;
    body.add(f);
    return f;
  });

  const orbit = new THREE.Group();
  orbit.name = 'orbit';
  orbit.position.y = 0.6;
  orbit.visible = false;
  group.add(orbit);
  {
    const parts = orbitParts();
    const ball = new THREE.Mesh(parts.ball, new THREE.MeshLambertMaterial({ color: 0x1b1d22 }));
    const spike = new THREE.Mesh(parts.spike, new THREE.MeshLambertMaterial({ color: 0xf4f6f8 }));
    for (const m of [ball, spike]) {
      m.userData.fx = true;
      m.castShadow = true;
      orbit.add(m);
      materials.push(m.material);
    }
  }
  const ORBIT_SPIN = WEAPONS.spikes?.spin ?? 6;

  /* ── Per-kart state ── */
  const flashMats = [mat('paint'), mat('accent')];
  /** What each material was built with, so ghosting and charring undo exactly. */
  const base = new Map(materials.map((m) => [m, {
    opacity: m.opacity, transparent: !!m.transparent, depthWrite: m.depthWrite,
    color: m.color && !m.isShaderMaterial ? m.color.clone() : null,
  }]));
  const headRest = head.position.clone();
  const phase = Math.random() * Math.PI * 2;
  let clock = 0;
  let steerSmooth = 0;
  let flashTimer = 0;
  let lastGhost = 1;
  let wrecked = false;
  let wreckK = 0;
  // Smoothed lean to the ground under the wheels (see view.groundPitch/Roll).
  let tiltPitch = 0;
  let tiltRoll = 0;
  let blinkIn = 1 + Math.random() * 3;
  let blinkT = 0;
  let orbitAngle = Math.random() * Math.PI * 2;

  const applyChar = () => {
    for (const [m, b] of base) {
      if (!b.color) continue;
      m.color.copy(b.color);
      if (wrecked && !m.userData.keepColor) m.color.lerp(CHARCOAL, CHAR_AMOUNT);
    }
  };

  const setWrecked = (on) => {
    wrecked = on;
    applyChar();
    for (const m of xEyes) m.visible = on;
    eyes.visible = !on;
    dizzy.visible = on;
    if (!on) {
      wreckK = 0;
      group.rotation.z = 0;
      head.position.copy(headRest);
      head.rotation.set(0, 0, 0);
    }
  };

  return {
    group,
    body,
    materials,
    /** The model's extent at rest in its own space (no tag, no effects). */
    bounds,

    setColor(next) {
      base.get(mat('paint')).color.set(next);
      base.get(mat('accent')).color.set(accentFor(next, kartDef));
      applyChar();
    },

    /**
     * @param {string} nextName
     * @param {number} hp 0-100
     * @param {{ badge?: number|null, showBar?: boolean }} [extra]
     *   badge    a number in a blue hexagon left of the bar (the score), or null
     *   showBar  whether the health bar is drawn at all
     */
    setLabel(nextName, hp, { badge = null, showBar = true } = {}) {
      if (!tag) return;
      const s = tag.userData.state;
      const nextBadge = badge ?? null;
      if (nextName === s.name && Math.abs(hp - s.hp) < 1 && nextBadge === s.badge && showBar === s.showBar) return;
      s.name = nextName;
      s.hp = hp;
      s.badge = nextBadge;
      s.showBar = showBar;
      paintTag(tag);
    },

    flash() { flashTimer = 0.25; },

    /**
     * @param {object} view render pose: { x, y, z, yaw, speed, yawRate, drifting,
     *   grounded, groundPitch, groundRoll, steer, accel, boost, shield,
     *   spawnShield, orbit, stunned, invisible, isLocal, alive, tagOpacity,
     *   camDist }. groundPitch is nose-up radians, groundRoll left-side-up
     *   radians, of the surface under the kart. Missing numbers
     *   count as 0, so a menu preview can pass just a position.
     */
    apply(view, dt = 0) {
      clock += dt;
      const alive = view.alive !== false;
      const speed = view.speed || 0;
      const yawRate = view.yawRate || 0;
      const steer = view.steer || 0;
      const yaw = view.yaw || 0;
      if (alive === wrecked) setWrecked(!alive);

      group.position.set(view.x || 0, view.y || 0, view.z || 0);
      group.rotation.y = yaw;
      const a = 1 - Math.exp(-11 * dt);

      // Lie along the ground: a slope or ramp tips the whole kart so its
      // wheels sit on the surface instead of its nose or tail digging into it.
      // Quick enough to follow the bowl, soft enough that a ramp's edge does
      // not snap it. In the air it eases back to level.
      const onGround = view.grounded !== false;
      const tiltK = dt > 0 ? 1 - Math.exp(-14 * dt) : 1;
      tiltPitch += ((onGround ? view.groundPitch || 0 : 0) - tiltPitch) * tiltK;
      tiltRoll += ((onGround ? view.groundRoll || 0 : 0) - tiltRoll) * tiltK;
      group.rotation.x = -tiltPitch;
      group.rotation.z = tiltRoll;

      if (alive) {
        // Body roll and pitch sell the weight transfer.
        const targetRoll = THREE.MathUtils.clamp(-yawRate * (view.drifting ? 0.16 : 0.09), -0.4, 0.4);
        const targetPitch = THREE.MathUtils.clamp(
          (view.grounded !== false ? -(view.accel || 0) * 0.012 : 0.1), -0.16, 0.16,
        );
        body.rotation.z += (targetRoll - body.rotation.z) * a;
        body.rotation.x += (targetPitch - body.rotation.x) * a;
        // Drifting swings the whole kart sideways relative to travel.
        const targetSlip = view.drifting ? -Math.sign(yawRate || 1) * 0.38 : 0;
        body.rotation.y += (targetSlip - body.rotation.y) * a;

        steerSmooth += (THREE.MathUtils.clamp(steer, -1, 1) * 0.5 - steerSmooth) * (1 - Math.exp(-13 * dt));
        for (const w of wheels) {
          w.spinner.rotation.x += (speed / w.r) * dt;
          w.mount.rotation.y = w.front ? steerSmooth : 0;
        }
        steering.rotation.z = -steerSmooth * 1.6;

        // A little life in the driver: a bob, a lean into the turn, a blink.
        head.position.y = headRest.y + Math.sin(clock * 2.3 + phase) * 0.012;
        head.rotation.z = -steerSmooth * 0.16;
        blinkIn -= dt;
        if (blinkIn <= 0) {
          blinkT = 0.15;
          blinkIn = 2.2 + Math.random() * 3.5;
        }
        if (blinkT > 0) {
          blinkT = Math.max(0, blinkT - dt);
          eyes.scale.y = 1 - Math.sin(Math.PI * (1 - blinkT / 0.15)) * 0.92;
        } else {
          eyes.scale.y = 1;
        }
      } else {
        // A wreck: rolled onto one side, nose down, driver slumped and seeing
        // stars. It eases in so the kill reads as a crash, not a cut.
        wreckK += (1 - wreckK) * (1 - Math.exp(-8 * dt));
        group.rotation.z = tiltRoll + 0.55 * wreckK;
        group.position.y += 0.42 * wreckK;
        body.rotation.x += (0.14 - body.rotation.x) * a;
        body.rotation.y += (0 - body.rotation.y) * a;
        body.rotation.z += (0 - body.rotation.z) * a;
        head.rotation.set(0.5 * wreckK, 0, 0.32 * wreckK);
        head.position.set(headRest.x, headRest.y - 0.14 * wreckK, headRest.z + 0.1 * wreckK);
        dizzy.rotation.y += dt * 3;
      }

      shieldBubble.visible = alive && !!view.shield;
      if (shieldBubble.visible) {
        shieldBubble.rotation.y += dt * 1.6;
        shieldBubble.material.uniforms.uAlpha.value = shieldBubble.material.opacity * (0.85 + Math.sin(clock * 6) * 0.15);
      }

      const spawning = alive && !!view.spawnShield;
      spawnBubble.visible = spawning;
      sparkles.visible = spawning;
      if (spawning) {
        const pulse = 1 + Math.sin(clock * 4.5) * 0.025;
        spawnBubble.scale.setScalar(bubbleR * pulse);
        spawnBubble.material.uniforms.uAlpha.value = spawnBubble.material.opacity * (0.88 + Math.sin(clock * 4.5) * 0.12);
        const pos = sparkleGeo.attributes.position;
        const col = sparkleGeo.attributes.color;
        sparkleState.forEach((s, i) => {
          s.y += s.v * dt;
          if (s.y > s.top) resetSparkle(s, false);
          const t = s.y / s.top;
          const twinkle = 0.6 + 0.4 * Math.sin(clock * 9 + i * 1.7);
          pos.setXYZ(i, Math.cos(s.a) * s.r, s.y, Math.sin(s.a) * s.r);
          col.setXYZW(i, 1, 1, 1, Math.sin(Math.PI * t) * twinkle);
        });
        pos.needsUpdate = true;
        col.needsUpdate = true;
      }

      iceBlock.visible = alive && !!view.stunned;

      const boosting = alive && !!view.boost;
      for (const f of boostFlames) {
        f.visible = boosting;
        if (boosting) {
          const r = f.userData.r * (0.95 + Math.random() * 0.2);
          f.scale.set(r, 0.45 + Math.random() * 0.35 + f.userData.r, r);
        }
      }

      orbit.visible = alive && !!view.orbit;
      if (orbit.visible) {
        // Spun in world space, so turning the kart does not whip the balls round.
        orbitAngle += ORBIT_SPIN * dt;
        orbit.rotation.y = orbitAngle - yaw;
      }

      if (flashTimer > 0) {
        flashTimer = Math.max(0, flashTimer - dt);
        const k = flashTimer / 0.25;
        for (const m of flashMats) {
          m.emissive.setHex(0xff2222);
          m.emissiveIntensity = k * 1.2;
        }
        group.scale.setScalar(1 + k * 0.12);
      } else if (group.scale.x !== 1) {
        for (const m of flashMats) m.emissiveIntensity = 0;
        group.scale.setScalar(1);
      }

      // Invisibility: gone entirely for everyone else, a faint ghost for the
      // player using it — you need to see where your own kart is, but nobody
      // watching should get a silhouette to aim at.
      const isLocal = view.isLocal ?? local;
      const ghost = view.invisible ? (isLocal ? 0.22 : 0) : 1;
      if (ghost !== lastGhost) {
        lastGhost = ghost;
        for (const m of materials) {
          const b = base.get(m);
          // Restore what each material was built with rather than forcing
          // opaque: the bubbles, flames, sparkles and ice are meant to stay
          // see-through, and depth writes must come back exactly as they were
          // or transparent parts sort differently after the first ghosting.
          m.transparent = ghost < 1 || b.transparent;
          m.opacity = ghost < 1 ? ghost * b.opacity : b.opacity;
          m.depthWrite = ghost < 1 ? false : b.depthWrite;
        }
      }

      group.visible = ghost > 0;
      if (tag) {
        // No tag over a wreck: there is no health left to show.
        const tagAlpha = alive && !view.invisible ? (view.tagOpacity ?? 1) : 0;
        tag.visible = group.visible && tagAlpha > 0.03 && tag.userData.drawn;
        tag.material.opacity = tagAlpha;
        // Sprites shrink and grow with perspective like any other geometry, so
        // a kart that drives up alongside you gets a name plate across half
        // the screen. Scale against camera distance to hold a roughly constant
        // size, clamped so tags stay legible far away without dwarfing a
        // nearby kart.
        if (tag.visible && view.camDist) {
          const k = Math.min(1.35, Math.max(0.55, view.camDist / TAG_REF_DIST));
          tag.scale.set(TAG_W * k, TAG_H * k, 1);
        }
      }
    },

    dispose() {
      // Baked geometry is shared with every other kart of the same make and
      // driver, so only per-kart geometry (the sparkles) is freed here.
      group.traverse((o) => {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      });
      for (const m of materials) m.dispose();
      if (tag) {
        liveTags.delete(tag);
        tag.material.map?.dispose();
        tag.material.dispose();
      }
    },
  };
}

/* ── Name + health sprite ───────────────────────────────────────────── */

/** Canvas layout in CSS pixels; the backing store is scaled by the device pixel ratio. */
const TAG_CW = 256;
const TAG_CH = 96;
const TAG_W = 3.0;
const TAG_H = TAG_W * (TAG_CH / TAG_CW);
/** Camera distance at which a tag draws at its nominal size. */
const TAG_REF_DIST = 11;
/** Gap between the top of the model and the bottom of the tag. */
const TAG_GAP = 0.18;
const TAG_FONT = '"Baloo 2", "Fredoka", system-ui, sans-serif';

/** Every live tag, so all of them can repaint once the web font has loaded. */
const liveTags = new Set();

if (typeof document !== 'undefined' && document.fonts?.load) {
  document.fonts.load(`800 30px ${TAG_FONT}`).then(() => {
    for (const t of liveTags) paintTag(t);
  }).catch(() => {});
}

function createTag(state) {
  const px = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(TAG_CW * px);
  canvas.height = Math.round(TAG_CH * px);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false,
  }));
  // Anchored at its bottom edge, so scaling with distance grows it upward and
  // the bar always sits just over the driver's head.
  sprite.center.set(0.5, 0);
  sprite.scale.set(TAG_W, TAG_H, 1);
  sprite.renderOrder = 10;
  sprite.userData.canvas = canvas;
  sprite.userData.px = px;
  sprite.userData.state = state;
  liveTags.add(sprite);
  paintTag(sprite);
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

function hexagon(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Trim a name to fit, ending in an ellipsis, rather than chopping it mid-letter. */
function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/**
 * Bold white name with a dark-blue outline; under it an optional score badge
 * (blue hexagon) and a short white health bar in a blue frame — the same
 * language as the HUD. The player's own tag is the bar alone.
 */
function paintTag(sprite) {
  const { canvas, px, state } = sprite.userData;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(px, 0, 0, px, 0, 0);
  ctx.clearRect(0, 0, TAG_CW, TAG_CH);
  ctx.lineJoin = 'round';
  let drawn = false;

  const showName = !state.local && state.name;
  if (showName) {
    ctx.font = `800 30px ${TAG_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = fitText(ctx, String(state.name), TAG_CW - 24);
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#0b2a6b';
    ctx.strokeText(text, TAG_CW / 2, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, TAG_CW / 2, 30);
    drawn = true;
  }

  const barH = 16;
  const barY = 68;
  const hasBadge = state.badge !== null && state.badge !== undefined && !state.local;
  if (state.showBar) {
    const barW = 112;
    const barX = (TAG_CW - barW) / 2 + (hasBadge ? 12 : 0);
    roundRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fillStyle = '#0d3f9e';
    ctx.fill();
    roundRect(ctx, barX + 3, barY + 3, barW - 6, barH - 6, (barH - 6) / 2);
    ctx.fillStyle = '#2a7de1';
    ctx.fill();
    const frac = Math.max(0, Math.min(1, state.hp / 100));
    if (frac > 0) {
      roundRect(ctx, barX + 3, barY + 3, Math.max(barH - 6, (barW - 6) * frac), barH - 6, (barH - 6) / 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    drawn = true;
  }

  if (hasBadge) {
    const cx = state.showBar ? (TAG_CW - 112) / 2 + 6 : TAG_CW / 2;
    const cy = barY + barH / 2;
    hexagon(ctx, cx, cy, 17);
    ctx.fillStyle = '#1f6fe0';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0b2a6b';
    ctx.stroke();
    hexagon(ctx, cx, cy, 13.5);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#9ccfff';
    ctx.stroke();
    ctx.font = `800 17px ${TAG_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = String(state.badge);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#0b2a6b';
    ctx.strokeText(label, cx, cy + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, cx, cy + 1);
    drawn = true;
  }

  // An empty tag (own kart at full health) is hidden rather than drawn blank.
  sprite.userData.drawn = drawn;
  sprite.material.map.needsUpdate = true;
}
