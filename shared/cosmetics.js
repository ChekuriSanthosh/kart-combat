/**
 * Characters and karts players can pick.
 *
 * Shared by both ends: the server validates a choice against these tables so a
 * client cannot claim a cosmetic that does not exist, and the browser builds
 * meshes from the same ids. Definitions carry no geometry — only what a thing
 * *is* — so the renderer stays the single place that knows how to draw one.
 *
 * The drivers are chibi animals: a toy-box cast reads at a glance, and an
 * animal is recognisable from its ears and colouring alone, which is all a
 * chase camera ever shows of a rival. They are our own characters with our own
 * names — a recognisable likeness of somebody else's mascot would be their
 * property sitting on a public server.
 *
 * Colours are listed here rather than in the renderer so menus can draw a
 * swatch or tile for a character without building its mesh:
 *   skin    the head and ears
 *   detail  muzzle, face mask, belly or inner ear — the lighter second tone
 *   accent  the driver's top and sleeves
 */

export const CHARACTERS = Object.freeze({
  panda: {
    id: 'panda', name: 'Dumpling',
    blurb: 'Eats bamboo, drinks oil, brakes for nobody.',
    skin: 0xf7f7f4, detail: 0x1d1f24, accent: 0xe8413a,
  },
  frog: {
    id: 'frog', name: 'Sir Ribbit',
    blurb: 'Hops the queue, then the kerb, then you.',
    skin: 0x62cf43, detail: 0xd9f59a, accent: 0xffb21f,
  },
  mouse: {
    id: 'mouse', name: 'Squeakers',
    blurb: 'Small, fast and absolutely sure that cheese is fuel.',
    skin: 0xb7bcc9, detail: 0xf3eef0, accent: 0x2f8ff0,
  },
  cat: {
    id: 'cat', name: 'Captain Whiskers',
    blurb: 'Lands on four wheels. Usually someone else’s.',
    skin: 0xff9f2e, detail: 0xfff3e2, accent: 0x7b5cf0,
  },
  bunny: {
    id: 'bunny', name: 'Hopscotch',
    blurb: 'Ears are the aerodynamics. Do not ask about the drag.',
    skin: 0xf6f1ee, detail: 0xffb3c8, accent: 0x29c4b0,
  },
  fox: {
    id: 'fox', name: 'Rusty',
    blurb: 'Takes the shortcut you did not know the arena had.',
    skin: 0xf26a1b, detail: 0xfff4e6, accent: 0x2f5fd0,
  },
  monkey: {
    id: 'monkey', name: 'Bananas',
    blurb: 'Throws the peel, misses, drives over it anyway.',
    skin: 0x8a5532, detail: 0xf4cc9e, accent: 0xffd23f,
  },
  penguin: {
    id: 'penguin', name: 'Waddles',
    blurb: 'Cannot fly. Has made peace with driving very fast instead.',
    skin: 0x283452, detail: 0xffffff, accent: 0xff5a3c,
  },
});

/**
 * Every chassis is the same class of machine — a low go-kart with a rounded
 * nose, two-tone side panels, a dark floor tray and a cluster of exhausts at
 * the back — and differs in silhouette, because a rival is only ever seen
 * from behind at speed.
 *
 *   wheel      rear tyre radius in metres (the fronts are smaller)
 *   accent     the second paint colour, fixed per chassis so the player's own
 *              colour always sits next to the same contrasting trim
 *   accentAlt  used instead when the player's colour is too close to `accent`
 *              to tell apart
 */
export const KARTS = Object.freeze({
  classic: {
    id: 'classic', name: 'Runabout',
    blurb: 'The one everybody learns on. Honest, quick, four loud pipes.',
    wheel: 0.38, accent: 0x2a6ff0, accentAlt: 0xff5a3c,
  },
  monster: {
    id: 'monster', name: 'Stomper',
    blurb: 'Enormous tyres. Drives over things it should go around.',
    wheel: 0.56, accent: 0xffc21a, accentAlt: 0x2a6ff0,
  },
  hotrod: {
    id: 'hotrod', name: 'Flatline',
    blurb: 'Long nose, fat pipes, a wing, and no subtlety whatsoever.',
    wheel: 0.44, accent: 0xf4f6f8, accentAlt: 0x2b2f36,
  },
  bubble: {
    id: 'bubble', name: 'Pod',
    blurb: 'A bumper car that escaped the fairground. Deceptively nimble.',
    wheel: 0.24, accent: 0xffd23f, accentAlt: 0x2a6ff0,
  },
  tractor: {
    id: 'tractor', name: 'Harvester',
    blurb: 'Built for the back forty. Huge back wheels, one tall stack.',
    wheel: 0.62, accent: 0xffc21a, accentAlt: 0x45b85a,
  },
  rocket: {
    id: 'rocket', name: 'Sledge',
    blurb: 'One big jet, two fins, far too keen to leave the ground.',
    wheel: 0.34, accent: 0xf4f6f8, accentAlt: 0x2a6ff0,
  },
});

export const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTERS));
export const KART_IDS = Object.freeze(Object.keys(KARTS));

export const DEFAULT_CHARACTER = 'panda';
export const DEFAULT_KART = 'classic';

/**
 * Cosmetics are chosen by clients, so every id crossing the wire is checked
 * against the table rather than trusted. An unknown id falls back to the
 * default instead of erroring — a player with a stale build, or a look saved
 * in localStorage before the cast changed, should still get into the match,
 * just not with a kart nobody else can draw.
 */
export function validCharacter(id) {
  return Object.prototype.hasOwnProperty.call(CHARACTERS, id) ? id : DEFAULT_CHARACTER;
}

export function validKart(id) {
  return Object.prototype.hasOwnProperty.call(KARTS, id) ? id : DEFAULT_KART;
}
