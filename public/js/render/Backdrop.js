/**
 * The world beyond the arena: a gradient sky, cartoon clouds, and a ring of
 * distant scenery so the horizon is never an empty line.
 *
 * The original never shows a void. Past its walls there is always sea,
 * banded hills or more clouds, and that is a large part of why its arenas
 * feel like places. All of it is driven by plain data on the map's theme:
 *
 *   theme.sky       { top, horizon, bottom }   dome gradient (sRGB hexes)
 *   theme.backdrop  {
 *     sea?:      { color, from, y }            flat sea from radius `from` out
 *     clouds?:   { count, r: [min, max], y: [min, max], size: [min, max] }
 *     cloudSea?: { y, r, size }                a floor of cloud below the arena
 *     rings?:    [{ prop, count, r: [min, max], h: [min, max], phase, colors }]
 *   }
 *
 * Everything static is merged into two meshes (scenery, clouds), so the
 * whole backdrop is three draw calls including the sky.
 */

import * as THREE from 'three';
import { createBatch, batchMesh } from './toyGeometry.js';
import { addMesa, addPalm, addCactus, addTree, addCloud, addHill, hash } from './props.js';

/** Sky dome radius. Inside the camera's 600 m far plane from anywhere in play. */
export const SKY_RADIUS = 470;

const IDENTITY = new THREE.Matrix4();

function skyDome(sky) {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 40, 28);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const top = new THREE.Color(sky.top);
  const horizon = new THREE.Color(sky.horizon);
  const bottom = new THREE.Color(sky.bottom ?? sky.horizon);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = pos.getY(i) / SKY_RADIUS;
    if (ny >= 0) {
      // Most of the change happens in the first 30° above the horizon, which
      // is the only part of the sky a chase camera ever looks at.
      c.lerpColors(horizon, top, Math.pow(ny, 0.55));
    } else {
      c.lerpColors(horizon, bottom, Math.min(1, -ny * 5));
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  // Drawn first and never culled: it is the backdrop for everything.
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return mesh;
}

const lerp = (range, t) => range[0] + (range[1] - range[0]) * t;

function addRing(batch, spec, ringIndex) {
  const n = spec.count;
  const colors = spec.colors || {};
  for (let i = 0; i < n; i++) {
    const seed = ringIndex * 1000 + i * 17;
    const a = (spec.phase ?? 0) + (i / n) * Math.PI * 2 + (hash(seed) - 0.5) * (Math.PI * 2 / n) * 0.7;
    const r = lerp(spec.r, hash(seed + 1));
    const h = lerp(spec.h ?? [8, 12], hash(seed + 2));
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = spec.y ?? 0;
    const parent = new THREE.Matrix4().makeTranslation(0, y, 0);
    switch (spec.prop) {
      case 'mesa':
        addMesa(batch, parent, x, z, h * (spec.widthRatio ?? 0.7), h, colors.bands ?? [0xe9844a, 0xf6b26b], seed, spec.base ?? -4);
        break;
      case 'hill': {
        const tones = colors.tones ?? [0x5ccf3e, 0x4bbf37, 0x6fdc4a];
        addHill(batch, parent, x, z, h * (spec.widthRatio ?? 2.2), h, tones[i % tones.length], spec.base ?? -2);
        break;
      }
      case 'tree':
        addTree(batch, parent, x, z, h, seed, colors);
        break;
      case 'palm':
        addPalm(batch, parent, x, z, h, seed, colors);
        break;
      case 'cactus':
        addCactus(batch, parent, x, z, h, seed, colors.body);
        break;
      case 'cloudBank':
        addCloud(batch, parent, x, 0, z, h, seed, colors.body ?? 0xffffff);
        break;
      default:
        break;
    }
  }
}

/**
 * @param {object} theme  the map's theme
 * @returns {{ group, update(dt), dispose() }}
 */
export function buildBackdrop(theme) {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const disposables = [];
  const own = (x) => { disposables.push(x); return x; };

  const sky = theme.sky ?? { top: 0x5ab0ff, horizon: 0xe6f5ff };
  const dome = skyDome(sky);
  own(dome.geometry);
  own(dome.material);
  group.add(dome);

  const bd = theme.backdrop || {};

  // Sea: one flat ring, fogged so it melts into the horizon colour.
  if (bd.sea) {
    const from = bd.sea.from;
    const sea = new THREE.Mesh(
      own(new THREE.RingGeometry(from - 8, SKY_RADIUS + 10, 96, 1)),
      own(new THREE.MeshLambertMaterial({ color: bd.sea.color })),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = bd.sea.y ?? -0.4;
    sea.receiveShadow = false;
    group.add(sea);
    // A white surf line where the ground meets the water.
    const foam = new THREE.Mesh(
      own(new THREE.RingGeometry(from - 0.2, from + 1.6, 96, 1)),
      own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = (bd.sea.y ?? -0.4) + 0.08;
    group.add(foam);
  }

  // Distant scenery, merged.
  const scenery = createBatch();
  (bd.rings || []).forEach((ring, i) => addRing(scenery, ring, i));
  const sceneryMat = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const sceneryMesh = batchMesh(scenery, sceneryMat, { castShadow: false, receiveShadow: false });
  if (sceneryMesh) {
    own(sceneryMesh.geometry);
    group.add(sceneryMesh);
  }

  // Clouds, merged into one slowly turning mesh. They are lit like everything
  // else but carry a soft blue-grey emissive, so their shaded undersides stay
  // the pale lavender of a cartoon cloud instead of going grey.
  const clouds = createBatch();
  if (bd.clouds) {
    const c = bd.clouds;
    for (let i = 0; i < c.count; i++) {
      const seed = 5000 + i * 31;
      const a = (i / c.count) * Math.PI * 2 + hash(seed) * 0.6;
      const r = lerp(c.r, hash(seed + 1));
      addCloud(clouds, IDENTITY, Math.cos(a) * r, lerp(c.y, hash(seed + 2)), Math.sin(a) * r,
        lerp(c.size ?? [16, 30], hash(seed + 3)), seed);
    }
  }
  if (bd.cloudSea) {
    // A floor of cloud for arenas that float: a jittered grid of big puffs
    // over a flat white underlay that hides the gaps between them.
    const cs = bd.cloudSea;
    const step = cs.size * 1.5;
    let k = 0;
    for (let gx = -cs.r; gx <= cs.r; gx += step) {
      for (let gz = -cs.r; gz <= cs.r; gz += step) {
        const seed = 9000 + k++ * 13;
        const x = gx + (hash(seed) - 0.5) * step * 0.8;
        const z = gz + (hash(seed + 1) - 0.5) * step * 0.8;
        if (Math.hypot(x, z) > cs.r) continue;
        addCloud(clouds, IDENTITY, x, cs.y + (hash(seed + 2) - 0.5) * 3, z,
          cs.size * (0.8 + hash(seed + 3) * 0.5), seed);
      }
    }
    const underlay = new THREE.Mesh(
      own(new THREE.CircleGeometry(SKY_RADIUS, 64)),
      own(new THREE.MeshBasicMaterial({ color: sky.bottom ?? 0xffffff, fog: false })),
    );
    underlay.rotation.x = -Math.PI / 2;
    underlay.position.y = cs.y - 2;
    group.add(underlay);
  }
  const cloudMat = own(new THREE.MeshLambertMaterial({
    vertexColors: true, emissive: 0x7d8fb0, fog: false,
  }));
  const cloudMesh = batchMesh(clouds, cloudMat, { castShadow: false, receiveShadow: false });
  const drift = new THREE.Group();
  if (cloudMesh) {
    own(cloudMesh.geometry);
    drift.add(cloudMesh);
  }
  group.add(drift);

  return {
    group,
    update(dt) {
      // A full turn takes half an hour: you only notice the sky is alive.
      drift.rotation.y += dt * 0.0035;
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      disposables.length = 0;
    },
  };
}
