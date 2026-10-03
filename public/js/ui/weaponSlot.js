/**
 * The round weapon slot in the bottom-right corner.
 *
 * Picking something up spins through the whole arsenal for a beat before
 * landing on what you actually got, which is what makes opening a crate feel
 * like a reward rather than a silent state change. The count badge shows ammo
 * left, or whole seconds left once a timed weapon is running (`wn`).
 */

import { WEAPONS } from '/shared/weapons.js';
import { weaponIcon } from './icons.js';

const ROULETTE_TIME = 0.85;
/** How long the weapon's name stays up after the roulette lands. */
const NAME_SECONDS = 1.4;

/**
 * A server may hand out a weapon this client has no definition for yet (the
 * server and client are deployed together, but a stale tab is not). Draw it
 * as something rather than throwing on `def.name`.
 */
function defFor(id) {
  return WEAPONS[id] || { id, name: id, glyph: '?' };
}

export function createWeaponSlot({ slotEl, iconEl, countEl, nameEl }) {
  const pool = Object.values(WEAPONS);
  const roulette = { left: 0, tick: 0, shown: null };
  let held = null;
  let count = 0;
  let timed = false;
  let drawn;
  let nameLeft = 0;

  function draw(def) {
    if (def === drawn) return;
    drawn = def;
    const art = def ? weaponIcon(def.id) : null;
    if (art) iconEl.innerHTML = art;
    else iconEl.textContent = def ? def.glyph || '?' : '';
    slotEl.classList.toggle('armed', !!def);
  }

  function showBadge() {
    const visible = count > 0 && held && roulette.left <= 0;
    countEl.classList.toggle('hidden', !visible);
    if (visible) countEl.textContent = String(count);
    countEl.classList.toggle('timed', !!visible && timed);
  }

  function land() {
    roulette.left = 0;
    iconEl.classList.remove('spinning');
    iconEl.classList.remove('landed');
    // Reflow so the landing animation restarts even if it ran a moment ago.
    void iconEl.offsetWidth;
    iconEl.classList.add('landed');
    nameLeft = NAME_SECONDS;
    nameEl.classList.add('show');
  }

  return {
    /** A crate was opened by the local player. */
    startRoulette() {
      roulette.left = ROULETTE_TIME;
      roulette.tick = 0;
      iconEl.classList.remove('landed');
      iconEl.classList.add('spinning');
      nameEl.classList.remove('show');
      showBadge();
    },

    /** Latest authoritative slot state for the local player. */
    set({ w = null, wn = 0, wt = 0 } = {}) {
      const def = w ? defFor(w) : null;
      if (def?.id !== held?.id) {
        held = def;
        nameEl.textContent = held ? held.name : 'Empty';
      }
      count = Number(wn) || 0;
      timed = wt === 1;
      showBadge();
    },

    frame(dt) {
      let def = held;
      if (roulette.left > 0) {
        if (!held) {
          // Fired, lost or dead before the spin finished. Without this the
          // empty slot kept the infinite spinning animation until the next
          // pickup, because only a held weapon could ever end the roulette.
          roulette.left = 0;
          iconEl.classList.remove('spinning');
        } else {
          roulette.left -= dt;
          roulette.tick -= dt;
          if (roulette.tick <= 0) {
            // Slow the cycle down as it settles, like a slot machine.
            const progress = 1 - roulette.left / ROULETTE_TIME;
            roulette.tick = 0.04 + progress * progress * 0.16;
            roulette.shown = pool[Math.floor(Math.random() * pool.length)];
          }
          def = roulette.shown || held;
          if (roulette.left <= 0) {
            def = held;
            land();
            showBadge();
          }
        }
      }
      draw(def);

      if (nameLeft > 0) {
        nameLeft -= dt;
        if (nameLeft <= 0 || !held) {
          nameLeft = 0;
          nameEl.classList.remove('show');
        }
      }
    },
  };
}
