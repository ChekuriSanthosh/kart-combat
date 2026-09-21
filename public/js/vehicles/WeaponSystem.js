/**
 * WeaponSystem.js — mystery boxes + all power-ups (meshes + logic).
 * Pass global CDN THREE: createWeaponSystem(THREE, { scene, onEvent }).
 *
 * Classic (16): rocket, tripleRocket, machineGun, snowballBlaster, nuke,
 *   grenade, cannonball, spikeyGoRound, invincibilityStar, shield,
 *   proximityMine, tntBomb, oilSlick, shrinkRay, repairKit (+55 HP), speedBoost
 * Custom (5): gravityAnchor, beybladeWhirlwind, blackHoleGrenade,
 *   shockwaveRing, portalTether
 *
 * AABB collision for mystery-box pickup, projectile hits, HP updates, respawns.
 */

export const MAX_HP = 100;
export const REPAIR_HEAL = 55;

export const WEAPON_DEFS = Object.freeze({
  rocket: {
    id: 'rocket', name: 'Rocket', kind: 'projectile',
    speed: 48, lifetime: 4.5, radius: 0.55, damage: 28, homing: 0.35,
    color: 0xff4422, mesh: 'rocket',
  },
  tripleRocket: {
    id: 'tripleRocket', name: 'Triple Rocket', kind: 'burst',
    count: 3, spreadDeg: 18, ref: 'rocket',
  },
  machineGun: {
    id: 'machineGun', name: 'Machine Gun', kind: 'stream',
    speed: 70, lifetime: 1.2, radius: 0.18, damage: 4,
    fireRate: 0.08, duration: 1.6, color: 0xffd966, mesh: 'bullet',
  },
  snowballBlaster: {
    id: 'snowballBlaster', name: 'Snowball Blaster', kind: 'projectile',
    speed: 36, lifetime: 3.5, radius: 0.5, damage: 8,
    status: { type: 'frozen', duration: 2.2 },
    color: 0xa8e6ff, mesh: 'snowball',
  },
  nuke: {
    id: 'nuke', name: 'Nuke', kind: 'aoe',
    radius: 28, damage: 55, status: { type: 'stun', duration: 1.6 },
    color: 0xffee55, mesh: 'nukeFlash',
  },
  grenade: {
    id: 'grenade', name: 'Grenade', kind: 'lobbed',
    speed: 22, upSpeed: 14, lifetime: 2.4, radius: 1.4, damage: 32,
    bounce: 0.35, color: 0x2ecc71, mesh: 'grenade',
  },
  cannonball: {
    id: 'cannonball', name: 'Cannonball', kind: 'lobbed',
    speed: 28, upSpeed: 6, lifetime: 3.5, radius: 0.7, damage: 40,
    bounce: 0.15, color: 0x333333, mesh: 'cannonball',
  },
  spikeyGoRound: {
    id: 'spikeyGoRound', name: 'Spikey-Go-Round', kind: 'orbit',
    count: 4, orbitRadius: 2.2, orbitSpeed: 4.5, lifetime: 6,
    radius: 0.45, damage: 16, color: 0xbbbbbb, mesh: 'spikeBall',
  },
  invincibilityStar: {
    id: 'invincibilityStar', name: 'Invincibility Star', kind: 'instant',
    status: { type: 'invincible', duration: 5 },
    color: 0xffe566, mesh: 'star',
  },
  shield: {
    id: 'shield', name: 'Shield', kind: 'instant',
    status: { type: 'shield', duration: 6 },
    color: 0x55ccff, mesh: 'shield',
  },
  proximityMine: {
    id: 'proximityMine', name: 'Proximity Mine', kind: 'mine',
    armTime: 0.6, triggerRadius: 2.8, radius: 0.5, damage: 38,
    lifetime: 25, color: 0xcc2222, mesh: 'mine',
  },
  tntBomb: {
    id: 'tntBomb', name: 'TNT Bomb', kind: 'lobbed',
    speed: 18, upSpeed: 12, lifetime: 2.8, radius: 2.2, damage: 48,
    fuse: 2.0, color: 0xe74c3c, mesh: 'tnt',
  },
  oilSlick: {
    id: 'oilSlick', name: 'Oil Slick', kind: 'hazard',
    lifetime: 16, radius: 1.6, damage: 0,
    status: { type: 'spinOut', duration: 1.4 },
    color: 0x1a1a1a, mesh: 'oil',
  },
  shrinkRay: {
    id: 'shrinkRay', name: 'Shrink Ray', kind: 'projectile',
    speed: 40, lifetime: 2.5, radius: 0.35, damage: 5,
    status: { type: 'shrunk', duration: 4.5, magnitude: 0.45 },
    color: 0xbb66ff, mesh: 'shrinkBeam',
  },
  repairKit: {
    id: 'repairKit', name: 'Repair Kit', kind: 'instant',
    heal: REPAIR_HEAL, color: 0x2ecc71, mesh: 'repair',
  },
  speedBoost: {
    id: 'speedBoost', name: 'Speed Boost', kind: 'instant',
    status: { type: 'boost', duration: 1.8, magnitude: 1.55 },
    color: 0x3498db, mesh: 'boost',
  },
  gravityAnchor: {
    id: 'gravityAnchor', name: 'Gravity Anchor', kind: 'instant',
    status: { type: 'gravityAnchor', duration: 5 },
    color: 0x7f8c8d, mesh: 'anchor',
  },
  beybladeWhirlwind: {
    id: 'beybladeWhirlwind', name: 'Beyblade Whirlwind', kind: 'instant',
    status: { type: 'beyblade', duration: 4.5, magnitude: 2.5 },
    color: 0xe67e22, mesh: 'whirl',
  },
  blackHoleGrenade: {
    id: 'blackHoleGrenade', name: 'Black Hole Grenade', kind: 'lobbed',
    speed: 16, upSpeed: 11, lifetime: 1.6, radius: 0.6, damage: 10,
    spawnField: {
      type: 'blackHole', duration: 3.5, pullRadius: 14, pullStrength: 55, damagePerSec: 6,
    },
    color: 0x2c0033, mesh: 'blackHoleNade',
  },
  shockwaveRing: {
    id: 'shockwaveRing', name: 'Shockwave Ring', kind: 'instant',
    status: { type: 'shockwave', duration: 3.5 },
    deflectRadius: 3.2, color: 0x00e5ff, mesh: 'shockwave',
  },
  portalTether: {
    id: 'portalTether', name: 'Portal Tether', kind: 'portal',
    lifetime: 8, radius: 1.2, color: 0x9b59b6, mesh: 'portal',
  },
});

export const CLASSIC_IDS = Object.freeze([
  'rocket', 'tripleRocket', 'machineGun', 'snowballBlaster', 'nuke',
  'grenade', 'cannonball', 'spikeyGoRound', 'invincibilityStar', 'shield',
  'proximityMine', 'tntBomb', 'oilSlick', 'shrinkRay', 'repairKit', 'speedBoost',
]);
export const CUSTOM_IDS = Object.freeze([
  'gravityAnchor', 'beybladeWhirlwind', 'blackHoleGrenade', 'shockwaveRing', 'portalTether',
]);
export const ALL_WEAPON_IDS = Object.freeze([...CLASSIC_IDS, ...CUSTOM_IDS]);

let _seq = 1;
const uid = (p = 'w') => `${p}_${_seq++}`;

function aabbHit(a, b) {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX &&
    a.minY <= b.maxY && a.maxY >= b.minY &&
    a.minZ <= b.maxZ && a.maxZ >= b.minZ
  );
}

function fixSphereAabb(x, y, z, r) {
  return {
    minX: x - r, maxX: x + r,
    minY: y - r, maxY: y + r,
    minZ: z - r, maxZ: z + r,
  };
}

function kartAabb(kart) {
  const x = kart.x ?? kart.position?.x ?? 0;
  const y = kart.y ?? kart.position?.y ?? 0.5;
  const z = kart.z ?? kart.position?.z ?? 0;
  const hx = kart.halfW ?? 1.0;
  const hy = kart.halfH ?? 0.75;
  const hz = kart.halfL ?? 1.15;
  return {
    minX: x - hx, maxX: x + hx,
    minY: y - hy, maxY: y + hy,
    minZ: z - hz, maxZ: z + hz,
  };
}

function entAabb(e) {
  return fixSphereAabb(e.x, e.y ?? 0.4, e.z, e.radius ?? 0.5);
}

function disposeObject(root) {
  root?.traverse?.((o) => {
    o.geometry?.dispose?.();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
      else o.material.dispose?.();
    }
  });
}

function mat(THREE, color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.3,
    roughness: opts.roughness ?? 0.45,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
  });
}

/** Build a low-poly mesh for a weapon / VFX kind. */
export function createWeaponMesh(THREE, kind, color = 0xffffff) {
  const g = new THREE.Group();
  g.name = `wpn:${kind}`;

  const add = (...meshes) => { for (const m of meshes) g.add(m); };

  switch (kind) {
    case 'rocket': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.7, 8), mat(THREE, color, { metalness: 0.6 }));
      body.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 8), mat(THREE, 0xffaa00, { emissive: 0xff4400, emissiveIntensity: 0.4 }));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.5;
      add(body, tip);
      break;
    }
    case 'bullet':
      add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), mat(THREE, color, { emissive: color, emissiveIntensity: 0.5 })));
      break;
    case 'snowball':
      add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 10), mat(THREE, color, { roughness: 0.9 })));
      break;
    case 'nukeFlash':
      add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), mat(THREE, color, { emissive: 0xffaa00, emissiveIntensity: 1, transparent: true, opacity: 0.85 })));
      break;
    case 'grenade': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), mat(THREE, color));
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6), mat(THREE, 0xcccccc, { metalness: 0.8 }));
      pin.position.y = 0.28;
      add(body, pin);
      break;
    }
    case 'cannonball':
      add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), mat(THREE, color, { metalness: 0.85, roughness: 0.35 })));
      break;
    case 'spikeBall': {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), mat(THREE, 0x555555, { metalness: 0.7 }));
      add(core);
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 5), mat(THREE, color, { metalness: 0.7 }));
        const a = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.28, Math.sin(a * 1.3) * 0.1, Math.sin(a) * 0.28);
        spike.lookAt(0, 0, 0);
        add(spike);
      }
      break;
    }
    case 'star':
      add(new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), mat(THREE, color, { emissive: color, emissiveIntensity: 0.6 })));
      break;
    case 'shield':
      add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), mat(THREE, color, { transparent: true, opacity: 0.28, emissive: color, emissiveIntensity: 0.25 })));
      break;
    case 'mine': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.18, 10), mat(THREE, color));
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), mat(THREE, 0xff0000, { emissive: 0xff0000, emissiveIntensity: 1 }));
      light.position.y = 0.14;
      add(body, light);
      break;
    }
    case 'tnt':
      add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.55), mat(THREE, color)));
      break;
    case 'oil': {
      const slick = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20), mat(THREE, color, { transparent: true, opacity: 0.75, roughness: 0.2 }));
      slick.rotation.x = -Math.PI / 2;
      add(slick);
      break;
    }
    case 'shrinkBeam': {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.6, 8), mat(THREE, color, { emissive: color, emissiveIntensity: 0.5 }));
      beam.rotation.x = Math.PI / 2;
      add(beam);
      break;
    }
    case 'repair': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.4), mat(THREE, color));
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.12), mat(THREE, 0xffffff));
      cross.position.y = 0.2;
      add(box, cross);
      break;
    }
    case 'boost': {
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.55, 8), mat(THREE, color, { emissive: color, emissiveIntensity: 0.4 }));
      arrow.rotation.x = Math.PI / 2;
      add(arrow);
      break;
    }
    case 'anchor': {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 6), mat(THREE, color, { metalness: 0.8 }));
      const fluke = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 6, 12, Math.PI), mat(THREE, color, { metalness: 0.8 }));
      fluke.position.y = -0.35;
      fluke.rotation.x = Math.PI;
      add(shaft, fluke);
      break;
    }
    case 'whirl': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 16), mat(THREE, color, { emissive: color, emissiveIntensity: 0.35 }));
      ring.rotation.x = Math.PI / 2;
      add(ring);
      break;
    }
    case 'blackHoleNade':
      add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), mat(THREE, color, { emissive: 0x6600aa, emissiveIntensity: 0.5 })));
      break;
    case 'blackHoleField': {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), mat(THREE, 0x110011, { emissive: 0x5500aa, emissiveIntensity: 0.8 }));
      const disk = new THREE.Mesh(new THREE.RingGeometry(0.8, 2.4, 32), mat(THREE, 0x8800cc, { transparent: true, opacity: 0.45, emissive: 0x6600aa, emissiveIntensity: 0.4 }));
      disk.rotation.x = -Math.PI / 2;
      add(core, disk);
      break;
    }
    case 'shockwave': {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 24), mat(THREE, color, { transparent: true, opacity: 0.55, emissive: color, emissiveIntensity: 0.4 }));
      ring.rotation.x = -Math.PI / 2;
      add(ring);
      break;
    }
    case 'portal': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 8, 24), mat(THREE, color, { emissive: color, emissiveIntensity: 0.6 }));
      const swirl = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), mat(THREE, 0x1a0033, { transparent: true, opacity: 0.7, emissive: 0x440066, emissiveIntensity: 0.3 }));
      add(ring, swirl);
      break;
    }
    case 'iceBlock': {
      const block = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.6, 2.4), mat(THREE, 0xa8e6ff, { transparent: true, opacity: 0.55, roughness: 0.15 }));
      block.position.y = 0.8;
      add(block);
      break;
    }
    case 'mysteryBox': {
      // Smash Karts–style wrapped gift / ? present
      const wrap = mat(THREE, color || 0xff3b5c, { emissive: color || 0xff3b5c, emissiveIntensity: 0.25, roughness: 0.55 });
      const ribbon = mat(THREE, 0xffe66d, { emissive: 0xffcc33, emissiveIntensity: 0.45, metalness: 0.35, roughness: 0.4 });
      const lidMat = mat(THREE, 0xff6b81, { emissive: 0xff4757, emissiveIntensity: 0.2, roughness: 0.5 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.85, 1.05), wrap);
      body.position.y = 0.42;

      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.22, 1.14), lidMat);
      lid.position.y = 0.95;
      lid.name = 'giftLid';

      // Ribbon cross (vertical bands)
      const bandZ = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 1.08), ribbon);
      bandZ.position.y = 0.45;
      const bandX = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.9, 0.22), ribbon);
      bandX.position.y = 0.45;
      // Lid ribbon
      const lidBandZ = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 1.16), ribbon);
      lidBandZ.position.y = 0.95;
      const lidBandX = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.24, 0.22), ribbon);
      lidBandX.position.y = 0.95;

      // Bow (two loops + knot)
      const bowL = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.055, 6, 10), ribbon);
      bowL.position.set(-0.18, 1.18, 0);
      bowL.rotation.y = Math.PI / 2;
      bowL.scale.set(1, 0.7, 1);
      const bowR = bowL.clone();
      bowR.position.x = 0.18;
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), ribbon);
      knot.position.y = 1.16;

      // Bright "?" billboard card on top for distance read
      const qCard = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.35, 0.06),
        mat(THREE, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.35 }),
      );
      qCard.position.y = 1.45;

      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 12, 10),
        mat(THREE, 0xffeaa7, { transparent: true, opacity: 0.18, emissive: 0xffc107, emissiveIntensity: 0.5 }),
      );
      glow.position.y = 0.55;
      glow.name = 'giftGlow';

      add(body, lid, bandZ, bandX, lidBandZ, lidBandX, bowL, bowR, knot, qCard, glow);
      g.userData.isGiftBox = true;
      break;
    }
    default:
      add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), mat(THREE, color)));
  }

  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

export function createMysteryBoxMesh(THREE, color = 0xff3b5c) {
  return createWeaponMesh(THREE, 'mysteryBox', color);
}

/** Palette for variety across the track */
export const GIFT_COLORS = Object.freeze([
  0xff3b5c, // hot pink-red
  0x4ecdc4, // teal
  0xa55eea, // purple
  0x45aaf2, // blue
  0xfebf2f, // gold
  0x26de81, // green
]);

export function createIceBlockMesh(THREE) {
  return createWeaponMesh(THREE, 'iceBlock', 0xa8e6ff);
}

/**
 * @param {typeof globalThis.THREE} THREE
 * @param {{ scene?: object, onEvent?: (e: object) => void, boxRespawnSec?: number }} [opts]
 */
export function createWeaponSystem(THREE, opts = {}) {
  const scene = opts.scene || null;
  const onEvent = opts.onEvent || (() => {});
  const boxRespawnSec = opts.boxRespawnSec ?? 5;

  const projectiles = [];
  const hazards = [];
  const fields = [];
  const mysteryBoxes = [];
  const orbiters = [];
  /** @type {Map<string, object[]>} */
  const effects = new Map();
  /** @type {Map<string, object>} */
  const iceBlocks = new Map();
  /** @type {Map<string, object>} */
  const auras = new Map();
  /** @type {Map<string, string|null>} */
  const inventory = new Map();

  function getEffects(kartId) {
    if (!effects.has(kartId)) effects.set(kartId, []);
    return effects.get(kartId);
  }

  function hasStatus(kartId, type) {
    return getEffects(kartId).some((e) => e.type === type && e.remaining > 0);
  }

  function isInvulnerable(kartId) {
    return hasStatus(kartId, 'invincible') || hasStatus(kartId, 'shield');
  }

  function applyStatus(kartId, status, karts = []) {
    if (!status) return;
    const list = getEffects(kartId);
    const existing = list.find((e) => e.type === status.type);
    const dur = status.duration ?? status.remaining ?? 1;
    if (existing) {
      existing.remaining = Math.max(existing.remaining, dur);
      existing.magnitude = status.magnitude ?? existing.magnitude;
      existing.data = status.data ?? existing.data;
    } else {
      list.push({
        type: status.type,
        remaining: dur,
        magnitude: status.magnitude ?? 1,
        data: status.data || null,
      });
    }
    if (status.type === 'frozen') attachIce(kartId, karts);
    if (status.type === 'shield' || status.type === 'shockwave' || status.type === 'invincible') {
      attachAura(kartId, status.type);
    }
  }

  function attachIce(kartId, karts) {
    if (iceBlocks.has(kartId) || !scene) return;
    const mesh = createIceBlockMesh(THREE);
    const kart = (karts || []).find((k) => k.id === kartId);
    if (kart) mesh.position.set(kart.x, kart.y ?? 0, kart.z);
    iceBlocks.set(kartId, mesh);
    scene.add(mesh);
  }

  function detachIce(kartId) {
    const mesh = iceBlocks.get(kartId);
    if (!mesh) return;
    scene?.remove(mesh);
    disposeObject(mesh);
    iceBlocks.delete(kartId);
  }

  function attachAura(kartId, type) {
    const key = `${kartId}:${type}`;
    if (auras.has(key) || !scene) return;
    const kind = type === 'shield' ? 'shield' : type === 'shockwave' ? 'shockwave' : 'star';
    const color = type === 'invincible' ? 0xffe566 : type === 'shockwave' ? 0x00e5ff : 0x55ccff;
    const mesh = createWeaponMesh(THREE, kind, color);
    auras.set(key, mesh);
    scene.add(mesh);
  }

  function detachAura(kartId, type) {
    const key = `${kartId}:${type}`;
    const mesh = auras.get(key);
    if (!mesh) return;
    scene?.remove(mesh);
    disposeObject(mesh);
    auras.delete(key);
  }

  function tickStatus(dt, karts) {
    for (const [kartId, list] of effects) {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].remaining -= dt;
        if (list[i].remaining <= 0) {
          const gone = list.splice(i, 1)[0];
          if (gone.type === 'frozen') detachIce(kartId);
          if (gone.type === 'shield' || gone.type === 'shockwave' || gone.type === 'invincible') {
            detachAura(kartId, gone.type);
          }
        }
      }
    }
    for (const [kartId, mesh] of iceBlocks) {
      const kart = karts.find((k) => k.id === kartId);
      if (kart) mesh.position.set(kart.x, kart.y ?? 0, kart.z);
    }
    for (const [key, mesh] of auras) {
      const kartId = key.split(':')[0];
      const kart = karts.find((k) => k.id === kartId);
      if (kart) {
        mesh.position.set(kart.x, (kart.y ?? 0) + 0.5, kart.z);
        mesh.rotation.y += dt * 2.5;
      }
    }
  }

  /* ── Mystery boxes (interactive gift pickups — WeaponSystem owns these) ── */

  const GIFT_PALETTE = GIFT_COLORS;

  function spawnMysteryBox(x, y = 0, z = 0, color) {
    const c = color ?? GIFT_PALETTE[mysteryBoxes.length % GIFT_PALETTE.length];
    const mesh = createMysteryBoxMesh(THREE, c);
    mesh.position.set(x, y + 0.55, z);
    const box = {
      id: uid('box'),
      x, y: y + 0.55, z,
      baseY: y + 0.55,
      radius: 0.75,
      half: 0.65,
      alive: true,
      respawnAt: 0,
      mesh,
      spin: Math.random() * Math.PI * 2,
      bobPhase: Math.random() * Math.PI * 2,
    };
    mysteryBoxes.push(box);
    scene?.add(mesh);
    return box;
  }

  function spawnMysteryBoxRing(center, count = 8, radius = 18, y = 0) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      out.push(spawnMysteryBox(
        center.x + Math.cos(a) * radius,
        y,
        center.z + Math.sin(a) * radius,
        GIFT_PALETTE[i % GIFT_PALETTE.length],
      ));
    }
    return out;
  }

  /**
   * Consume MapManager.mysteryBoxSpawns — interactive gifts owned here.
   * Maps should NOT also spawn pickup meshes (décor-only ok).
   * @param {{ x:number, y?:number, z:number }[]} spawns
   * @param {{ clear?: boolean }} [opts]
   */
  function syncMysteryBoxSpawns(spawns, opts = {}) {
    if (opts.clear !== false) {
      for (const box of mysteryBoxes) killEntity(box);
      mysteryBoxes.length = 0;
    }
    const out = [];
    for (const s of spawns || []) {
      out.push(spawnMysteryBox(s.x, s.y ?? 0, s.z));
    }
    return out;
  }

  function rollWeapon() {
    return ALL_WEAPON_IDS[Math.floor(Math.random() * ALL_WEAPON_IDS.length)];
  }

  function collectBoxes(karts, now) {
    const events = [];
    const t = now * 0.001;
    for (const box of mysteryBoxes) {
      if (!box.alive) {
        if (box.respawnAt && now >= box.respawnAt) {
          box.alive = true;
          box.respawnAt = 0;
          if (box.mesh) {
            box.mesh.visible = true;
            box.mesh.scale.set(0.01, 0.01, 0.01);
          }
          events.push({ type: 'boxRespawn', boxId: box.id });
        }
        continue;
      }
      // AABB pickup (unchanged logic)
      const bBox = {
        minX: box.x - box.half, maxX: box.x + box.half,
        minY: box.y - box.half, maxY: box.y + box.half + 0.6,
        minZ: box.z - box.half, maxZ: box.z + box.half,
      };
      for (const kart of karts) {
        if (kart.alive === false) continue;
        if (inventory.get(kart.id)) continue;
        if (!aabbHit(kartAabb(kart), bBox)) continue;
        const weaponId = rollWeapon();
        inventory.set(kart.id, weaponId);
        box.alive = false;
        box.respawnAt = now + boxRespawnSec * 1000;
        if (box.mesh) box.mesh.visible = false;
        const def = WEAPON_DEFS[weaponId];
        const ev = {
          type: 'boxCollect',
          boxId: box.id,
          kartId: kart.id,
          weaponId,
          weaponName: def?.name || weaponId,
          juice: { pickup: true, weaponId },
        };
        events.push(ev);
        onEvent(ev);
        break;
      }
    }
    // Gift bob + spin (+ pop-in scale on respawn)
    for (const box of mysteryBoxes) {
      if (!box.mesh) continue;
      if (box.alive) {
        box.spin += 0.025;
        box.mesh.rotation.y = box.spin;
        box.mesh.position.y = box.baseY + Math.sin(t * 2.4 + box.bobPhase) * 0.18;
        // gentle lid idle tip
        const lid = box.mesh.getObjectByName('giftLid');
        if (lid) lid.rotation.z = Math.sin(t * 1.6 + box.bobPhase) * 0.05;
        // ease scale to 1
        const s = box.mesh.scale.x;
        if (s < 0.999) {
          const ns = s + (1 - s) * 0.15;
          box.mesh.scale.set(ns, ns, ns);
        }
      }
    }
    return events;
  }

  /* ── Inventory / fire ── */

  function giveWeapon(kartId, weaponId) {
    inventory.set(kartId, weaponId);
  }

  function getInventory(kartId) {
    return inventory.get(kartId) || null;
  }

  function useWeapon(kartId, origin, ctx = {}) {
    const weaponId = inventory.get(kartId);
    if (!weaponId) return null;
    inventory.set(kartId, null);
    return fire(weaponId, { ...origin, ownerId: kartId }, ctx);
  }

  function fire(weaponId, origin, ctx = {}) {
    const def = WEAPON_DEFS[weaponId];
    if (!def) return null;

    if (def.kind === 'instant') {
      if (def.heal) healKart(origin.ownerId, def.heal, ctx.karts || []);
      if (def.status) applyStatus(origin.ownerId, def.status, ctx.karts || []);
      const ev = { type: 'instant', weaponId, ownerId: origin.ownerId };
      onEvent(ev);
      return ev;
    }

    if (def.kind === 'burst' && def.ref) {
      const results = [];
      const n = def.count || 3;
      const spread = ((def.spreadDeg || 18) * Math.PI) / 180;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        results.push(fire(def.ref, { ...origin, yaw: origin.yaw + t * spread }, ctx));
      }
      return { type: 'burst', weaponId, results };
    }

    if (def.kind === 'aoe') {
      return detonateAoe(def, origin, ctx.karts || []);
    }

    if (def.kind === 'stream') {
      applyStatus(origin.ownerId, {
        type: 'machineGun',
        duration: def.duration,
        data: { acc: 0 },
      }, ctx.karts || []);
      return { type: 'streamArm', weaponId, ownerId: origin.ownerId };
    }

    if (def.kind === 'orbit') return spawnOrbiter(def, origin);
    if (def.kind === 'portal') return spawnPortal(def, origin);
    return spawnProjectile(def, origin, ctx);
  }

  function healKart(kartId, amount, karts) {
    const kart = karts.find((k) => k.id === kartId);
    if (!kart?.health) return;
    if (typeof kart.health.heal === 'function') kart.health.heal(amount);
    else if (kart.health.state) {
      kart.health.state.hp = Math.min(kart.health.state.maxHp ?? MAX_HP, kart.health.state.hp + amount);
    }
  }

  function spawnProjectile(def, origin, ctx = {}) {
    const fwdX = Math.sin(origin.yaw);
    const fwdZ = Math.cos(origin.yaw);
    const behind = def.kind === 'hazard' || def.kind === 'mine';
    const p = {
      id: uid('proj'),
      weaponId: def.id,
      def,
      ownerId: origin.ownerId,
      x: origin.x + fwdX * (behind ? -2.4 : 2.2),
      y: (origin.y ?? 0.4) + (behind ? 0.2 : 0.5),
      z: origin.z + fwdZ * (behind ? -2.4 : 2.2),
      vx: behind ? 0 : fwdX * (def.speed || 0),
      vy: def.kind === 'lobbed' ? (def.upSpeed || 10) : 0,
      vz: behind ? 0 : fwdZ * (def.speed || 0),
      life: def.lifetime ?? 4,
      radius: def.radius ?? 0.5,
      armed: def.kind !== 'mine',
      armTimer: def.armTime || 0,
      fuse: def.fuse || 0,
      alive: true,
      targetId: null,
      mesh: null,
    };

    if (def.homing && ctx.targets) {
      let best = null;
      let bestD = Infinity;
      for (const t of ctx.targets) {
        if (t.id === origin.ownerId) continue;
        const d = (t.x - origin.x) ** 2 + (t.z - origin.z) ** 2;
        if (d < bestD) { bestD = d; best = t; }
      }
      p.targetId = best?.id ?? null;
    }

    if (scene && def.mesh) {
      p.mesh = createWeaponMesh(THREE, def.mesh, def.color);
      p.mesh.position.set(p.x, p.y, p.z);
      scene.add(p.mesh);
    }

    if (def.kind === 'hazard' || def.kind === 'mine') hazards.push(p);
    else projectiles.push(p);
    return p;
  }

  function spawnOrbiter(def, origin) {
    const entry = {
      id: uid('orbit'),
      ownerId: origin.ownerId,
      def,
      life: def.lifetime,
      angle: 0,
      balls: [],
      alive: true,
    };
    for (let i = 0; i < (def.count || 4); i++) {
      const mesh = scene ? createWeaponMesh(THREE, def.mesh, def.color) : null;
      if (mesh) scene.add(mesh);
      entry.balls.push({
        angle: (i / def.count) * Math.PI * 2,
        mesh,
        radius: def.radius,
      });
    }
    orbiters.push(entry);
    return entry;
  }

  function spawnPortal(def, origin) {
    const pending = fields.find((f) => f.type === 'portal' && f.ownerId === origin.ownerId && f.alive && !f.pairId);
    const make = (ox, oz) => {
      const portal = {
        id: uid('portal'),
        type: 'portal',
        ownerId: origin.ownerId,
        x: ox,
        y: origin.y ?? 0.1,
        z: oz,
        radius: def.radius,
        life: def.lifetime,
        alive: true,
        pairId: null,
        mesh: null,
      };
      if (scene) {
        portal.mesh = createWeaponMesh(THREE, 'portal', def.color);
        portal.mesh.position.set(portal.x, portal.y + 0.9, portal.z);
        scene.add(portal.mesh);
      }
      fields.push(portal);
      return portal;
    };

    if (pending) {
      const b = make(
        origin.x + Math.sin(origin.yaw) * 3,
        origin.z + Math.cos(origin.yaw) * 3,
      );
      pending.pairId = b.id;
      b.pairId = pending.id;
      return { type: 'portalPair', a: pending, b };
    }
    return make(
      origin.x - Math.sin(origin.yaw) * 2.5,
      origin.z - Math.cos(origin.yaw) * 2.5,
    );
  }

  function detonateAoe(def, origin, karts) {
    const hitEvents = [];
    for (const kart of karts) {
      if (kart.id === origin.ownerId) continue;
      const dx = kart.x - origin.x;
      const dz = kart.z - origin.z;
      if (dx * dx + dz * dz <= def.radius * def.radius) {
        hitEvents.push(...applyHit(kart, {
          damage: def.damage,
          status: def.status,
          fromId: origin.ownerId,
          weaponId: def.id,
        }));
      }
    }
    if (scene && def.mesh) {
      const flash = createWeaponMesh(THREE, def.mesh, def.color);
      flash.position.set(origin.x, (origin.y ?? 0) + 1, origin.z);
      scene.add(flash);
      fields.push({
        id: uid('fx'), type: 'fx', life: 0.4, alive: true, mesh: flash,
        x: origin.x, y: origin.y, z: origin.z,
      });
    }
    const ev = { type: 'aoe', weaponId: def.id, ownerId: origin.ownerId, events: hitEvents };
    onEvent(ev);
    return ev;
  }

  function applyHit(kart, { damage = 0, status = null, fromId = null, weaponId = null } = {}) {
    const events = [];
    if (isInvulnerable(kart.id) && damage > 0) {
      if (hasStatus(kart.id, 'shield') && !hasStatus(kart.id, 'invincible') && damage >= 20) {
        const list = getEffects(kart.id);
        const idx = list.findIndex((e) => e.type === 'shield');
        if (idx >= 0) {
          list.splice(idx, 1);
          detachAura(kart.id, 'shield');
        }
      }
      events.push({ type: 'blocked', targetId: kart.id, weaponId, fromId });
      return events;
    }

    let killed = false;
    let applied = 0;
    if (damage > 0 && kart.health) {
      if (typeof kart.health.damage === 'function') {
        const r = kart.health.damage(damage, fromId);
        applied = r.applied ?? damage;
        killed = !!r.killed;
      } else if (kart.health.state) {
        applied = Math.min(kart.health.state.hp, damage);
        kart.health.state.hp -= applied;
        if (kart.health.state.hp <= 0) {
          kart.health.state.hp = 0;
          kart.health.state.alive = false;
          killed = true;
        }
      }
    }

    if (status) applyStatus(kart.id, status, [kart]);

    // Visual juice on the kart controller if present
    if (kart.punchHit) kart.punchHit(killed ? 1.4 : 1);
    else if (kart.controller?.punchHit) kart.controller.punchHit(killed ? 1.4 : 1);

    const ev = {
      type: 'hit',
      targetId: kart.id,
      fromId,
      weaponId,
      damage: applied,
      killed,
      status,
      juice: { flash: true, shake: killed ? 0.55 : 0.25 },
    };
    events.push(ev);
    onEvent(ev);
    if (killed) {
      const rev = respawnKart(kart);
      if (rev) events.push(rev);
    }
    return events;
  }

  function respawnKart(kart) {
    if (!kart) return null;
    const spawn = kart.spawn || { x: 0, y: 0.35, z: 0, yaw: 0 };
    if (kart.health?.respawn) kart.health.respawn();
    else if (kart.health?.state) {
      kart.health.state.hp = kart.health.state.maxHp ?? MAX_HP;
      kart.health.state.alive = true;
    }
    if (typeof kart.reset === 'function') {
      kart.reset(spawn.x, spawn.y ?? 0.35, spawn.z, spawn.yaw ?? 0);
    } else {
      kart.x = spawn.x;
      kart.y = spawn.y ?? 0.35;
      kart.z = spawn.z;
      kart.yaw = spawn.yaw ?? 0;
    }
    applyStatus(kart.id, { type: 'invincible', duration: 1.8 }, [kart]);
    detachIce(kart.id);
    if (kart.punchRespawn) kart.punchRespawn();
    else if (kart.controller?.punchRespawn) kart.controller.punchRespawn();
    const ev = {
      type: 'respawn',
      kartId: kart.id,
      spawn,
      juice: { pulse: true, invuln: 1.8 },
    };
    onEvent(ev);
    return ev;
  }

  function killEntity(e) {
    e.alive = false;
    if (e.mesh && scene) {
      scene.remove(e.mesh);
      disposeObject(e.mesh);
      e.mesh = null;
    }
  }

  function compact(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (!arr[i].alive) arr.splice(i, 1);
    }
  }

  function explodeAt(p, karts) {
    const events = [];
    const r = p.radius || p.def.radius || 1.5;
    for (const kart of karts) {
      const dx = kart.x - p.x;
      const dz = kart.z - p.z;
      if (dx * dx + dz * dz <= r * r) {
        events.push(...applyHit(kart, {
          damage: p.def.damage || 0,
          status: p.def.status || null,
          fromId: p.ownerId,
          weaponId: p.weaponId,
        }));
      }
    }
    return events;
  }

  function spawnFieldFromProjectile(p) {
    const sf = p.def.spawnField;
    if (!sf) return;
    const f = {
      id: uid('field'),
      type: sf.type,
      ownerId: p.ownerId,
      x: p.x, y: p.y, z: p.z,
      life: sf.duration,
      pullRadius: sf.pullRadius,
      pullStrength: sf.pullStrength,
      damagePerSec: sf.damagePerSec || 0,
      alive: true,
      mesh: null,
    };
    if (scene) {
      f.mesh = createWeaponMesh(THREE, 'blackHoleField', 0x2c0033);
      f.mesh.position.set(f.x, 0.2, f.z);
      scene.add(f.mesh);
    }
    fields.push(f);
  }

  /**
   * @param {number} dt
   * @param {object[]} karts — { id, x, y, z, yaw, health?, spawn?, alive?, velocity? }
   * @param {{ now?: number, gravity?: number, groundY?: number }} [world]
   */
  function update(dt, karts = [], world = {}) {
    const now = world.now ?? performance.now();
    const gravity = world.gravity ?? 28;
    const groundY = world.groundY ?? 0;
    const events = [];

    events.push(...collectBoxes(karts, now));
    tickStatus(dt, karts);

    // Machine gun stream
    for (const kart of karts) {
      const mg = getEffects(kart.id).find((e) => e.type === 'machineGun');
      if (!mg) continue;
      mg.data = mg.data || { acc: 0 };
      mg.data.acc += dt;
      const def = WEAPON_DEFS.machineGun;
      while (mg.data.acc >= def.fireRate) {
        mg.data.acc -= def.fireRate;
        spawnProjectile(def, {
          ownerId: kart.id, x: kart.x, y: kart.y, z: kart.z, yaw: kart.yaw,
        }, { targets: karts });
      }
    }

    // Shockwave deflects projectiles
    for (const kart of karts) {
      if (!hasStatus(kart.id, 'shockwave')) continue;
      const deflR = WEAPON_DEFS.shockwaveRing.deflectRadius || 3.2;
      for (const p of projectiles) {
        if (!p.alive || p.ownerId === kart.id) continue;
        const dx = p.x - kart.x;
        const dz = p.z - kart.z;
        if (dx * dx + dz * dz <= deflR * deflR) {
          const len = Math.hypot(dx, dz) || 1;
          const speed = Math.hypot(p.vx, p.vz) || p.def.speed || 20;
          p.vx = (dx / len) * speed;
          p.vz = (dz / len) * speed;
          p.ownerId = kart.id;
          events.push({ type: 'deflect', projectileId: p.id, by: kart.id });
        }
      }
    }

    // Projectiles
    for (const p of projectiles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { killEntity(p); continue; }

      if (p.def.kind === 'lobbed') p.vy -= gravity * dt;

      if (p.targetId && p.def.homing) {
        const t = karts.find((k) => k.id === p.targetId);
        if (t) {
          const dx = t.x - p.x;
          const dz = t.z - p.z;
          const len = Math.hypot(dx, dz) || 1;
          const spd = p.def.speed || 40;
          const h = p.def.homing;
          p.vx += ((dx / len) * spd - p.vx) * Math.min(1, h * 4 * dt);
          p.vz += ((dz / len) * spd - p.vz) * Math.min(1, h * 4 * dt);
        }
      }

      p.x += p.vx * dt;
      p.y += (p.vy || 0) * dt;
      p.z += p.vz * dt;

      if (p.def.kind === 'lobbed' && p.y <= groundY + 0.2) {
        if (p.def.bounce && Math.abs(p.vy) > 2) {
          p.y = groundY + 0.2;
          p.vy = -p.vy * p.def.bounce;
        } else if (p.def.spawnField) {
          spawnFieldFromProjectile(p);
          killEntity(p);
          continue;
        } else if (p.def.fuse) {
          p.y = groundY + 0.25;
          p.vx *= 0.5;
          p.vz *= 0.5;
          p.vy = 0;
          p.fuse -= dt;
          if (p.fuse <= 0) {
            events.push(...explodeAt(p, karts));
            killEntity(p);
            continue;
          }
        } else {
          events.push(...explodeAt(p, karts));
          killEntity(p);
          continue;
        }
      }

      const pBox = entAabb(p);
      for (const kart of karts) {
        if (!p.alive) break;
        if (kart.id === p.ownerId) continue;
        if (!aabbHit(pBox, kartAabb(kart))) continue;
        events.push(...applyHit(kart, {
          damage: p.def.damage || 0,
          status: p.def.status || null,
          fromId: p.ownerId,
          weaponId: p.weaponId,
        }));
        if (p.def.spawnField) spawnFieldFromProjectile(p);
        killEntity(p);
        break;
      }

      if (p.mesh) {
        p.mesh.position.set(p.x, p.y, p.z);
        if (p.vx || p.vz) p.mesh.rotation.y = Math.atan2(p.vx, p.vz);
      }
    }

    // Hazards / mines
    for (const h of hazards) {
      if (!h.alive) continue;
      h.life -= dt;
      if (h.life <= 0) { killEntity(h); continue; }
      if (!h.armed) {
        h.armTimer -= dt;
        if (h.armTimer <= 0) h.armed = true;
      }
      if (h.mesh) {
        h.mesh.position.set(h.x, h.y, h.z);
        if (h.def.kind === 'mine' && h.armed) h.mesh.rotation.y += dt * 2;
      }
      if (!h.armed) continue;
      const triggerR = h.def.triggerRadius || h.radius;
      for (const kart of karts) {
        if (kart.id === h.ownerId && h.life > (h.def.lifetime || 10) - 0.5) continue;
        const dx = kart.x - h.x;
        const dz = kart.z - h.z;
        if (dx * dx + dz * dz > triggerR * triggerR) continue;
        if (h.def.kind === 'mine') events.push(...explodeAt(h, karts));
        else {
          events.push(...applyHit(kart, {
            damage: h.def.damage || 0,
            status: h.def.status || null,
            fromId: h.ownerId,
            weaponId: h.weaponId,
          }));
        }
        killEntity(h);
        break;
      }
    }

    // Orbiters
    for (const orb of orbiters) {
      if (!orb.alive) continue;
      orb.life -= dt;
      if (orb.life <= 0) {
        for (const b of orb.balls) {
          if (b.mesh && scene) { scene.remove(b.mesh); disposeObject(b.mesh); }
        }
        orb.alive = false;
        continue;
      }
      const owner = karts.find((k) => k.id === orb.ownerId);
      if (!owner) continue;
      orb.angle += orb.def.orbitSpeed * dt;
      for (const b of orb.balls) {
        const a = orb.angle + b.angle;
        const ox = owner.x + Math.cos(a) * orb.def.orbitRadius;
        const oz = owner.z + Math.sin(a) * orb.def.orbitRadius;
        const oy = (owner.y ?? 0.4) + 0.5;
        if (b.mesh) b.mesh.position.set(ox, oy, oz);
        for (const kart of karts) {
          if (kart.id === orb.ownerId) continue;
          const dx = kart.x - ox;
          const dz = kart.z - oz;
          if (dx * dx + dz * dz <= (b.radius + 1) ** 2) {
            events.push(...applyHit(kart, {
              damage: orb.def.damage,
              fromId: orb.ownerId,
              weaponId: orb.def.id,
            }));
          }
        }
      }
    }

    // Fields
    for (const f of fields) {
      if (!f.alive) continue;
      f.life -= dt;
      if (f.life <= 0) { killEntity(f); continue; }
      if (f.mesh) f.mesh.rotation.y += dt * 3;

      if (f.type === 'blackHole') {
        for (const kart of karts) {
          const dx = f.x - kart.x;
          const dz = f.z - kart.z;
          const dist = Math.hypot(dx, dz) || 0.001;
          if (dist >= f.pullRadius) continue;
          if (hasStatus(kart.id, 'gravityAnchor')) continue;
          const str = f.pullStrength * (1 - dist / f.pullRadius) * dt;
          if (kart.vx != null) {
            kart.vx += (dx / dist) * str;
            kart.vz += (dz / dist) * str;
          } else if (kart.velocity) {
            kart.velocity.x += (dx / dist) * str;
            kart.velocity.z += (dz / dist) * str;
          }
          if (f.damagePerSec && dist < f.pullRadius * 0.45) {
            events.push(...applyHit(kart, {
              damage: f.damagePerSec * dt,
              fromId: f.ownerId,
              weaponId: 'blackHoleGrenade',
            }));
          }
        }
      }

      if (f.type === 'portal' && f.pairId) {
        const pair = fields.find((o) => o.id === f.pairId && o.alive);
        if (!pair) continue;
        for (const kart of karts) {
          const dx = kart.x - f.x;
          const dz = kart.z - f.z;
          if (dx * dx + dz * dz > f.radius * f.radius) continue;
          if (kart._portalCd && kart._portalCd > 0) continue;
          kart.x = pair.x;
          kart.z = pair.z;
          if (kart.position) { kart.position.x = pair.x; kart.position.z = pair.z; }
          kart._portalCd = 1.2;
          events.push({ type: 'portalTeleport', kartId: kart.id, from: f.id, to: pair.id });
        }
      }
    }

    for (const kart of karts) {
      if (kart._portalCd) kart._portalCd = Math.max(0, kart._portalCd - dt);
      const bey = getEffects(kart.id).find((e) => e.type === 'beyblade');
      kart.collisionImpactMul = bey ? bey.magnitude : 1;
      kart.lockedToGround = hasStatus(kart.id, 'gravityAnchor');
      kart.controlsLocked =
        hasStatus(kart.id, 'frozen') || hasStatus(kart.id, 'spinOut') || hasStatus(kart.id, 'stun');
      const shrunk = getEffects(kart.id).find((e) => e.type === 'shrunk');
      kart.scaleMul = shrunk ? shrunk.magnitude : 1;
    }

    compact(projectiles);
    compact(hazards);
    compact(fields);
    compact(orbiters);
    return events;
  }

  function dispose() {
    for (const list of [projectiles, hazards, fields, mysteryBoxes]) {
      for (const e of list) killEntity(e);
      list.length = 0;
    }
    for (const orb of orbiters) {
      orb.alive = false;
      for (const b of orb.balls) {
        if (b.mesh && scene) { scene.remove(b.mesh); disposeObject(b.mesh); }
      }
    }
    orbiters.length = 0;
    for (const id of [...iceBlocks.keys()]) detachIce(id);
    for (const key of [...auras.keys()]) {
      const [kartId, type] = key.split(':');
      detachAura(kartId, type);
    }
    effects.clear();
    inventory.clear();
  }

  return {
    WEAPON_DEFS,
    ALL_WEAPON_IDS,
    CLASSIC_IDS,
    CUSTOM_IDS,
    projectiles,
    hazards,
    fields,
    mysteryBoxes,
    orbiters,
    inventory,
    spawnMysteryBox,
    spawnMysteryBoxRing,
    syncMysteryBoxSpawns,
    fire,
    useWeapon,
    giveWeapon,
    getInventory,
    rollWeapon,
    applyStatus,
    getEffects,
    hasStatus,
    applyHit,
    respawnKart,
    update,
    dispose,
    createWeaponMesh: (kind, color) => createWeaponMesh(THREE, kind, color),
  };
}

export default createWeaponSystem;
