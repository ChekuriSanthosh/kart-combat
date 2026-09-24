/**
 * Weapons. Definitions and the projectile simulation both live here so the
 * server owns every hit and the client only has to draw what it is told.
 *
 * The old build ran a full weapon system in the browser that could never touch
 * another player, while the server ran an invisible hitscan cone. Now there is
 * one implementation and it is authoritative.
 */

import { pointInSolid } from './collision.js';
import { KART, applyImpulse } from './physics.js';
import { MAX_HP } from './constants.js';

/**
 * Lethality follows the arcade rule the genre runs on: explosives wreck you
 * outright, sustained fire takes a few hits, and the freeze ray is a control
 * weapon that hurts without ever finishing the job.
 *
 *   rocket / bomb / mine   one hit, including a clean blast
 *   machine gun            four bullets
 *   freeze ray             halves whatever health you have left
 */
export const WEAPONS = Object.freeze({
  rocket: {
    id: 'rocket', name: 'Rocket', kind: 'projectile', rarity: 10,
    speed: 44, life: 4, radius: 0.45, damage: MAX_HP,
    blast: 4.5, blastDamage: MAX_HP, lethalBlast: true, knockback: 15, homing: 0.2,
    color: 0xff5533, mesh: 'rocket', glyph: '🚀',
  },
  tripleRocket: {
    id: 'tripleRocket', name: 'Triple Rocket', kind: 'burst', rarity: 5,
    ref: 'rocket', count: 3, spread: 0.22,
    color: 0xff8844, mesh: 'rocket', glyph: '✳️',
  },
  machineGun: {
    id: 'machineGun', name: 'Machine Gun', kind: 'stream', rarity: 9,
    duration: 1.5, interval: 0.09,
    speed: 72, life: 1.1, radius: 0.16, damage: MAX_HP / 4, knockback: 2,
    color: 0xffd966, mesh: 'bullet', glyph: '🔫',
  },
  freezeRay: {
    id: 'freezeRay', name: 'Freeze Ray', kind: 'projectile', rarity: 8,
    speed: 40, life: 3, radius: 0.45, damage: 0, halveHealth: true,
    stun: 1.7, knockback: 3,
    color: 0x9fe8ff, mesh: 'snowball', glyph: '❄️',
  },
  bomb: {
    id: 'bomb', name: 'Bomb', kind: 'lobbed', rarity: 8,
    speed: 24, upSpeed: 12, life: 3.2, radius: 0.5, fuse: 1.6,
    damage: 0, blast: 7.0, blastDamage: MAX_HP, lethalBlast: true,
    knockback: 22, stun: 0.5,
    color: 0x2b2b33, mesh: 'bomb', glyph: '💣',
  },
  mine: {
    id: 'mine', name: 'Mine', kind: 'mine', rarity: 9,
    dropBack: 3.2, armTime: 0.9, trigger: 3.0, life: 25,
    radius: 0.5, blast: 5.0, blastDamage: MAX_HP, lethalBlast: true,
    knockback: 20, stun: 0.4,
    color: 0xcc3333, mesh: 'mine', glyph: '🚨',
  },
  shield: {
    id: 'shield', name: 'Shield', kind: 'self', rarity: 7,
    shield: 6.5, color: 0x55ccff, mesh: 'shield', glyph: '🛡️',
  },
  boost: {
    id: 'boost', name: 'Turbo', kind: 'self', rarity: 10,
    boost: 2.6, color: 0x3ba7ff, mesh: 'boost', glyph: '⚡',
  },
  repair: {
    id: 'repair', name: 'Repair Kit', kind: 'self', rarity: 7,
    heal: 50, color: 0x2ecc71, mesh: 'repair', glyph: '❤️',
  },
});

export const WEAPON_IDS = Object.freeze(Object.keys(WEAPONS));

const WEIGHTED = WEAPON_IDS.flatMap((id) => Array(WEAPONS[id].rarity).fill(id));

export function rollWeapon(rng = Math.random) {
  return WEIGHTED[Math.floor(rng() * WEIGHTED.length)];
}

let nextProjectileId = 1;

/** Does a sphere overlap a kart's capsule-ish bounding cylinder? */
function hitsKart(px, py, pz, pr, kart) {
  const dx = px - kart.x;
  const dz = pz - kart.z;
  if (dx * dx + dz * dz > (pr + KART.radius) ** 2) return false;
  return py >= kart.y - pr && py <= kart.y + KART.height + pr;
}

/**
 * Create the projectiles for one weapon use.
 *
 * @param {object} def       weapon definition
 * @param {object} shooter   { id, state }
 * @param {object[]} rivals  candidate homing targets
 * @param {number} [yawOffset]
 */
export function spawnProjectiles(def, shooter, rivals, yawOffset = 0) {
  const s = shooter.state;
  const out = [];

  if (def.kind === 'burst') {
    const ref = WEAPONS[def.ref];
    for (let i = 0; i < def.count; i++) {
      const t = def.count === 1 ? 0 : i / (def.count - 1) - 0.5;
      out.push(...spawnProjectiles(ref, shooter, rivals, t * def.spread * 2));
    }
    return out;
  }

  const yaw = s.yaw + yawOffset;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const behind = def.kind === 'mine';
  const reach = behind ? -(def.dropBack ?? 3) : 2.2;

  const p = {
    id: `pr${nextProjectileId++}`,
    w: def.id,
    owner: shooter.id,
    x: s.x + fx * reach,
    y: s.y + (behind ? 0.3 : 0.75),
    z: s.z + fz * reach,
    vx: behind ? 0 : fx * def.speed + s.vx * 0.35,
    vy: def.kind === 'lobbed' ? def.upSpeed : 0,
    vz: behind ? 0 : fz * def.speed + s.vz * 0.35,
    life: def.life,
    fuse: def.fuse ?? 0,
    arm: def.armTime ?? 0,
    target: null,
    yaw,
  };

  if (def.homing) {
    let best = null;
    let bestScore = Infinity;
    for (const r of rivals) {
      if (r.id === shooter.id || r.alive === false) continue;
      const dx = r.state.x - s.x;
      const dz = r.state.z - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 55) continue;
      // Only lock onto things roughly in front of the nose.
      const dot = (dx / dist) * fx + (dz / dist) * fz;
      if (dot < 0.55) continue;
      if (dist < bestScore) { bestScore = dist; best = r; }
    }
    p.target = best ? best.id : null;
  }

  out.push(p);
  return out;
}

/**
 * Advance every projectile and report what happened.
 *
 * @param {object[]} projectiles mutated in place
 * @param {object[]} karts       { id, state, alive, shieldTime, invulnTime }
 * @param {object} map
 * @param {number} dt
 * @param {(hit: object) => void} onDamage  called as (targetKart, amount, sourceId, opts)
 * @returns {object[]} visual events for clients
 */
export function stepProjectiles(projectiles, karts, map, dt, onDamage) {
  const events = [];

  const blast = (p, def, x, y, z) => {
    events.push({ t: 'blast', x, y, z, r: def.blast || 1.5, w: def.id });
    if (!def.blast) return;
    for (const k of karts) {
      if (k.alive === false) continue;
      const dx = k.state.x - x;
      const dz = k.state.z - z;
      const dy = k.state.y - y;
      const dist = Math.hypot(dx, dz, dy);
      if (dist > def.blast + KART.radius) continue;
      const falloff = 1 - Math.min(1, dist / (def.blast + KART.radius));
      // A lethal blast is lethal anywhere inside its radius. Scaling it by
      // distance would mean catching the edge of a rocket leaves you alive on
      // a sliver, which is not what "one hit kill" means. Knockback keeps the
      // falloff, so the physics still reads as an explosion.
      const dmg = def.lethalBlast
        ? MAX_HP
        : (def.blastDamage || 0) * (0.45 + 0.55 * falloff);
      const n = dist < 0.01 ? { x: 0, z: 0 } : { x: dx / dist, z: dz / dist };
      onDamage(k, dmg, p.owner, {
        knockback: { x: n.x * def.knockback * falloff, y: 5 * falloff, z: n.z * def.knockback * falloff },
        stun: def.stun ? def.stun * falloff : 0,
        weapon: def.id,
      });
    }
  };

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const def = WEAPONS[p.w];
    p.life -= dt;

    if (p.arm > 0) p.arm = Math.max(0, p.arm - dt);

    // ── Mines sit still, arm, then trigger on proximity ──
    if (def.kind === 'mine') {
      if (p.life <= 0) { projectiles.splice(i, 1); continue; }
      if (p.arm > 0) continue;
      let tripped = false;
      for (const k of karts) {
        if (k.alive === false) continue;
        if (k.id === p.owner && p.life > def.life - 2) continue;
        const dx = k.state.x - p.x;
        const dz = k.state.z - p.z;
        if (dx * dx + dz * dz > def.trigger * def.trigger) continue;
        if (Math.abs(k.state.y - p.y) > 3) continue;
        tripped = true;
        break;
      }
      if (tripped) {
        blast(p, def, p.x, p.y, p.z);
        projectiles.splice(i, 1);
      }
      continue;
    }

    if (p.life <= 0) {
      if (def.blast) blast(p, def, p.x, p.y, p.z);
      projectiles.splice(i, 1);
      continue;
    }

    if (def.kind === 'lobbed') {
      p.vy -= 30 * dt;
      p.fuse -= dt;
      if (p.fuse <= 0) {
        blast(p, def, p.x, p.y, p.z);
        projectiles.splice(i, 1);
        continue;
      }
    }

    if (def.homing && p.target) {
      const t = karts.find((k) => k.id === p.target && k.alive !== false);
      if (t) {
        const dx = t.state.x - p.x;
        const dz = t.state.z - p.z;
        const dy = t.state.y + 0.6 - p.y;
        const len = Math.hypot(dx, dz, dy) || 1;
        const turn = Math.min(1, def.homing * 6 * dt);
        p.vx += ((dx / len) * def.speed - p.vx) * turn;
        p.vy += ((dy / len) * def.speed - p.vy) * turn;
        p.vz += ((dz / len) * def.speed - p.vz) * turn;
      } else {
        p.target = null;
      }
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    if (p.vx || p.vz) p.yaw = Math.atan2(p.vx, p.vz);

    // ── World collision ──
    if (p.y < map.killY) { projectiles.splice(i, 1); continue; }
    const surface = pointInSolid(map.solids, p.x, p.y, p.z);
    const belowFloor = map.floorY > -900 && p.y <= map.floorY + 0.15;
    if (surface || belowFloor) {
      if (def.kind === 'lobbed') {
        // Bombs settle and keep ticking instead of popping on first contact.
        p.y = Math.max(p.y, (surface ? surface._top : map.floorY) + 0.25);
        p.vy = Math.abs(p.vy) > 4 ? -p.vy * 0.3 : 0;
        p.vx *= 0.6;
        p.vz *= 0.6;
      } else {
        blast(p, def, p.x, p.y, p.z);
        projectiles.splice(i, 1);
        continue;
      }
    }

    // ── Kart collision ──
    let consumed = false;
    for (const k of karts) {
      if (k.alive === false || k.id === p.owner) continue;
      if (!hitsKart(p.x, p.y, p.z, def.radius, k.state)) continue;
      const fwd = Math.hypot(p.vx, p.vz) || 1;
      onDamage(k, def.damage || 0, p.owner, {
        knockback: {
          x: (p.vx / fwd) * (def.knockback || 0),
          y: def.blast ? 4 : 1,
          z: (p.vz / fwd) * (def.knockback || 0),
        },
        stun: def.stun || 0,
        // Resolved against live health by whoever owns the health, because the
        // amount depends on the target rather than on the weapon.
        halveHealth: !!def.halveHealth,
        weapon: def.id,
      });
      if (def.blast) blast(p, def, p.x, p.y, p.z);
      else events.push({ t: 'spark', x: p.x, y: p.y, z: p.z, w: def.id });
      consumed = true;
      break;
    }
    if (consumed) projectiles.splice(i, 1);
  }

  return events;
}

/** Apply a "self" weapon (shield / turbo / repair) to its user. */
export function applySelfWeapon(def, kart) {
  if (def.shield) kart.shieldTime = Math.max(kart.shieldTime || 0, def.shield);
  if (def.boost) kart.state.boostTime = Math.max(kart.state.boostTime, def.boost);
  if (def.heal) kart.hp = Math.min(100, kart.hp + def.heal);
}

export { applyImpulse };
