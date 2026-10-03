/**
 * Weapons. Definitions and the projectile simulation both live here so the
 * server owns every hit and the client only has to draw what it is told.
 *
 * The old build ran a full weapon system in the browser that could never touch
 * another player, while the server ran an invisible hitscan cone. Now there is
 * one implementation and it is authoritative.
 */

import { pointInSolid, topAt } from './collision.js';
import { KART, applyImpulse } from './physics.js';
import { MAX_HP } from './constants.js';

/**
 * Lethality follows the arcade rule the genre runs on: explosives wreck you
 * outright, sustained fire takes a few hits, and the freeze ray is a control
 * weapon that hurts without ever finishing the job.
 *
 *   rocket / bomb / mine   one hit, including a clean blast
 *   spike balls            one touch
 *   machine gun            four bullets
 *   freeze ray             halves whatever health you have left
 *
 * Explosives never hurt the kart that fired them — the blast still shoves you,
 * but a rocket at a rival three metres away should cost them the round, not
 * both of you.
 *
 * How long a pickup stays in the slot comes in three shapes, all shown as the
 * number badge on the HUD weapon slot:
 *
 *   uses      presses before the slot empties (mines drop three, one per press)
 *   ammo      rounds for a `hold` weapon, spent while the trigger is held
 *   duration  seconds a timed weapon runs once pressed (shield, spike balls);
 *             the slot stays locked until it runs out
 *
 * `killName` is how the death message names the weapon: "You were smashed by
 * Ann's <killName>".
 */
export const WEAPONS = Object.freeze({
  rocket: {
    id: 'rocket', name: 'Rocket', killName: 'rocket', kind: 'projectile', rarity: 10, uses: 1,
    speed: 44, life: 4, radius: 0.45, damage: MAX_HP,
    blast: 4.5, blastDamage: MAX_HP, lethalBlast: true, knockback: 15, homing: 0.2,
    color: 0xff5533, mesh: 'rocket', glyph: '🚀',
  },
  tripleRocket: {
    id: 'tripleRocket', name: 'Triple Rocket', killName: 'rockets', kind: 'burst', rarity: 5, uses: 1,
    ref: 'rocket', count: 3, spread: 0.22,
    color: 0xff8844, mesh: 'rocket', glyph: '✳️',
  },
  machineGun: {
    // Held, not tapped: 20 rounds at a fixed rate is 1.8 s of fire, which can
    // be spent in one burst or a few short ones. The bullets bend gently
    // toward the nearest kart ahead within 25 m — enough that a burst at a
    // weaving kart lands a hit or two, not so much that it stops being aimed.
    id: 'machineGun', name: 'Machine Gun', killName: 'machine gun', kind: 'stream', rarity: 9,
    hold: true, ammo: 20, interval: 0.09,
    speed: 72, life: 1.1, radius: 0.16, damage: MAX_HP / 4, knockback: 2,
    homing: 0.3, homingRange: 25, homingCone: 0.7,
    color: 0xffd966, mesh: 'bullet', glyph: '🔫',
  },
  freezeRay: {
    id: 'freezeRay', name: 'Freeze Ray', killName: 'freeze ray', kind: 'projectile', rarity: 8, uses: 1,
    speed: 40, life: 3, radius: 0.45, damage: 0, halveHealth: true,
    stun: 1.7, knockback: 3,
    color: 0x9fe8ff, mesh: 'snowball', glyph: '❄️',
  },
  bomb: {
    id: 'bomb', name: 'Bomb', killName: 'bomb', kind: 'lobbed', rarity: 8, uses: 1,
    speed: 24, upSpeed: 12, life: 3.2, radius: 0.5, fuse: 1.6,
    damage: 0, blast: 7.0, blastDamage: MAX_HP, lethalBlast: true,
    knockback: 22, stun: 0.5,
    color: 0x2b2b33, mesh: 'bomb', glyph: '💣',
  },
  mine: {
    id: 'mine', name: 'Mine', killName: 'mine', kind: 'mine', rarity: 9, uses: 3,
    dropBack: 3.2, armTime: 0.9, trigger: 3.0, life: 25,
    radius: 0.5, blast: 5.0, blastDamage: MAX_HP, lethalBlast: true,
    knockback: 20, stun: 0.4,
    color: 0xcc3333, mesh: 'mine', glyph: '🚨',
  },
  spikes: {
    // Spiked balls circling the kart for a few seconds; anything they touch
    // is wrecked. Nothing is fired — the server checks contact every step
    // (see tickOrbits in server/room.js) — so this def is also what the
    // renderer reads to draw the ring: `count` balls of `ballRadius` at
    // `radius` metres from the kart's centre, `height` above its wheels,
    // turning at `spin` rad/s. Contact is tested against the whole circle the
    // balls sweep, not their exact angles, so the drawn phase never has to
    // match the server's.
    id: 'spikes', name: 'Spike Balls', killName: 'spike balls', kind: 'orbit', rarity: 8, uses: 1,
    duration: 6, radius: 2.6, count: 4, spin: 4.5, ballRadius: 0.45, height: 0.7,
    damage: MAX_HP, knockback: 14,
    color: 0x3a3a46, mesh: 'spikeball', glyph: '✴️',
  },
  shield: {
    id: 'shield', name: 'Shield', killName: 'shield', kind: 'timed', rarity: 7, uses: 1,
    duration: 6.5, shield: true,
    color: 0x55ccff, mesh: 'shield', glyph: '🛡️',
  },
  boost: {
    id: 'boost', name: 'Turbo', killName: 'turbo', kind: 'self', rarity: 10, uses: 1,
    boost: 2.6, color: 0x3ba7ff, mesh: 'boost', glyph: '⚡',
  },
  repair: {
    id: 'repair', name: 'Repair Kit', killName: 'repair kit', kind: 'self', rarity: 7, uses: 1,
    heal: 50, color: 0x2ecc71, mesh: 'repair', glyph: '❤️',
  },
});

export const WEAPON_IDS = Object.freeze(Object.keys(WEAPONS));

const WEIGHTED = WEAPON_IDS.flatMap((id) => Array(WEAPONS[id].rarity).fill(id));

export function rollWeapon(rng = Math.random) {
  return WEIGHTED[Math.floor(rng() * WEIGHTED.length)];
}

/** Does this weapon run on a clock once pressed (shield, spike balls)? */
export function isTimedWeapon(def) {
  return (def?.duration ?? 0) > 0;
}

/** Presses (or, for a `hold` weapon, rounds) a fresh pickup comes with. */
export function chargesOf(def) {
  return def?.ammo ?? def?.uses ?? 1;
}

/**
 * The number on the HUD slot's badge: seconds left for a timed weapon (its
 * full length until it is switched on), rounds or presses left for anything
 * that holds more than one, and 0 — no badge — for a single shot.
 */
export function slotBadge(def, ammo, timer) {
  if (!def) return 0;
  if (isTimedWeapon(def)) return Math.ceil(timer > 0 ? timer : def.duration);
  return chargesOf(def) > 1 ? Math.max(0, ammo) : 0;
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
    // Each one flies and looks like a plain rocket, but a kill is credited to
    // what was actually fired, so the death message says "rockets".
    for (const p of out) p.src = def.id;
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
    /** Weapon a kill is credited to, when it differs from what is flying. */
    src: def.id,
    yaw,
  };

  if (def.homing) {
    const range = def.homingRange ?? 55;
    const cone = def.homingCone ?? 0.55;
    let best = null;
    let bestScore = Infinity;
    for (const r of rivals) {
      if (r.id === shooter.id || r.alive === false) continue;
      const dx = r.state.x - s.x;
      const dz = r.state.z - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range || dist < 1e-3) continue;
      // Only lock onto things roughly in front of the nose.
      const dot = (dx / dist) * fx + (dz / dist) * fz;
      if (dot < cone) continue;
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
      const n = dist < 0.01 ? { x: 0, z: 0 } : { x: dx / dist, z: dz / dist };
      const knockback = { x: n.x * def.knockback * falloff, y: 5 * falloff, z: n.z * def.knockback * falloff };

      // Your own explosion shoves you but never hurts you. Bot matches showed
      // a fifth to a third of all weapon deaths were shooters caught in their
      // own blast — a rocket at a rival a few metres ahead wrecked both — which
      // punishes exactly the close-range aggression the game is about.
      if (k.id === p.owner) {
        applyImpulse(k.state, knockback.x, knockback.y, knockback.z);
        continue;
      }

      // A lethal blast is lethal anywhere inside its radius. Scaling it by
      // distance would mean catching the edge of a rocket leaves you alive on
      // a sliver, which is not what "one hit kill" means. Knockback keeps the
      // falloff, so the physics still reads as an explosion.
      const dmg = def.lethalBlast
        ? MAX_HP
        : (def.blastDamage || 0) * (0.45 + 0.55 * falloff);
      onDamage(k, dmg, p.owner, {
        knockback,
        stun: def.stun ? def.stun * falloff : 0,
        weapon: p.src || def.id,
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
        // Never your own: the blast could not hurt you anyway, and a mine
        // that goes off under its owner is a mine wasted.
        if (k.id === p.owner) continue;
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
        // The surface right under the bomb: on a slope that is lower than the
        // solid's highest edge, which would leave it hovering.
        const ground = surface ? (topAt(surface, p.x, p.z) ?? surface._top) : map.floorY;
        p.y = Math.max(p.y, ground + 0.25);
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
        weapon: p.src || def.id,
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

/**
 * Apply an instant "self" weapon (turbo / repair) to its user. The shield is
 * timed rather than instant, so the room runs it off the slot's timer.
 */
export function applySelfWeapon(def, kart) {
  if (def.boost) kart.state.boostTime = Math.max(kart.state.boostTime, def.boost);
  if (def.heal) kart.hp = Math.min(MAX_HP, kart.hp + def.heal);
}

export { applyImpulse };
