/**
 * Player preferences shared by the HUD, the camera and the settings screen.
 *
 * One live object rather than getters: readers on the frame loop (camera
 * tilt, leaderboard size) just look at `settings.x` every frame, and writers
 * go through setSetting so the change is saved and announced in one place.
 * Anything that has to react immediately (re-laying out the leaderboard,
 * ticking a checkbox on another screen) subscribes with onSettings.
 */

const STORAGE_KEY = 'kartcombat.settings';
const EVENT_NAME = 'kc:settings';

const DEFAULTS = Object.freeze({
  minimiseLeaderboard: true,
  cameraTilt: true,
  showStats: true,
});

/**
 * Stored values are only trusted for keys we know and only when they have
 * the default's type, so a stale or hand-edited entry cannot put a string
 * where the camera expects a boolean. localStorage can also throw outright
 * (private mode, blocked storage), in which case the defaults simply apply.
 */
function load() {
  const out = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(DEFAULTS)) {
        if (typeof raw[key] === typeof DEFAULTS[key]) out[key] = raw[key];
      }
    }
  } catch { /* unreadable storage: keep the defaults */ }
  return out;
}

export const settings = load();

export function setSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    console.warn(`[settings] unknown setting "${key}"`);
    return;
  }
  settings[key] = value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* not persisted, but still applies for this visit */ }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key, value } }));
}

/** Calls fn({ key, value }, settings) after every change. Returns the unsubscribe. */
export function onSettings(fn) {
  const listener = (e) => fn(e.detail, settings);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
