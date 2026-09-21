/**
 * Weapon projectiles, hazard collision, and status effects.
 * Collision uses plain positions + radii (map colliders are separate).
 */

export const WEAPON_DEFS = Object.freeze({
  banana: {
    id: 'banana', kind: 'hazard', speed: 0, lifetime: 20, radius: 0.9, damage: 0,
    status: { type: 'spin', duration: 1.1, magnitude: 1 },
  },
  greenShell: {
    id: 'greenShell', kind: 'projectile', speed: 38, lifetime: 6, radius: 0.65, damage: 18,
    bounce: true, status: null,
  },
  redShell: {
    id: 'redShell', kind: 'homing', speed: 34, lifetime: 8, radius: 0.65, damage: 22, status: null,
  },
  blueShell: {
    id: 'blueShell', kind: 'homingLeader', speed: 28, lifetime: 12, radius: 1.1, damage: 45,
    status: { type: 'stun', duration: 1.4, magnitude: 1 },
  },
  mushroom: {
    id: 'mushroom', kind: 'instant', speed: 0, lifetime: 0, radius: 0, damage: 0,
    status: { type: 'boost', duration: 1.6, magnitude: 1.55 },
  },
  star: {
    id: 'star', kind: 'instant', speed: 0, lifetime: 0, radius: 0, damage: 0,
    status: { type: 'invincible', duration: 5, magnitude: 1 },
  },
  lightning: {
    id: 'lightning', kind: 'aoe', speed: 0, lifetime: 0.05, radius: 999, damage: 12,
    status: { type: 'slow', duration: 3.5, magnitude: 0.4 },
  },
  oilSlick: {
    id: 'oilSlick', kind: 'hazard', speed: 0, lifetime: 18, radius: 1.4, damage: 0,
    status: { type: 'ice', duration: 2.2, magnitude: 0.4 },
  },
  customBomb: {
    id: 'customBomb', kind: 'projectile', speed: 22, lifetime: 4, radius: 1.6, damage: 35,
    status: { type: 'stun', duration: 0.8, magnitude: 1 },
  },
});

let _id = 1;

/**
 * @param {object} [opts]
 */
export function createWeaponSystem(opts = {}) {
  const kartRadius = opts.kartRadius ?? 1.1;
  const customDefs = { ...(opts.customDefs || {}) };
  const projectiles = [];

  function defOf(id) {
    return WEAPON_DEFS[id] || customDefs[id] || null;
  }

  function fire(weaponId, origin, ctx = {}) {
    const def = defOf(weaponId);
    if (!def) return null;

    if (def.kind === 'instant') {
      return { type: 'instant', weaponId, ownerId: origin.ownerId, status: def.status };
    }
    if (def.kind === 'aoe') {
      const hits = [];
      for (const t of ctx.targets || []) {
        if (t.id === origin.ownerId) continue;
        hits.push({ targetId: t.id, damage: def.damage, status: def.status });
      }
      return { type: 'aoe', weaponId, hits };
    }

    const fwdX = Math.sin(origin.yaw);
    const fwdZ = Math.cos(origin.yaw);
    const behind = def.kind === 'hazard';
    let targetId = null;
    if (def.kind === 'homing' || def.kind === 'homingLeader') {
      const targets = (ctx.targets || []).filter((t) => t.id !== origin.ownerId);
      if (def.kind === 'homingLeader') {
        targetId = (targets.find((t) => t.isLeader) || targets[0])?.id ?? null;
      } else {
        let best = null;
        let bestD = Infinity;
        for (const t of targets) {
          const d = (t.x - origin.x) ** 2 + (t.z - origin.z) ** 2;
          if (d < bestD) { bestD = d; best = t; }
        }
        targetId = best?.id ?? null;
      }
    }

    const proj = {
      id: `wpn_${_id++}`,
      weaponId: def.id,
      def,
      ownerId: origin.ownerId,
      x: origin.x + fwdX * (behind ? -2.2 : 2.2),
      y: (origin.y ?? 0) + 0.4,
      z: origin.z + fwdZ * (behind ? -2.2 : 2.2),
      vx: behind ? 0 : fwdX * def.speed,
      vz: behind ? 0 : fwdZ * def.speed,
      life: def.lifetime,
      targetId,
      alive: true,
    };
    projectiles.push(proj);
    return proj;
  }

  function update(dt, karts, world = {}) {
    const events = [];
    for (const p of projectiles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }

      if (p.targetId && (p.def.kind === 'homing' || p.def.kind === 'homingLeader')) {
        const t = karts.find((k) => k.id === p.targetId);
        if (t) {
          const dx = t.x - p.x;
          const dz = t.z - p.z;
          const len = Math.hypot(dx, dz) || 1;
          p.vx += ((dx / len) * p.def.speed - p.vx) * Math.min(1, 4 * dt);
          p.vz += ((dz / len) * p.def.speed - p.vz) * Math.min(1, 4 * dt);
        }
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      if (p.def.bounce && world.bounds) {
        const b = world.bounds;
        if (p.x < b.minX || p.x > b.maxX) p.vx *= -1;
        if (p.z < b.minZ || p.z > b.maxZ) p.vz *= -1;
      }

      for (const kart of karts) {
        if (!p.alive) break;
        if (kart.id === p.ownerId && p.def.kind !== 'hazard') continue;
        if (kart.id === p.ownerId && p.def.kind === 'hazard' && p.life > p.def.lifetime - 0.4) continue;
        const dx = kart.x - p.x;
        const dz = kart.z - p.z;
        const hitR = kartRadius + (p.def.radius ?? 0.6);
        if (dx * dx + dz * dz <= hitR * hitR) {
          p.alive = false;
          if (typeof kart.applyHit === 'function') {
            kart.applyHit({ damage: p.def.damage, effect: p.def.status, fromId: p.ownerId });
          }
          events.push({
            type: 'hit',
            projectileId: p.id,
            weaponId: p.weaponId,
            ownerId: p.ownerId,
            targetId: kart.id,
            damage: p.def.damage,
            status: p.def.status,
          });
        }
      }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      if (!projectiles[i].alive) projectiles.splice(i, 1);
    }
    return events;
  }

  function registerCustom(def) {
    customDefs[def.id] = def;
  }

  return { WEAPON_DEFS, projectiles, fire, update, registerCustom };
}

export default createWeaponSystem;
