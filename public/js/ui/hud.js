/**
 * The in-match HUD: everything drawn over the arena while you play.
 *
 * This module is only the view. main.js decides what is going on — alive,
 * dead, spectating, sitting a round out, round over — from snapshots and
 * events, and tells the HUD; the HUD turns that into DOM and never reads the
 * network or the scene itself. Setters remember what they last drew and skip
 * the DOM when nothing changed, because most of them run 20 or 60 times a
 * second.
 *
 * Layout follows the original: rank and leaderboard top-left, health and
 * clock top-centre, buttons and FPS/ping top-right, the round weapon slot
 * bottom-right, and nothing else permanently on screen.
 */

import { MAX_HP } from '/shared/constants.js';
import { settings, onSettings } from '../settings.js';
import { HUD_ICONS } from './icons.js';
import { createLeaderboard, ordinalSuffix } from './leaderboard.js';
import { createWeaponSlot } from './weaponSlot.js';
import { createConfetti } from './confetti.js';

const $ = (id) => document.getElementById(id);

/** How long the controls reminder stays up after the first spawn. */
const HINT_SECONDS = 8;
/** "You smashed X!" stays up this long. */
const SMASH_SECONDS = 1.6;
const hexColour = (n) => `#${(n ?? 0x888888).toString(16).padStart(6, '0')}`;

export function createHud() {
  const hudEl = $('hud');

  // ── Icons are inline SVG, filled in once ──
  for (const [selector, icon] of [
    ['#rank-pill .rank-icon', HUD_ICONS.podium],
    ['#health .heart-icon', HUD_ICONS.heart],
    ['#match-timer .clock-icon', HUD_ICONS.clock],
    ['#btn-settings', HUD_ICONS.gear],
    ['#btn-invite', HUD_ICONS.invite],
    ['#spectate-eye', HUD_ICONS.eye],
  ]) {
    const el = document.querySelector(selector);
    if (el) el.innerHTML = icon;
  }

  const board = createLeaderboard($('leaderboard-list'));
  const intermissionBoard = createLeaderboard($('im-list'));
  const slot = createWeaponSlot({
    slotEl: $('weapon'),
    iconEl: $('weapon-icon'),
    countEl: $('weapon-count'),
    nameEl: $('weapon-name'),
  });
  const confetti = createConfetti($('confetti'));

  const rankPos = $('rank-pos');
  const rankOrd = $('rank-ord');
  const rankCount = $('rank-count');
  const healthEl = $('health');
  const healthFill = $('health-fill');
  const healthText = $('health-text');
  const timerEl = $('match-timer');
  const clockEl = $('match-clock');
  const statsEl = $('net-stats');
  const fpsEl = $('stat-fps');
  const pingEl = $('stat-ping');
  const deathEl = $('death-msg');
  const deathLine1 = $('death-line1');
  const deathLine2 = $('death-line2');
  const spectateEl = $('spectate-count');
  const anyKeyEl = $('press-any-key');
  const eyeEl = $('spectate-eye');
  const vignetteEl = $('hit-vignette');
  const smashEl = $('smash-banner');
  const hintEl = $('hint');
  const resultsEl = $('results');
  const roundOverEl = $('round-over');
  const winnersEl = $('winners');
  const winnerEl = $('results-winner');
  const resultsListEl = $('results-list');
  const resultsNextEl = $('results-next');
  const resultsCountdownEl = $('results-countdown');
  const intermissionEl = $('intermission');
  const imArenaEl = $('im-arena');
  const imModeEl = $('im-mode');
  const infoEl = $('match-info');

  const last = {};
  /** Run `apply` only when `value` differs from what was last applied under `key`. */
  const changed = (key, value) => {
    if (last[key] === value) return false;
    last[key] = value;
    return true;
  };

  // ── Rank "i": keep the full board open; clock "i": what match is this? ──
  let boardPinned = false;
  $('btn-rank-info')?.addEventListener('click', () => {
    boardPinned = !boardPinned;
    $('btn-rank-info').classList.toggle('active', boardPinned);
  });
  let infoTimer = 0;
  $('btn-match-info')?.addEventListener('click', () => {
    infoEl.classList.toggle('hidden');
    clearTimeout(infoTimer);
    if (!infoEl.classList.contains('hidden')) {
      infoTimer = setTimeout(() => infoEl.classList.add('hidden'), 5000);
    }
  });

  // ── FPS / ping readout ──
  const applyStats = () => statsEl.classList.toggle('hidden', !settings.showStats);
  applyStats();
  onSettings(({ key }) => { if (key === 'showStats') applyStats(); });
  const fps = { frames: 0, time: 0 };

  let hintLeft = 0;
  let hintShown = false;
  let smashLeft = 0;

  return {
    /** True while the player has asked for the whole board to stay open. */
    get boardPinned() { return boardPinned; },

    /**
     * Which screen state we are in. `phase` is the round ('playing',
     * 'roundOver', 'results'); `life` is the local player ('alive', 'dead',
     * 'out' = sitting the round out); `stage` is how far through dying they
     * are ('wreck', 'spectate', 'continue').
     */
    setMode({ phase, life, stage = null, count = 0 }) {
      if (changed('phase', phase)) hudEl.dataset.phase = phase;
      if (changed('life', life)) hudEl.dataset.life = life;
      const dying = phase === 'playing' && life === 'dead';
      const deathStage = dying ? stage : null;
      if (changed('stage', deathStage)) {
        deathEl.classList.toggle('hidden', deathStage !== 'wreck');
        spectateEl.classList.toggle('hidden', deathStage !== 'spectate');
        anyKeyEl.classList.toggle('hidden', deathStage !== 'continue');
        eyeEl.classList.toggle('hidden', deathStage !== 'spectate' && deathStage !== 'continue');
      }
      if (deathStage === 'spectate' && changed('count', count)) {
        spectateEl.textContent = String(count);
        // Restart the pop on every new number.
        spectateEl.classList.remove('tick');
        void spectateEl.offsetWidth;
        spectateEl.classList.add('tick');
      }

      const roundEnd = phase === 'roundOver' || phase === 'results';
      if (changed('results', phase)) {
        resultsEl.classList.toggle('hidden', !roundEnd);
        roundOverEl.classList.toggle('hidden', phase !== 'roundOver');
        winnersEl.classList.toggle('hidden', phase !== 'results');
        resultsNextEl.classList.toggle('hidden', phase !== 'results');
        if (phase === 'results') confetti.start();
        else confetti.stop();
      }
      if (changed('intermission', life === 'out' && phase === 'playing')) {
        intermissionEl.classList.toggle('hidden', !(life === 'out' && phase === 'playing'));
      }
    },

    /** Where to draw the spectate countdown: a screen point above the followed kart. */
    setSpectateAnchor(point) {
      if (!point) {
        spectateEl.style.left = '';
        spectateEl.style.top = '';
        return;
      }
      spectateEl.style.left = `${point.x.toFixed(0)}px`;
      spectateEl.style.top = `${point.y.toFixed(0)}px`;
    },

    /**
     * @param {{i,n,c,sc}[]} list sorted best first (sc null = sitting out)
     * @param {string} localId
     * @param {{folded:boolean}} opts
     */
    setBoard(list, localId, { folded }) {
      const mine = board.render(list, localId, { folded });
      $('leaderboard').classList.toggle('folded', folded && list.length > 5);
      const pos = mine >= 0 ? mine + 1 : 0;
      if (changed('rank', `${pos}/${list.length}`)) {
        rankPos.textContent = pos ? String(pos) : '-';
        rankOrd.textContent = pos ? ordinalSuffix(pos) : '';
        rankCount.textContent = String(list.length);
      }
    },

    setIntermissionBoard(list, localId) {
      intermissionBoard.render(list, localId);
    },

    setHealth(hp) {
      const v = Math.max(0, Math.min(MAX_HP, Math.round(hp)));
      if (!changed('hp', v)) return;
      healthFill.style.width = `${(v / MAX_HP) * 100}%`;
      healthText.textContent = String(v);
      healthEl.classList.toggle('low', v > 0 && v <= MAX_HP * 0.3);
    },

    /** Whole seconds left, the way the original shows it: "177", not "2:57". */
    setClock(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      if (!changed('clock', s)) return;
      clockEl.textContent = String(s);
      timerEl.classList.toggle('urgent', s <= 10);
    },

    setWeapon(data) { slot.set(data); },
    startRoulette() { slot.startRoulette(); },

    setPing(ms) {
      const v = ms == null ? '–' : String(Math.max(1, Math.round(ms)));
      if (changed('ping', v)) pingEl.textContent = `PING: ${v}`;
    },

    /**
     * The two-line death message. `killer` is drawn in cyan; either line may
     * be empty (falling off the arena has no second line).
     */
    showDeath({ line1, killer = '', rest = '' }) {
      deathLine1.textContent = line1;
      deathLine2.replaceChildren();
      if (killer) {
        const k = document.createElement('span');
        k.className = 'killer';
        k.textContent = killer;
        deathLine2.append(k);
      }
      if (rest) deathLine2.append(document.createTextNode(killer ? ` ${rest}` : rest));
      deathLine2.classList.toggle('hidden', !killer && !rest);
    },

    /** Red flash round the screen edge when the local kart takes damage. */
    flashHit(damage) {
      vignetteEl.style.transition = 'none';
      vignetteEl.style.opacity = String(Math.min(1, 0.5 + (damage || 0) / 60));
      void vignetteEl.offsetWidth;
      vignetteEl.style.transition = '';
      vignetteEl.style.opacity = '0';
      healthEl.classList.remove('hit');
      void healthEl.offsetWidth;
      healthEl.classList.add('hit');
    },

    /** "You smashed <name>!" when the local player scores. */
    smash(name) {
      smashEl.replaceChildren(
        document.createTextNode('You smashed '),
        Object.assign(document.createElement('span'), { className: 'killer', textContent: name }),
        document.createTextNode('!'),
      );
      smashEl.classList.remove('hidden', 'pop');
      void smashEl.offsetWidth;
      smashEl.classList.add('pop');
      smashLeft = SMASH_SECONDS;
    },

    /**
     * Fill the round-end screens. Shown and hidden by setMode; this only
     * changes what they say.
     *
     * @param {{ standings:object[], winners:Set<string>, localId:string }} r
     */
    setResults({ standings, winners, localId }) {
      const names = standings.filter((p) => winners.has(p.i));
      winnerEl.replaceChildren();
      const title = document.createElement('span');
      title.className = 'winners-title';
      if (names.length) {
        title.textContent = 'Winners Are';
        winnerEl.append(title);
        for (const p of names) {
          const n = document.createElement('span');
          n.className = 'winner-name';
          if (p.i === localId) n.classList.add('me');
          n.textContent = p.n;
          // Text nodes between the blocks keep textContent readable
          // ("Winners Are Speedy Zoom") for tests and screen readers.
          winnerEl.append(document.createTextNode(' '), n);
        }
      } else {
        title.textContent = 'No winners this time';
        winnerEl.append(title);
      }

      resultsListEl.replaceChildren();
      for (const p of standings) {
        const li = document.createElement('li');
        if (winners.has(p.i)) li.classList.add('first');
        if (p.i === localId) li.classList.add('me');
        const rank = Object.assign(document.createElement('span'), { className: 'rank', textContent: String(p.rank ?? '') });
        const swatch = Object.assign(document.createElement('span'), { className: 'swatch' });
        swatch.style.background = hexColour(p.c);
        const name = Object.assign(document.createElement('span'), { className: 'name', textContent: p.n });
        const pts = Object.assign(document.createElement('span'), { className: 'pts', textContent: String(p.sc) });
        li.append(rank, document.createTextNode(' '), swatch, name, document.createTextNode(' '), pts);
        resultsListEl.appendChild(li);
      }
    },

    setResultsCountdown(seconds) {
      const s = String(Math.max(0, Math.ceil(seconds)));
      if (changed('next', s)) resultsCountdownEl.textContent = s;
    },

    /** Arena, mode and match length for the intermission card and the info popup. */
    setMatchInfo({ arena, minutes, botsLabel, botsColour, code }) {
      const mins = `${minutes} Min${minutes === 1 ? '' : 's'}`;
      imArenaEl.textContent = arena;
      imModeEl.replaceChildren(
        Object.assign(document.createElement('span'), { textContent: 'Free For All' }),
        Object.assign(document.createElement('span'), { textContent: mins }),
      );
      infoEl.replaceChildren();
      const add = (label, value, colour) => {
        const row = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = value;
        if (colour) strong.style.color = colour;
        row.append(document.createTextNode(`${label} `), strong);
        infoEl.append(row);
      };
      const head = document.createElement('p');
      head.className = 'info-head';
      head.textContent = arena;
      infoEl.append(head);
      add('Free For All ·', mins);
      add('Bots:', botsLabel, botsColour);
      if (code) add('Code:', code);
      for (const el of [$('invite-difficulty'), $('settings-bots')]) {
        if (!el) continue;
        el.textContent = botsLabel;
        el.style.color = botsColour || '';
      }
    },

    /** The controls reminder, once per visit, a few seconds after spawning. */
    showHint() {
      if (hintShown) return;
      hintShown = true;
      hintLeft = HINT_SECONDS;
      hintEl.classList.remove('hidden', 'gone');
    },

    frame(dt) {
      slot.frame(dt);

      fps.frames++;
      fps.time += dt;
      if (fps.time >= 0.5) {
        const v = Math.round(fps.frames / fps.time);
        if (changed('fps', v)) fpsEl.textContent = `FPS: ${v}`;
        fps.frames = 0;
        fps.time = 0;
      }

      if (hintLeft > 0) {
        hintLeft -= dt;
        if (hintLeft <= 0) hintEl.classList.add('gone');
      }
      if (smashLeft > 0) {
        smashLeft -= dt;
        if (smashLeft <= 0) smashEl.classList.add('hidden');
      }
    },
  };
}
