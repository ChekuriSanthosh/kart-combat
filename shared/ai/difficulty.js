/**
 * What "low", "medium" and "high" actually mean for a bot.
 *
 * Every difference lives in this one table rather than being scattered through
 * the driving code as `if (hard)` branches, so a tier is readable as a whole
 * and tuning one number cannot quietly change another tier.
 *
 * The tiers differ along four lines:
 *
 *   Navigation  every tier routes around scenery — a bot wedged against a wall
 *               is a broken bot, not an easy one — but a low bot re-plans
 *               lazily and drives the line sloppily, so it still loses ground
 *               around obstacles that a high bot takes cleanly.
 *   Aim         a low bot points at where you are; a high bot solves where you
 *               will be and holds fire until the shot is clean.
 *   Reaction    how long it takes to notice and respond to a new situation.
 *   Judgement   whether it picks a sensible target, and whether it uses its
 *               buffs at a sensible moment.
 */

export const DIFFICULTY_IDS = Object.freeze(['low', 'medium', 'high']);
export const DEFAULT_DIFFICULTY = 'medium';

const TIERS = Object.freeze({
  low: {
    id: 'low',
    label: 'Easy',

    /** Fraction of the solved intercept applied. 0 = aim at where you are. */
    lead: 0,
    /** Half-angle of the firing cone, radians. Wider = sprays. */
    fireCone: 0.42,
    /** Random aim error, radians, resampled on `aimJitterInterval`. */
    aimError: 0.22,
    aimJitterInterval: 0.35,
    /** Does it check the shot is not blocked by scenery before firing? */
    checkLineOfFire: false,
    /** Beyond this range it will not bother shooting. */
    fireRange: 34,

    /** Seconds before reacting to a new target or a changed situation. */
    reaction: 0.55,
    /** How often it reconsiders who to attack. */
    retarget: [1.6, 2.6],

    /** Use A* when the straight line to the goal is blocked? */
    usePathfinding: true,
    /** How often a path may be recomputed, seconds. Lazy: it commits to a
     *  stale route long after a better one exists. */
    repathInterval: 1.2,

    /** Crates further than this are not worth the detour. */
    crateRange: 26,
    /** Weight on target health when choosing prey; 0 = ignores health. */
    finisherBias: 0,
    /** Keeps its distance when hurt rather than trading blows. */
    retreatBelowHp: 0,
    /** Chance per second of using a held self-buff at a sensible moment. */
    buffDiscipline: 0.3,

    /** Steering wobble amplitude, radians. Sloppy driving. */
    wobble: 0.3,
    /** Throttle ceiling as a fraction of top speed. */
    throttle: 0.82,
  },

  medium: {
    id: 'medium',
    label: 'Normal',

    lead: 0.6,
    fireCone: 0.24,
    aimError: 0.09,
    aimJitterInterval: 0.5,
    checkLineOfFire: true,
    fireRange: 42,

    reaction: 0.28,
    retarget: [1.0, 1.8],

    usePathfinding: true,
    repathInterval: 0.7,

    crateRange: 40,
    finisherBias: 0.4,
    retreatBelowHp: 25,
    buffDiscipline: 0.8,

    wobble: 0.14,
    throttle: 0.93,
  },

  high: {
    id: 'high',
    label: 'Hard',

    // Full intercept solution, a cone barely wider than the kart it is
    // shooting at, and it will not fire through scenery.
    lead: 1,
    fireCone: 0.11,
    aimError: 0.02,
    aimJitterInterval: 0.8,
    checkLineOfFire: true,
    fireRange: 55,

    reaction: 0.1,
    retarget: [0.5, 1.0],

    usePathfinding: true,
    repathInterval: 0.35,

    crateRange: 999,
    finisherBias: 1,
    retreatBelowHp: 40,
    buffDiscipline: 1,

    wobble: 0.04,
    throttle: 1,
  },
});

export function getDifficulty(id) {
  return TIERS[id] || TIERS[DEFAULT_DIFFICULTY];
}

export function isDifficulty(id) {
  return Object.prototype.hasOwnProperty.call(TIERS, id);
}
