/**
 * Renderer look and the toy-box light rig.
 *
 * styleRenderer is the single place colour space, tone mapping and the shadow
 * filter are chosen, so the game, menu previews and any future scene agree on
 * how a colour on a material ends up on screen. createToyLights is the bright,
 * even rig the cartoon look wants: a big sky/ground fill so nothing goes
 * black, one sun for soft shadows (shadows are most of what makes flat
 * colours read as solid toys), and a weak cool fill from the other side.
 */

import * as THREE from 'three';

/*
 * Tuning table.
 *
 * There is no tone mapping (see styleRenderer), so these numbers are the whole
 * story of how bright a surface ends up. In three r155+ a Lambert surface
 * shows   albedo / π × (hemisphere + Σ sun·cosθ)   — so a light total of π
 * reproduces a material's colour exactly. The rig is built around that:
 *
 *   floor in sunlight   hemi + sun·sin(58°) + fill·sin(35°)  ≈ 1.04 π
 *   floor in shadow     hemi + fill·sin(35°)                 ≈ 0.63 π
 *
 * so a palette hex is what the player sees on a lit floor, and a shadow is the
 * same hue at ~80% sRGB brightness — a darker tint of the surface, never the
 * near-black pool ACES and a dim sky produced. Walls get half the sky and the
 * low-angle part of the sun, which keeps them a step darker than floors (that
 * contrast is what makes a box read as a box) without going muddy.
 */
const TOY = {
  hemi: { sky: 0xf4f8ff, ground: 0xe6dccb, intensity: 1.8 },
  sun: { color: 0xfff6e6, intensity: 1.55 },
  fill: { color: 0xdbe9ff, intensity: 0.32 },
  // Directions are from the target towards the light. The sun is high (58°)
  // and off to one side so karts throw a short, readable shadow beside
  // themselves rather than a long streak, and both faces of a wall the camera
  // sees from the arena's centre stay lit.
  sunDir: [0.42, 0.85, 0.32],
  fillDir: [-0.62, 0.57, -0.54],
  // Turntable previews: the key light sits front-right and the fill becomes a
  // cool rim from behind so the silhouette separates from the backdrop.
  previewSunDir: [0.43, 0.75, 0.53],
  previewFillDir: [-0.69, 0.42, -0.56],
  previewFillIntensity: 0.9,
};

/** Colour pipeline and shadow quality for a WebGLRenderer. Returns it. */
export function styleRenderer(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // No tone mapping: every filmic curve (ACES especially) pulls saturated
  // primaries toward grey and rolls the highlights off, which is the exact
  // opposite of the flat toy palette. The light rig is balanced so nothing
  // lit by it needs compressing in the first place.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  return renderer;
}

/**
 * Hemisphere + shadow-casting sun + soft fill, in one group to add to a scene.
 *
 *   shadowSize  half-width in metres of the square the sun casts shadows over
 *               (an arena's radius, or about 3 for a single kart)
 *   target      [x, y, z] the sun and fill aim at, and the shadow box centre
 *   preview     tuned for a turntable: rim fill, smaller shadow map
 *   bounce      optional hemisphere ground colour: the light bounced up off
 *               the floor, so a lime field tints the undersides of things
 *               green and a sand pit warms them (defaults to warm off-white)
 *
 * The lights are also on group.userData ({ hemi, sun, fill }) for tuning.
 */
export function createToyLights(opts = {}) {
  const preview = !!opts.preview;
  const size = opts.shadowSize ?? (preview ? 3 : 50);
  const [tx, ty, tz] = opts.target ?? [0, 0, 0];

  const group = new THREE.Group();
  group.name = 'toy-lights';

  const hemi = new THREE.HemisphereLight(TOY.hemi.sky, opts.bounce ?? TOY.hemi.ground, TOY.hemi.intensity);
  group.add(hemi);

  // Far enough out that the whole shadow box sits in front of the light, but
  // no further, since every extra metre of depth range costs shadow precision.
  const distance = size * 2 + 20;
  const sun = new THREE.DirectionalLight(TOY.sun.color, TOY.sun.intensity);
  const sunDir = new THREE.Vector3(...(preview ? TOY.previewSunDir : TOY.sunDir)).normalize();
  sun.position.set(tx, ty, tz).addScaledVector(sunDir, distance);
  sun.target.position.set(tx, ty, tz);
  sun.castShadow = true;
  const cam = sun.shadow.camera;
  cam.left = -size;
  cam.right = size;
  cam.top = size;
  cam.bottom = -size;
  cam.near = Math.max(0.5, distance - size * 2);
  cam.far = distance + size * 2;
  // Three reads the shadow camera's projectionMatrix directly, so changing
  // the frustum without this leaves shadows in the default ±5 m patch.
  cam.updateProjectionMatrix();
  // One 2048 map stretched over a whole arena is ~5 cm a texel: crisp enough
  // for a kart's shadow, and PCF soft filtering blurs the edge by a couple of
  // texels, which is the soft-edged cartoon shadow rather than a hard cut-out.
  const mapSize = preview ? 1024 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun);
  // A directional light aims at its target's world position, which is only
  // kept up to date while the target is in the scene graph.
  group.add(sun.target);

  const fill = new THREE.DirectionalLight(
    TOY.fill.color,
    preview ? TOY.previewFillIntensity : TOY.fill.intensity,
  );
  const fillDir = new THREE.Vector3(...(preview ? TOY.previewFillDir : TOY.fillDir)).normalize();
  fill.position.set(tx, ty, tz).addScaledVector(fillDir, distance);
  fill.target = sun.target;
  group.add(fill);

  group.userData = { hemi, sun, fill };
  return group;
}
