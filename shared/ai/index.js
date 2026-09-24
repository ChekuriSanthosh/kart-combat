/**
 * Bot driver.
 *
 * The loop is the one you would describe out loud: if I have no weapon, go get
 * one; if I have a weapon, hunt someone with it; if I am hurt and outgunned,
 * break off. What changes with difficulty is how well each of those is done —
 * see `difficulty.js` for the whole table of differences.
 *
 * Two pieces of machinery sit underneath:
 *
 *   A nav grid (`NavGrid.js`) built once per map from the collision solids.
 *   Bots try a straight line first, because in an open arena it is usually
 *   clear and it looks better; only when that line is blocked do they pay for
 *   an A* search around the scenery.
 *
 *   A flow field, rebuilt whenever the set of live crates changes. One
 *   multi-source Dijkstra gives every cell on the map its distance to the
 *   nearest crate and the direction to walk, so "find the closest crate,
 *   routing around walls" costs every bot a single array lookup instead of a
 *   search each.
 */

import { buildNavGrid, hasLineOfSight, findPath, buildFlowField } from './NavGrid.js';
import { aimAt, hasLineOfFire } from './aiming.js';
import { getDifficulty, DEFAULT_DIFFICULTY } from './difficulty.js';
import { WEAPONS } from '../weapons.js';
import { KART } from '../physics.js';

export { DIFFICULTY_IDS, DEFAULT_DIFFICULTY, getDifficulty, isDifficulty } from './difficulty.js';
export { buildNavGrid, findPath, hasLineOfSight, buildFlowField } from './NavGrid.js';
export { solveIntercept, aimAt, hasLineOfFire } from './aiming.js';

const TAU = Math.PI * 2;

/**
 * Nav grids are expensive to build (~100 ms) and never change, so one is
 * cached per map and shared by every bot and every room on that map.
 */
const navCache = new Map();

export function getNavGrid(map) {
  let grid = navCache.get(map.id);
  if (!grid) {
    grid = buildNavGrid(map);
    navCache.set(map.id, grid);
  }
  return grid;
}

/**
 * Crate flow field for a room, rebuilt only when the live crate set changes.
 * Keyed by which crates are alive, so a rebuild happens on pickup and respawn
 * and at no other time.
 */
export function getCrateField(map, boxes, cache) {
  let key = 0;
  let live = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i].alive) { key |= (1 << (i % 31)); live++; }
  }
  if (cache.field && cache.key === key) return cache.field;

  cache.key = key;
  cache.field = live
    ? buildFlowField(getNavGrid(map), boxes.filter((b) => b.alive))
    : null;
  return cache.field;
}

export function createAiBrain(difficulty = DEFAULT_DIFFICULTY) {
  return {
    difficulty,
    targetId: null,
    retarget: 0,
    react: 0,
    wobble: 0,
    wobbleTimer: 0,
    aimJitter: 0,
    aimJitterTimer: 0,
    stuckTimer: 0,
    /** Consecutive wedges; escalates the recovery instead of repeating it. */
    stuckStreak: 0,
    /** Which way we were last trying to turn, so we back out the other way. */
    lastSteerSign: 0,
    reverseTimer: 0,
    reverseDir: 1,
    wander: null,
    path: null,
    pathAge: 0,
    goalX: 0,
    goalZ: 0,
  };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/**
 * @param {object}   bot     { id, state, brain, weapon, hp }
 * @param {object[]} rivals  all karts: { id, state, alive, isAi, hp }
 * @param {object}   map
 * @param {object}   inp     input object, mutated in place
 * @param {number}   dt
 * @param {object[]} [boxes] live mystery boxes
 * @param {object}   [fieldCache] per-room cache for the crate flow field
 */
export function driveAi(bot, rivals, map, inp, dt, boxes = null, fieldCache = null) {
  const b = bot.brain;
  const s = bot.state;
  const D = getDifficulty(b.difficulty);

  b.retarget -= dt;
  b.react -= dt;
  b.pathAge += dt;

  b.wobbleTimer -= dt;
  if (b.wobbleTimer <= 0) {
    b.wobbleTimer = 0.4 + Math.random() * 0.8;
    b.wobble = (Math.random() - 0.5) * D.wobble;
  }
  b.aimJitterTimer -= dt;
  if (b.aimJitterTimer <= 0) {
    b.aimJitterTimer = D.aimJitterInterval;
    b.aimJitter = (Math.random() - 0.5) * 2 * D.aimError;
  }

  // ── Wedged against something ──
  // Recovery is applied at the end of the function rather than here, because
  // backing out is only useful if it also turns the kart to face wherever it
  // was trying to go. That direction is not known until the goal has been
  // picked and routed, so the decision below just counts the wedge; the drive
  // section acts on it.
  if (b.reverseTimer > 0) b.reverseTimer -= dt;

  if (b.reverseTimer <= 0 && Math.abs(s.speed) < 2.5 && s.grounded) {
    b.stuckTimer += dt;
    if (b.stuckTimer > 0.7) {
      b.stuckTimer = 0;
      // Escalate: each failure in quick succession backs out for longer and
      // gives up on the current goal harder. Reversing for the same 0.9 s and
      // then driving at the same wall again is how a bot spends a whole match
      // grinding against one corner.
      b.stuckStreak = (b.stuckStreak || 0) + 1;
      b.reverseTimer = 0.7 + Math.min(3, b.stuckStreak) * 0.25;
      b.path = null; // whatever we were following did not work
      b.pathAge = Infinity; // force a fresh route rather than reusing the bad one
      if (b.stuckStreak >= 2) {
        // Twice in a row against the same thing: stop chasing this goal at all
        // and go somewhere else for a while.
        b.wander = null;
        b.targetId = null;
        b.retarget = 0;
      }
    }
  } else if (b.reverseTimer <= 0) {
    b.stuckTimer = 0;
    // Moving freely again, so the run of failures is over.
    if (b.stuckStreak && Math.abs(s.speed) > 6) b.stuckStreak = 0;
  }

  const weapon = bot.weapon ? WEAPONS[bot.weapon] : null;

  // ── Pick prey ──
  if (b.retarget <= 0) {
    const [lo, hi] = D.retarget;
    b.retarget = lo + Math.random() * (hi - lo);

    let best = null;
    let bestScore = -Infinity;
    for (const r of rivals) {
      if (r.id === bot.id || r.alive === false) continue;
      // Can't hunt what you can't see.
      if (r.invisTime > 0) continue;
      const dist = Math.hypot(r.state.x - s.x, r.state.z - s.z);
      // Close is good, humans are better, and a better bot would rather
      // finish someone already hurt than start a fresh fight.
      const hurt = D.finisherBias * (100 - (r.hp ?? 100)) * 0.35;
      const score = -dist + (r.isAi ? 0 : 25) + hurt;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (best && best.id !== b.targetId) {
      b.targetId = best.id;
      b.react = D.reaction;
      b.path = null;
    } else if (!best) {
      b.targetId = null;
    }
  }

  const target = b.targetId ? rivals.find((r) => r.id === b.targetId) : null;
  // A target that vanishes mid-chase is dropped rather than tracked blind, and
  // the bot looks for someone else on the next tick instead of waiting out the
  // rest of its retarget timer staring at nothing.
  const targetAlive = target && target.alive !== false && !(target.invisTime > 0);
  if (target && target.invisTime > 0) {
    b.targetId = null;
    b.retarget = 0;
  }
  const targetDist = targetAlive
    ? Math.hypot(target.state.x - s.x, target.state.z - s.z)
    : Infinity;

  // ── Decide where to go ──
  let goalX;
  let goalZ;
  /** Height of the goal, so routing snaps it to the right deck and not the
   *  floor underneath it. Undefined means "whatever surface is nearest". */
  let goalY;
  let goalIsCrate = false;
  /**
   * Whether this goal still needs routing around scenery. The crate flow field
   * has walls baked in already, so a goal that came from it is steered at
   * directly; everything else — chasing, retreating, wandering, and the
   * straight-line crate fallback — has to be checked for line of sight first.
   */
  let needsRoute = true;

  const hurt = (bot.hp ?? 100) < D.retreatBelowHp;

  if (!weapon && boxes && boxes.length) {
    // Unarmed: head for the nearest crate. The flow field already accounts for
    // walls, so "nearest" means nearest to drive to, not nearest as the crow
    // flies — which on these maps is often a different crate entirely.
    const field = fieldCache ? getCrateField(map, boxes, fieldCache) : null;
    if (field) {
      const dist = field.distanceFrom(s.x, s.z, s.y);
      if (dist <= D.crateRange) {
        const step = field.stepFrom(s.x, s.z, s.y);
        if (step && !step.arrived) {
          goalX = step.x;
          goalZ = step.z;
          goalIsCrate = true;
          needsRoute = false; // the field already routes around walls
        }
      }
    }
    if (!goalIsCrate) {
      // No field (or nothing worth crossing the map for): fall back to the
      // closest crate. This one is picked as the crow flies and may well be
      // behind a wall, so it is flagged for routing like any other goal.
      let bestD = D.crateRange;
      for (const box of boxes) {
        if (!box.alive) continue;
        const d = Math.hypot(box.x - s.x, box.z - s.z);
        if (d < bestD) {
          bestD = d;
          goalX = box.x;
          goalZ = box.z;
          goalY = box.y;
          goalIsCrate = true;
          needsRoute = true;
        }
      }
    }
  }

  if (!goalIsCrate) {
    if (targetAlive && !hurt) {
      goalX = target.state.x;
      goalZ = target.state.z;
      goalY = target.state.y;
    } else if (targetAlive && hurt) {
      // Hurt and still armed: keep range rather than trading hits head-on.
      const away = Math.atan2(s.x - target.state.x, s.z - target.state.z);
      goalX = s.x + Math.sin(away) * 20;
      goalZ = s.z + Math.cos(away) * 20;
    } else {
      if (!b.wander || Math.hypot(b.wander.x - s.x, b.wander.z - s.z) < 6) {
        const spawn = map.spawns[Math.floor(Math.random() * map.spawns.length)];
        b.wander = { x: spawn.x, z: spawn.z };
      }
      goalX = b.wander.x;
      goalZ = b.wander.z;
    }
  }

  // ── Route to it ──
  // Straight line first: cheaper, and it looks better than tracing a grid.
  let steerX = goalX;
  let steerZ = goalZ;

  if (D.usePathfinding && needsRoute) {
    const grid = getNavGrid(map);
    const direct = hasLineOfSight(grid, s.x, s.z, goalX, goalZ);

    if (direct) {
      b.path = null;
    } else {
      const goalMoved = Math.hypot(goalX - b.goalX, goalZ - b.goalZ) > 4;
      if (!b.path || goalMoved || b.pathAge > D.repathInterval) {
        b.path = findPath(grid, s.x, s.z, goalX, goalZ, { fromY: s.y, toY: goalY });
        b.pathAge = 0;
        b.goalX = goalX;
        b.goalZ = goalZ;
      }
    }

    if (b.path && b.path.length) {
      // Drop waypoints as we reach them, and skip any we can already see past.
      while (b.path.length > 1 && hasLineOfSight(grid, s.x, s.z, b.path[1].x, b.path[1].z)) {
        b.path.shift();
      }
      while (b.path.length && Math.hypot(b.path[0].x - s.x, b.path[0].z - s.z) < 2.2) {
        b.path.shift();
      }
      if (b.path.length) {
        steerX = b.path[0].x;
        steerZ = b.path[0].z;
      }
    }
  }

  // ── Aim ──
  // While a weapon is held and prey is in range, point the kart where the shot
  // needs to go. The kart has no turret, so aiming and steering are the same
  // control — which is why lining up a shot also drives you into the fight.
  let fireYaw = null;
  let aim = null;
  if (weapon && targetAlive && targetDist < D.fireRange) {
    aim = aimAt(weapon, bot, target, D.lead);
    if (aim) fireYaw = aim.yaw + b.aimJitter;
  }

  const desiredYaw = (fireYaw !== null ? fireYaw : Math.atan2(steerX - s.x, steerZ - s.z))
    + (fireYaw !== null ? 0 : b.wobble);
  const err = angleDiff(desiredYaw, s.yaw);
  const absErr = Math.abs(err);
  // Remembered so that if this turn is what wedges us, recovery knows which
  // way the obstacle was and backs out the other side.
  b.lastSteerSign = err > 0.06 ? 1 : err < -0.06 ? -1 : 0;

  // ── Drive ──
  const wantSpeed = KART.maxSpeed * D.throttle;
  inp.forward = Math.abs(s.speed) < wantSpeed;
  inp.back = false;
  inp.left = err > 0.06;
  inp.right = err < -0.06;
  // Ease off through very tight turns so bots do not grind along walls.
  if (absErr > 1.9 && Math.abs(s.speed) > 14) inp.forward = false;
  inp.drift = absErr > 0.55 && absErr < 1.6 && Math.abs(s.speed) > 12;

  // ── Unwedging overrides the drive ──
  // Steering authority ramps in with speed, so a kart crawling against a wall
  // has almost none and physically cannot turn away from it. Reversing is what
  // buys the speed back, and steering *while* reversing is what turns the nose
  // toward the route out — so the recovery reuses the real steering error
  // rather than a random direction. The steer is inverted because yaw response
  // flips sign below zero forward speed.
  if (b.reverseTimer > 0) {
    inp.forward = false;
    inp.back = true;
    inp.left = err < -0.06;
    inp.right = err > 0.06;
    inp.drift = false;
  }

  // ── Shoot ──
  inp.fire = false;
  if (weapon && b.react <= 0) {
    if (weapon.kind === 'self') {
      // Buffs are worth holding for the moment they matter: a shield or a
      // repair when hurt, a boost when there is ground to cover.
      const useful = weapon.id === 'repair'
        ? (bot.hp ?? 100) < 70
        : weapon.id === 'shield'
          ? targetAlive && targetDist < 22
          : targetDist > 18 || goalIsCrate;
      inp.fire = useful && Math.random() < D.buffDiscipline;
    } else if (weapon.kind === 'mine') {
      // Dropped behind, so it only pays off with someone on your tail.
      inp.fire = targetAlive && targetDist < 14 && Math.abs(s.speed) > 8;
    } else if (aim && absErr < D.fireCone) {
      const clear = !D.checkLineOfFire || hasLineOfFire(
        map.solids,
        s.x, s.y + 0.75, s.z,
        target.state.x, target.state.y + 0.75, target.state.z,
      );
      inp.fire = clear;
    }
  }

  return inp;
}
