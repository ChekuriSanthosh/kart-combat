/**
 * Characters and karts players can pick.
 *
 * Shared by both ends: the server validates a choice against these tables so a
 * client cannot claim a cosmetic that does not exist, and the browser builds
 * meshes from the same ids. Definitions carry no geometry — only what a thing
 * *is* — so the renderer stays the single place that knows how to draw one.
 *
 * These are original archetypes rather than characters from existing games or
 * films. A recognisable likeness would be someone else's property sitting on
 * a public server, and the silhouettes below do the same job: each one has to
 * be identifiable at fifty metres from behind, which is the only angle anyone
 * ever sees a rival kart from.
 */

export const CHARACTERS = Object.freeze({
  rooster: {
    id: 'rooster', name: 'Cluck Norris',
    blurb: 'Farmyard menace. Crows at anything that overtakes him.',
    skin: 0xf2b134, accent: 0xd93b3b,
  },
  astronaut: {
    id: 'astronaut', name: 'Commander Vex',
    blurb: 'Flew to orbit twice. Still cannot parallel park.',
    skin: 0xe8e8ee, accent: 0x3da5ff,
  },
  robot: {
    id: 'robot', name: 'Unit-7',
    blurb: 'Calculates the racing line. Ignores it anyway.',
    skin: 0xb8c0c9, accent: 0x66ffcc,
  },
  bandit: {
    id: 'bandit', name: 'Dusty Rhodes',
    blurb: 'Wanted in four counties, mostly for overtaking.',
    skin: 0xc98a5e, accent: 0x8d2f2f,
  },
  diver: {
    id: 'diver', name: 'Marina Deep',
    blurb: 'Brought a snorkel to a desert arena. No regrets.',
    skin: 0x6fd0c4, accent: 0xffcc33,
  },
  knight: {
    id: 'knight', name: 'Sir Clank',
    blurb: 'Full plate armour. Terrible power-to-weight ratio.',
    skin: 0xd6dbe2, accent: 0x7b4fd6,
  },
});

export const KARTS = Object.freeze({
  classic: {
    id: 'classic', name: 'Runabout',
    blurb: 'The one everybody learns on. Honest and quick.',
    wheel: 0.42, ride: 0.0, wide: 1.0,
  },
  monster: {
    id: 'monster', name: 'Stomper',
    blurb: 'Enormous tyres. Drives over things it should go around.',
    wheel: 0.72, ride: 0.42, wide: 1.16,
  },
  hotrod: {
    id: 'hotrod', name: 'Flatline',
    blurb: 'Long nose, loud pipes, no subtlety whatsoever.',
    wheel: 0.46, ride: -0.08, wide: 0.94,
  },
  bubble: {
    id: 'bubble', name: 'Pod',
    blurb: 'A rounded little bubble on castors. Deceptively nimble.',
    wheel: 0.34, ride: -0.04, wide: 0.9,
  },
  tractor: {
    id: 'tractor', name: 'Harvester',
    blurb: 'Built for the back forty. Somehow keeps up.',
    wheel: 0.66, ride: 0.3, wide: 1.1,
  },
  rocket: {
    id: 'rocket', name: 'Sledge',
    blurb: 'Finned, ducted and far too keen to leave the ground.',
    wheel: 0.38, ride: -0.02, wide: 0.98,
  },
});

export const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTERS));
export const KART_IDS = Object.freeze(Object.keys(KARTS));

export const DEFAULT_CHARACTER = 'rooster';
export const DEFAULT_KART = 'classic';

/**
 * Cosmetics are chosen by clients, so every id crossing the wire is checked
 * against the table rather than trusted. An unknown id falls back to the
 * default instead of erroring — a player with a stale build should still get
 * into the match, just not with a kart nobody else can draw.
 */
export function validCharacter(id) {
  return Object.prototype.hasOwnProperty.call(CHARACTERS, id) ? id : DEFAULT_CHARACTER;
}

export function validKart(id) {
  return Object.prototype.hasOwnProperty.call(KARTS, id) ? id : DEFAULT_KART;
}
