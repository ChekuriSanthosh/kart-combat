/**
 * Material and texture factory. Everything is procedural so the game ships
 * with no image assets, and the palette leans bright and flat to match the
 * chunky cartoon look of the game we are imitating.
 */

import * as THREE from 'three';

const canvasTex = (size, paint, repeat = 1) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
};

export function sandTexture(base = '#e0be7e') {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const r = 1 + Math.random() * 3.2;
      const shade = 200 + Math.floor(Math.random() * 45);
      ctx.fillStyle = `rgba(${shade},${shade - 30},${shade - 80},0.5)`;
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 18; i++) {
      ctx.strokeStyle = 'rgba(150,115,70,0.25)';
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, 20 + Math.random() * 70, 0, Math.PI * 1.4);
      ctx.stroke();
    }
  }, 14);
}

export function gridTexture(base = '#151a3a', line = '#00e5ff', repeat = 10) {
  return canvasTex(128, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = line;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, s - 4, s - 4);
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 2;
    for (let i = s / 4; i < s; i += s / 4) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
  }, repeat);
}

export function stripeTexture(a = '#ff3355', b = '#ffffff', repeat = 6) {
  return canvasTex(64, (ctx, s) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = b;
    for (let i = 0; i < s; i += s / 4) ctx.fillRect(i, 0, s / 8, s);
  }, repeat);
}

export function treadTexture() {
  return canvasTex(64, (ctx, s) => {
    ctx.fillStyle = '#1c1c22';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#2e2e38';
    for (let i = 0; i < s; i += 10) ctx.fillRect(i, 0, 5, s);
  }, 2);
}

/**
 * A palette-driven material cache. Solids reference materials by name so the
 * blueprint stays free of rendering concerns.
 */
export function createMaterialLibrary(theme) {
  const palette = theme.palette || {};
  const cache = new Map();
  const disposables = [];

  const track = (x) => { disposables.push(x); return x; };

  function base(name) {
    const color = palette[name] ?? 0xcccccc;
    switch (name) {
      case 'sand':
        return new THREE.MeshStandardMaterial({
          color, map: track(sandTexture()), roughness: 1, metalness: 0,
        });
      case 'tyre':
        return new THREE.MeshStandardMaterial({
          color, map: track(treadTexture()), roughness: 0.95, metalness: 0,
        });
      case 'barrier':
        return new THREE.MeshStandardMaterial({
          color: 0xffffff, map: track(stripeTexture('#e8413c', '#f7f7f7', 3)),
          roughness: 0.6, metalness: 0.05,
        });
      case 'rail':
      case 'bumper':
        return new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.65, roughness: 0.3, metalness: 0.2,
        });
      case 'rampNeon':
        return new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.25,
        });
      case 'deck':
      case 'island':
      case 'bridge':
        return new THREE.MeshStandardMaterial({
          color,
          map: track(gridTexture(`#${color.toString(16).padStart(6, '0')}`, `#${(theme.accent ?? 0x00e5ff).toString(16).padStart(6, '0')}`, 6)),
          roughness: 0.55, metalness: 0.25,
          emissive: theme.accent ?? 0x00e5ff, emissiveIntensity: 0.05,
        });
      case 'metal':
        return new THREE.MeshStandardMaterial({
          color, roughness: 0.35, metalness: 0.65,
          emissive: color, emissiveIntensity: 0.18,
        });
      case 'rim':
        return new THREE.MeshStandardMaterial({
          color, roughness: 0.4, metalness: 0.35,
          emissive: color, emissiveIntensity: 0.3,
        });
      case 'dishCore':
      case 'dishA':
      case 'dishB':
        return new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.55 });
      default:
        return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
    }
  }

  return {
    get(name) {
      let m = cache.get(name);
      if (!m) {
        m = track(base(name));
        cache.set(name, m);
      }
      return m;
    },
    make(opts) {
      return track(new THREE.MeshStandardMaterial(opts));
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      disposables.length = 0;
      cache.clear();
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
