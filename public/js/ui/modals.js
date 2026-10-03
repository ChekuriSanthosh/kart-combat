/**
 * In-match modals: the settings menu (Esc or the gear) and the invite card.
 *
 * Both sit outside #hud in the page so they stack above the fullscreen button
 * and take real pointer events; the HUD itself is click-through so that clicks
 * reach the game. While either is open the match keeps running underneath —
 * it is multiplayer, nothing can pause — but driving input is held off so
 * ticking a checkbox with the keyboard does not also steer the kart.
 */

import { settings, setSetting, onSettings } from '../settings.js';

/**
 * A `.tk-modal` overlay: open/close, close on its X, on a click on the dimmed
 * backdrop, and report every change so the caller can release held keys.
 */
function createModal(el, onChange) {
  const card = el.querySelector('.tk-modal__card');
  let open = false;
  let returnFocus = null;

  function set(next) {
    if (next === open) return;
    open = next;
    el.classList.toggle('hidden', !open);
    if (open) {
      returnFocus = document.activeElement;
      // First button that is not the close X, so Enter does the obvious thing.
      (card.querySelector('[data-autofocus]') || card.querySelector('button'))?.focus({ preventScroll: true });
    } else if (returnFocus && document.contains(returnFocus)) {
      returnFocus.focus?.({ preventScroll: true });
    }
    onChange(open);
  }

  el.querySelector('.tk-modal__close')?.addEventListener('click', () => set(false));
  el.addEventListener('pointerdown', (e) => { if (e.target === el) set(false); });

  return {
    get open() { return open; },
    show() { set(true); },
    hide() { set(false); },
    toggle() { set(!open); },
  };
}

/**
 * @param {object} opts
 * @param {() => boolean} opts.inMatch       only answer Esc while actually driving
 * @param {(open: boolean) => void} opts.onOpenChange
 * @param {() => void} opts.onQuit
 */
export function createMatchModals({ inMatch, onOpenChange, onQuit }) {
  const settingsEl = document.getElementById('settings');
  const shareEl = document.getElementById('share');
  let anyOpen = false;

  const changed = () => {
    const next = settingsModal.open || shareModal.open;
    if (next === anyOpen) return;
    anyOpen = next;
    onOpenChange(next);
  };
  const settingsModal = createModal(settingsEl, changed);
  const shareModal = createModal(shareEl, changed);

  // ── Settings toggles: one checkbox per setting, kept in sync both ways ──
  const boxes = {
    minimiseLeaderboard: document.getElementById('set-minimise'),
    cameraTilt: document.getElementById('set-tilt'),
    showStats: document.getElementById('set-stats'),
  };
  for (const [key, box] of Object.entries(boxes)) {
    if (!box) continue;
    box.checked = !!settings[key];
    box.addEventListener('change', () => setSetting(key, box.checked));
  }
  onSettings(({ key, value }) => {
    if (boxes[key]) boxes[key].checked = !!value;
  });

  document.getElementById('btn-resume')?.addEventListener('click', () => settingsModal.hide());
  document.getElementById('btn-quit')?.addEventListener('click', () => onQuit());
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    shareModal.hide();
    settingsModal.toggle();
  });
  document.getElementById('btn-invite')?.addEventListener('click', () => {
    settingsModal.hide();
    shareModal.toggle();
  });

  // Esc is the original's menu key: it opens the menu and closes it again.
  // An open invite card is closed first, like any other popup.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !inMatch()) return;
    e.preventDefault();
    if (shareModal.open) shareModal.hide();
    else settingsModal.toggle();
  });

  return {
    /** True while a modal is up, so driving input should be ignored. */
    get open() { return anyOpen; },
    closeAll() {
      settingsModal.hide();
      shareModal.hide();
    },
  };
}
