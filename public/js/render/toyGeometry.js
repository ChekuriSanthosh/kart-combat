/**
 * Chunky toy geometry and a static-mesh batcher.
 *
 * The arenas are drawn from the same numbers the physics uses, so these
 * shapes keep a solid's exact footprint and only soften its edges: a rounded
 * box occupies the same box, a rounded cylinder the same cylinder. The
 * collision never knows the difference, and the eye reads soft toy blocks
 * instead of sharp CAD primitives.
 *
 * three's RoundedBoxGeometry and BufferGeometryUtils are addons, which this
 * game does not serve, so the small parts of them it needs live here.
 */

import * as THREE from 'three';

/**
 * A box with every edge rounded to `radius`.
 *
 * Built like the addon: a unit box subdivided into 2·seg+1 slices per axis,
 * whose single middle slice stretches over each flat face and whose outer
 * slices are bent round the edge. With `roundBottom` false the bottom edges
 * stay square (the lower bevel slices collapse onto the base), which is what
 * a wall standing on the ground wants: rounded where you see it, and no
 * groove where it meets the floor.
 */
export function roundedBoxGeometry(w, h, d, radius, seg = 3, roundBottom = true) {
  const half = [w / 2, h / 2, d / 2];
  const r = Math.max(0.001, Math.min(radius, half[0], half[1], half[2]) - 0.001);
  const n = seg * 2 + 1;
  const geo = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const band = 0.5 / n;
  const c = [0, 0, 0];
  const inner = [0, 0, 0];
  const out = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    c[0] = pos.getX(i); c[1] = pos.getY(i); c[2] = pos.getZ(i);
    for (let a = 0; a < 3; a++) {
      const mag = Math.abs(c[a]);
      // How far into the bevel this vertex is along this axis, 0..1.
      const into = Math.max(0, mag - band) / (0.5 - band);
      inner[a] = Math.sign(c[a]) * Math.min(1, mag / band) * (half[a] - r);
      out.setComponent(a, Math.sign(c[a]) * into);
    }
    let bottomFlat = false;
    if (!roundBottom && c[1] < -band + 1e-6) {
      // Square base: drop the vertical part of the bevel direction and pin
      // the vertex to the bottom plane.
      out.y = 0;
      bottomFlat = true;
    }
    if (out.lengthSq() < 1e-12) out.set(0, Math.sign(c[1]) || 1, 0);
    out.normalize();
    const px = inner[0] + out.x * r;
    const pz = inner[2] + out.z * r;
    const py = bottomFlat ? -half[1] : inner[1] + out.y * r;
    pos.setXYZ(i, px, py, pz);
    // The base itself (seen only from below) faces down.
    if (bottomFlat && Math.abs(c[1] + 0.5) < 1e-6 && nor.getY(i) < -0.5) nor.setXYZ(i, 0, -1, 0);
    else nor.setXYZ(i, out.x, out.y, out.z);
  }
  geo.deleteAttribute('uv');
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Upright cylinder of radius `r` and height `h` (base at y = 0) with a
 * rounded top edge, built as a lathe so the normals are smooth all round.
 *
 *   top     radius of the top-edge rounding
 *   bottom  radius of the bottom-edge rounding (0 = flat base, for things
 *           standing on the ground)
 *   bulge   fraction of r the middle of the side swells out by (boulders,
 *           hay bales); the footprint at the base stays r
 *   inset   fraction of r the base is pulled in by (a pebble sits on a
 *           smaller foot than its widest point)
 */
export function roundedCylinderGeometry(r, h, opts = {}) {
  const top = Math.min(opts.top ?? r * 0.15, r * 0.95, h * 0.95);
  const bottom = Math.min(opts.bottom ?? 0, r * 0.95, h - top);
  const bulge = opts.bulge ?? 0;
  const inset = opts.inset ?? 0;
  const radial = opts.radial ?? 32;
  const arc = opts.arc ?? 5;

  const pts = [];
  pts.push(new THREE.Vector2(0, 0));
  const baseR = r * (1 - inset);
  if (bottom > 0) {
    for (let i = 0; i <= arc; i++) {
      const t = (i / arc) * Math.PI / 2;
      pts.push(new THREE.Vector2(baseR - bottom + Math.sin(t) * bottom, bottom - Math.cos(t) * bottom));
    }
  } else {
    pts.push(new THREE.Vector2(baseR, 0));
  }
  // The side, with an optional swell in the middle.
  const sideFrom = bottom;
  const sideTo = h - top;
  const sideSteps = bulge || inset ? 6 : 1;
  for (let i = 1; i <= sideSteps; i++) {
    const t = i / sideSteps;
    const y = sideFrom + (sideTo - sideFrom) * t;
    const swell = Math.sin(t * Math.PI) * bulge;
    const lift = inset * (1 - t);
    pts.push(new THREE.Vector2(r * (1 + swell - lift), y));
  }
  for (let i = 1; i <= arc; i++) {
    const t = (i / arc) * Math.PI / 2;
    pts.push(new THREE.Vector2(r - top + Math.cos(t) * top, h - top + Math.sin(t) * top));
  }
  pts.push(new THREE.Vector2(0, h));
  const geo = new THREE.LatheGeometry(pts, radial);
  geo.deleteAttribute('uv');
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * A transform matrix in one call. Rotation order is Y last (heading), so
 * `ry` turns the already-tilted part, which is how props are placed.
 */
export function xf(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/**
 * Collects static parts — (geometry, colour, matrix) — and merges them into
 * ONE BufferGeometry with per-vertex colours, drawn by one vertex-coloured
 * Lambert material. Scenery made of hundreds of trees, posts and bands then
 * costs a single draw call however much of it there is.
 *
 * Geometries are only read, so one prototype can be added many times.
 */
export function createBatch() {
  const parts = [];
  let vertexCount = 0;
  let indexCount = 0;

  return {
    get count() { return parts.length; },

    /** `matrix` may be omitted for identity; colour is an sRGB hex. */
    add(geometry, color, matrix) {
      const posAttr = geometry.attributes.position;
      parts.push({ geometry, color: new THREE.Color(color), matrix: matrix ? matrix.clone() : new THREE.Matrix4() });
      vertexCount += posAttr.count;
      indexCount += geometry.index ? geometry.index.count : posAttr.count;
    },

    /** Adds every part, then forgets them. Returns null when empty. */
    build() {
      if (!parts.length) return null;
      const positions = new Float32Array(vertexCount * 3);
      const normals = new Float32Array(vertexCount * 3);
      const colors = new Float32Array(vertexCount * 3);
      const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
      const indices = new IndexArray(indexCount);
      const normalMatrix = new THREE.Matrix3();
      const v = new THREE.Vector3();

      let vo = 0;
      let io = 0;
      for (const part of parts) {
        const g = part.geometry;
        const p = g.attributes.position;
        const nAttr = g.attributes.normal;
        normalMatrix.getNormalMatrix(part.matrix);
        // A mirrored transform flips the winding; keep the faces outward.
        const flip = part.matrix.determinant() < 0;
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(part.matrix);
          positions[(vo + i) * 3] = v.x;
          positions[(vo + i) * 3 + 1] = v.y;
          positions[(vo + i) * 3 + 2] = v.z;
          if (nAttr) v.fromBufferAttribute(nAttr, i).applyMatrix3(normalMatrix).normalize();
          else v.set(0, 1, 0);
          normals[(vo + i) * 3] = v.x;
          normals[(vo + i) * 3 + 1] = v.y;
          normals[(vo + i) * 3 + 2] = v.z;
          colors[(vo + i) * 3] = part.color.r;
          colors[(vo + i) * 3 + 1] = part.color.g;
          colors[(vo + i) * 3 + 2] = part.color.b;
        }
        if (g.index) {
          const idx = g.index.array;
          for (let i = 0; i < idx.length; i += 3) {
            indices[io++] = idx[i] + vo;
            indices[io++] = idx[flip ? i + 2 : i + 1] + vo;
            indices[io++] = idx[flip ? i + 1 : i + 2] + vo;
          }
        } else {
          for (let i = 0; i < p.count; i += 3) {
            indices[io++] = vo + i;
            indices[io++] = vo + (flip ? i + 2 : i + 1);
            indices[io++] = vo + (flip ? i + 1 : i + 2);
          }
        }
        vo += p.count;
      }
      parts.length = 0;
      vertexCount = 0;
      indexCount = 0;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeBoundingSphere();
      return geo;
    },
  };
}

/** A mesh from a batch with the shared vertex-colour material, or null. */
export function batchMesh(batch, material, { castShadow = true, receiveShadow = true } = {}) {
  const geo = batch.build();
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
