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

  /** Change your display name after joining — see the waiting room. */
  RENAME: 'player:rename',
  /** Change character / kart after joining. */
  CUSTOMIZE: 'player:customize',
  /**
   * "Put me back in", with no payload. Sent after a wreck once the spectate
   * countdown has run out (the "Press Any Key" prompt), and from the
   * between-rounds intermission ("Press Space to join"). The server ignores
   * it at any other moment, so mashing keys while dead cannot skip the wait.
   * A separate event rather than an input bit because it is a one-off request,
   * not something held down 60 times a second.
   */
  RESPAWN: 'player:respawn',

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
  /** Time is up: final standings, and how long until the next match. */
  MATCH_OVER: 'match:over',
  /** The winners screen is done; a fresh match has begun. */
  MATCH_START: 'match:start',
  ERROR: 'error',
});

/**
 * A room is either gathering players or running a match.
 *
 * Quick-play rooms are born PLAYING and never gather — clicking Play means you
 * want to drive, not to wait. Private rooms are born in LOBBY so the host can
 * see who has turned up before starting. Anyone arriving at a PLAYING room
 * joins mid-match, whichever kind it is.
 *
 * A match then loops lobby → playing → roundOver → results → playing. Only
 * PLAYING counts: outside it nobody can fire, pick up a crate, take damage or
 * score, so the standings everyone is reading cannot change under them.
 */
export const ROOM_STATUS = Object.freeze({
  LOBBY: 'lobby',
  PLAYING: 'playing',
  /** The whistle has gone: a short "ROUND OVER" beat over the live arena. */
  ROUND_OVER: 'roundOver',
  /** Winners on screen, standings frozen, next match counting down. */
  RESULTS: 'results',
});

/** Match lengths the host can pick, in seconds. */
export const MATCH_LENGTHS = Object.freeze([120, 180, 300, 600]);
export const DEFAULT_MATCH_SECONDS = 180;
/**
 * How long "ROUND OVER" holds before the winners are named. Long enough to
 * read, short enough that nobody wonders whether the game froze. (Inferred
 * from the original; it was never timed exactly.)
 */
export const ROUND_OVER_SECONDS = 3;
/** How long the winners stay up before the next match begins ("New Round Starting In 12"). */
export const RESULTS_SECONDS = 12;

export function clampMatchSeconds(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_MATCH_SECONDS;
  // Snap to the offered lengths rather than trusting an arbitrary number from
  // a client — the list is what the UI can display sensibly.
  return MATCH_LENGTHS.includes(v) ? v : DEFAULT_MATCH_SECONDS;
}

export const MAP_IDS = Object.freeze(['gravelPit', 'skyPinball', 'beybladeArena', 'harvestHollow']);
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

/**
 * Being wrecked runs in three beats, the same as the original:
 *
 *   1. DEATH_CAM_SECONDS  the camera holds on your wreck and the death message
 *                         says who got you;
 *   2. RESPAWN_COUNTDOWN  the camera follows your killer with a big 3, 2, 1;
 *   3. "Press Any Key"    you choose when to drop back in (EVENT.RESPAWN).
 *
 * The server only honours a respawn request once both timed beats are over,
 * and puts an idle player back by itself after AUTO_RESPAWN_SECONDS so a tab
 * left in the background does not sit dead for the rest of the round.
 */
export const DEATH_CAM_SECONDS = 1.5;
export const RESPAWN_COUNTDOWN = 3;
export const AUTO_RESPAWN_SECONDS = 10;
/**
 * Bots have no key to press, so they come back as soon as the countdown ends,
 * plus up to this much random delay — otherwise every bot caught in the same
 * blast would reappear on the same frame.
 */
export const BOT_RESPAWN_JITTER = 0.6;
/** Spawn protection (the green bubble), in seconds. */
export const SPAWN_INVULN = 3.0;

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
