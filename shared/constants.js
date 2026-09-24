/**
 * Contract shared by the node server and the browser client.
 * Plain ESM with no dependencies so both runtimes can import the same file.
 */

export const EVENT = Object.freeze({
  // client → server
  JOIN: 'player:join',
  INPUT: 'player:input',
  LEAVE: 'player:leave',
  CHEAT: 'player:cheat',

  // client → server, private-room lobby only
  START: 'room:start',
  CONFIG: 'room:config',

  // server → client
  WELCOME: 'player:welcome',
  SNAPSHOT: 'world:snapshot',
  EVENTS: 'world:events',
  /** Waiting-room state: who is here, what the host has picked. */
  LOBBY: 'room:lobby',
  /** The host pressed start; the match is now live. */
  STARTED: 'room:started',
  ERROR: 'error',
});

/**
 * A room is either gathering players or running a match.
 *
 * Quick-play rooms are born PLAYING and never gather — clicking Play means you
 * want to drive, not to wait. Private rooms are born in LOBBY so the host can
 * see who has turned up before starting. Anyone arriving at a PLAYING room
 * joins mid-match, whichever kind it is.
 */
export const ROOM_STATUS = Object.freeze({
  LOBBY: 'lobby',
  PLAYING: 'playing',
});

export const MAP_IDS = Object.freeze(['gravelPit', 'skyPinball', 'beybladeArena']);
export const DEFAULT_MAP_ID = 'gravelPit';

/** How a player wants to be placed into a match. */
export const JOIN_MODE = Object.freeze({
  /** Drop into any public match with room in it. */
  QUICK: 'quick',
  /** Open a fresh private match and get a code to invite people to. */
  PRIVATE: 'private',
  /** Join a specific match by its code. */
  CODE: 'code',
});

/**
 * Room codes get typed in and read aloud, so the alphabet leaves out every
 * pair that looks alike: no O/0, no I/1, no S/5.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
export const ROOM_CODE_LENGTH = 5;

/**
 * Normalises whatever the player typed or pasted: codes get shared over chat,
 * so accept lower case and any spaces or dashes that came along with it.
 *
 * Deliberately no fuzzy matching of lookalike characters. The alphabet already
 * excludes every confusable pair, and quietly "correcting" a typo into a
 * different valid code would drop someone into a stranger's private match.
 */
export function normalizeRoomCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 15;
export const DEFAULT_MAX_PLAYERS = 8;

/** Simulation runs at 60 Hz; snapshots go out at 20 Hz. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_MS = 1000 / SNAPSHOT_HZ;

/**
 * How far in the past clients render remote karts.
 *
 * This is a *time* buffer, but players experience it as a *distance*: at the
 * 38 m/s boost ceiling a fixed 110 ms puts a rival 4.2 m behind where the
 * server has them, and on the spinning dish the floor alone carries everyone
 * fast enough that the gap never closes. So rather than one number tuned on a
 * localhost connection, the client measures the jitter its own link actually
 * has and buys only as much buffer as that link needs.
 *
 * The floor is just over one snapshot interval — below that there is routinely
 * no newer snapshot to interpolate toward, and playback stalls.
 */
export const INTERP_MIN_MS = 55;
export const INTERP_MAX_MS = 260;
/** Starting point before enough snapshots have arrived to measure anything. */
export const INTERP_START_MS = 110;

export const MAX_HP = 100;
export const RESPAWN_DELAY = 2.0;
export const SPAWN_INVULN = 2.5;

/**
 * Hidden cheats, triggered by Shift + a number row key. Nothing in the UI
 * mentions these and nothing hints at them in game.
 *
 * They are applied by the server like every other effect, because the client
 * is not trusted to decide anything — but note that this also means the wire
 * event is all anyone needs to trigger one. It is obscurity, not security:
 * fine for a party game, and worth gating behind a room flag if these matches
 * ever become competitive.
 */
export const CHEAT = Object.freeze({
  INVINCIBLE: 1,
  INVISIBLE: 2,
  HOP: 3,
  SPEED: 4,
  POWERUP: 5,
});

export const CHEAT_CODES = Object.freeze(Object.values(CHEAT));

/** Seconds each timed cheat lasts. */
export const CHEAT_DURATION = 5.0;
/** Upward speed for the one-shot hop, in m/s. */
export const CHEAT_HOP_SPEED = 22;
/** Minimum gap between uses of the same cheat, so a held key cannot spam it. */
export const CHEAT_COOLDOWN = 0.6;

export function clampMaxPlayers(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(v)));
}

/** Inputs travel as a single byte so we can afford one command per sim step. */
export const KEY = Object.freeze({
  FORWARD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  DRIFT: 16,
  FIRE: 32,
});

export function packInput(i) {
  return (i.forward ? KEY.FORWARD : 0)
    | (i.back ? KEY.BACK : 0)
    | (i.left ? KEY.LEFT : 0)
    | (i.right ? KEY.RIGHT : 0)
    | (i.drift ? KEY.DRIFT : 0)
    | (i.fire ? KEY.FIRE : 0);
}

export function unpackInput(bits, out) {
  out.forward = !!(bits & KEY.FORWARD);
  out.back = !!(bits & KEY.BACK);
  out.left = !!(bits & KEY.LEFT);
  out.right = !!(bits & KEY.RIGHT);
  out.drift = !!(bits & KEY.DRIFT);
  out.fire = !!(bits & KEY.FIRE);
  return out;
}

/** Kart body colours, indexed by join order. */
export const KART_COLORS = Object.freeze([
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6,
  0xe67e22, 0x1abc9c, 0xff7bac, 0x00cec9, 0xa29bfe,
  0x55efc4, 0xff7675, 0x74b9ff, 0xffeaa7, 0xb2bec3,
]);
