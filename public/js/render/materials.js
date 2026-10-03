/**
 * The toy material kit.
 *
 * Every arena surface is a flat-coloured Lambert material: no textures, no
 * roughness or metalness, no emissive glow. What gives the floors their
 * character is one shared pattern, drawn in the shader from the fragment's
 * position rather than from a texture:
 *
 *   checker  two tones of one hue ~6% lightness apart in 2.5 m squares, laid
 *            out in WORLD space so the squares are the same size on every
 *            surface and line up across separate pieces (a deck's top
 *            continues the grid of the ground beside it). Only upward-facing
 *            surfaces get it; walls and the sides of platforms stay flat, the
 *            way the original's do.
 *   stripes  bands across a ramp's local climb axis, so a ramp reads as a
 *            ramp from any distance.
 *   polar    wedges × rings in the mesh's own space, for the spinning dish:
 *            a world-space pattern would stand still while the floor turned
 *            under it, and the rotation would be invisible.
 *
 * The checker and stripes are box-filtered with fwidth, so a floor stretching
 * to the horizon fades to its average colour instead of crawling with moiré.
 */

import * as THREE from 'three';

/** World size of one floor checker square, in metres. */
export const CHECKER_SIZE = 2.5;
/** Default lightness step between the two checker tones (HSL, sRGB). */
export const CHECKER_STEP = -0.055;

const PATTERN = { checker: 1, stripes: 2, polar: 3 };

/** `hex` with its HSL lightness (and optionally saturation) nudged, in sRGB. */
export function shade(hex, dl, ds = 0) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(
    hsl.h,
    THREE.MathUtils.clamp(hsl.s + ds, 0, 1),
    THREE.MathUtils.clamp(hsl.l + dl, 0, 1),
    THREE.SRGBColorSpace,
  );
  return c.getHex();
}

const PATTERN_VERTEX_HEAD = /* glsl */ `
varying vec3 vKcPos;
varying vec3 vKcNormal;
`;

// After project_vertex both `transformed` and `objectNormal` exist, whatever
// else the material has switched on.
const PATTERN_VERTEX_BODY = /* glsl */ `
{
  vec4 kcP = vec4( transformed, 1.0 );
  vec3 kcN = objectNormal;
  #ifndef KC_LOCAL
    #ifdef USE_INSTANCING
      kcP = instanceMatrix * kcP;
      kcN = mat3( instanceMatrix ) * kcN;
    #endif
    kcP = modelMatrix * kcP;
    kcN = mat3( modelMatrix ) * kcN;
  #endif
  vKcPos = kcP.xyz;
  vKcNormal = kcN;
}
`;

const PATTERN_FRAGMENT_HEAD = /* glsl */ `
varying vec3 vKcPos;
varying vec3 vKcNormal;
uniform vec3 uKcTint;
uniform float uKcSize;
uniform float uKcWedges;

// Box-filtered square wave: +1 / -1 in alternate cells, blended across the
// footprint of one pixel so distant cells average out instead of aliasing.
vec2 kcSquare( vec2 p ) {
  vec2 w = fwidth( p ) + 1e-4;
  return 2.0 * ( abs( fract( ( p - 0.5 * w ) * 0.5 ) - 0.5 )
               - abs( fract( ( p + 0.5 * w ) * 0.5 ) - 0.5 ) ) / w;
}
`;

const PATTERN_FRAGMENT_BODY = /* glsl */ `
{
  // Only faces that point up are floors. Derived from the interpolated normal,
  // so a rounded edge fades between the two rather than cutting hard.
  float kcUp = smoothstep( 0.45, 0.75, normalize( vKcNormal ).y );
  #if KC_PATTERN == 1
    vec2 kcI = kcSquare( vKcPos.xz / uKcSize );
    float kcK = 0.5 - 0.5 * kcI.x * kcI.y;
  #elif KC_PATTERN == 2
    float kcK = 0.5 - 0.5 * kcSquare( vec2( vKcPos.z / uKcSize, 0.0 ) ).x;
  #else
    // Wedges are hard-edged: the angle wraps at ±π, and a filter width taken
    // across that seam would smear a line along it. The two tones are close
    // enough that the missing filtering does not show.
    float kcR = floor( length( vKcPos.xz ) / uKcSize );
    float kcA = floor( ( atan( vKcPos.z, vKcPos.x ) / 6.2831853 + 0.5 ) * uKcWedges );
    float kcK = mod( kcR + kcA, 2.0 );
  #endif
  // A multiplier rather than a second colour, so the same pattern also works
  // on vertex-coloured batches where every part has its own base colour.
  diffuseColor.rgb *= mix( vec3( 1.0 ), uKcTint, kcK * kcUp );
}
`;

/**
 * Adds a procedural floor pattern to a Lambert material (in place).
 *
 *   mode    'checker' | 'stripes' | 'polar'
 *   alt     second tone, sRGB hex
 *   base    the colour `alt` is relative to (defaults to the material's);
 *           the shader multiplies by alt/base, so on a vertex-coloured
 *           material every part keeps its own hue and just darkens or
 *           lightens by the same ratio
 *   size    cell / stripe / ring width in metres
 *   wedges  polar only: wedge count around the circle
 *   local   use the mesh's own space instead of world space (forced for
 *           stripes and polar, which follow their mesh)
 */
export function addPattern(material, {
  mode = 'checker', alt, base, size = CHECKER_SIZE, wedges = 24, local = false,
}) {
  const kind = PATTERN[mode] ?? PATTERN.checker;
  const inLocal = local || kind !== PATTERN.checker;
  // Ratio in linear space, which is where the shader works.
  const from = base !== undefined ? new THREE.Color(base) : material.color.clone();
  const to = new THREE.Color(alt);
  const ratio = (a, b) => (a > 1e-4 ? b / a : 1);
  const uniforms = {
    uKcTint: { value: new THREE.Vector3(ratio(from.r, to.r), ratio(from.g, to.g), ratio(from.b, to.b)) },
    uKcSize: { value: size },
    uKcWedges: { value: wedges },
  };
  material.defines = { ...(material.defines || {}), KC_PATTERN: kind };
  if (inLocal) material.defines.KC_LOCAL = 1;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PATTERN_VERTEX_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${PATTERN_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PATTERN_FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PATTERN_FRAGMENT_BODY}`);
  };
  // Every patterned material compiles the same source; only the defines
  // differ, and three already keys programs on those.
  material.customProgramCacheKey = () => `kc-pattern-${kind}-${inLocal ? 1 : 0}`;
  material.userData.pattern = uniforms;
  return material;
}

/**
 * A palette entry is either a plain colour or a spec:
 *   { color, checker?: true | lightnessStep, stripe?: hex, stripeWidth?,
 *     polar?: true | lightnessStep, wedges?, opacity?, emissive?, vertexColors? }
 * plus render hints MapBuilder reads off the same entry (round, studs,
 * boulder, bale, ring, stripes, kerb, glass — see buildSolid).
 * Returns a ready material. Anything left out is a flat Lambert colour.
 */
export function toyMaterial(spec) {
  const s = typeof spec === 'object' && spec !== null ? spec : { color: spec ?? 0xcccccc };
  const mat = new THREE.MeshLambertMaterial({
    color: s.color,
    emissive: s.emissive ?? 0x000000,
    transparent: s.opacity !== undefined && s.opacity < 1,
    opacity: s.opacity ?? 1,
    side: s.side ?? THREE.FrontSide,
    vertexColors: !!s.vertexColors,
  });
  if (s.checker) {
    const step = s.checker === true ? CHECKER_STEP : s.checker;
    addPattern(mat, { mode: 'checker', alt: shade(s.color, step), size: s.size ?? CHECKER_SIZE });
  } else if (s.stripe !== undefined) {
    addPattern(mat, { mode: 'stripes', alt: s.stripe, size: s.stripeWidth ?? 1.1 });
  } else if (s.polar) {
    const step = s.polar === true ? CHECKER_STEP : s.polar;
    addPattern(mat, { mode: 'polar', alt: shade(s.color, step), size: s.size ?? 2, wedges: s.wedges ?? 24 });
  }
  return mat;
}

/**
 * A palette-driven material cache. Solids reference materials by name so the
 * blueprint stays free of rendering concerns.
 */
export function createMaterialLibrary(theme) {
  const palette = theme.palette || {};
  const cache = new Map();
  const flats = new Map();
  const disposables = [];

  const track = (x) => { disposables.push(x); return x; };

  return {
    /** The material for a palette name (a solid's `mat`). */
    get(name) {
      let m = cache.get(name);
      if (!m) {
        m = track(toyMaterial(palette[name] ?? 0xcccccc));
        cache.set(name, m);
      }
      return m;
    },
    /** The palette entry's base colour as a hex, whatever shape it has. */
    color(name) {
      const p = palette[name];
      return typeof p === 'object' && p !== null ? p.color : (p ?? 0xcccccc);
    },
    /** A shared flat Lambert material per colour (and side). */
    flat(color, side = THREE.FrontSide) {
      const key = `${color}:${side}`;
      let m = flats.get(key);
      if (!m) {
        m = track(new THREE.MeshLambertMaterial({ color, side }));
        flats.set(key, m);
      }
      return m;
    },
    /** One-off material from a palette-style spec (see toyMaterial). */
    make(spec) {
      return track(toyMaterial(spec));
    },
    /** One-off material from raw Lambert options. */
    lambert(opts) {
      return track(new THREE.MeshLambertMaterial(opts));
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      disposables.length = 0;
      cache.clear();
      flats.clear();
    },
  };
}

/** Frees every geometry, material and texture beneath a root object. */
export function disposeTree(root) {
  root?.traverse?.((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      m.map?.dispose?.();
      m.dispose?.();
    }
  });
}
