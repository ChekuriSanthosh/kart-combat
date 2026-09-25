/**
 * Kart Combat — client.
 *
 * The server is authoritative for everything that matters. This file reads
 * input, predicts the local kart with the shared physics, interpolates the
 * other karts, and draws the result.
 */

import * as THREE from 'three';
import { getMap } from '/shared/maps/index.js';
import {
  EVENT, MAX_HP, JOIN_MODE, ROOM_CODE_LENGTH, normalizeRoomCode, CHEAT,
  ROOM_STATUS,
} from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { getDifficulty } from '/shared/ai/difficulty.js';
import { KART } from '/shared/physics.js';
import { pointInSolid } from '/shared/collision.js';
import { buildMap } from './render/MapBuilder.js';
import { createKartMesh } from './render/KartMesh.js';
import { createFx } from './render/Fx.js';
import { createPredictor } from './net/Predictor.js';
import { createInterpolator } from './net/Interpolator.js';

const CAMERA = {
  distance: 9.5,
  height: 4.0,
  lookAhead: 7.0,
  stiffness: 9,
  fov: 62,
};

/* ── DOM ────────────────────────────────────────────────────────────── */
const canvas = document.getElementById('game');
const lobbyEl = document.getElementById('lobby');
const hudEl = document.getElementById('hud');
const healthFill = document.getElementById('health-fill');
const healthText = document.getElementById('health-text');
const weaponIconEl = document.getElementById('weapon-icon');
const weaponNameEl = document.getElementById('weapon-name');
const leaderboardEl = document.getElementById('leaderboard-list');
const killFeedEl = document.getElementById('kill-feed');
const respawnEl = document.getElementById('respawn');
const nameInput = document.getElementById('player-name');
const playerCountInput = document.getElementById('player-count');
const difficultyInput = document.getElementById('bot-difficulty');
const toastEl = document.getElementById('toast');

/* ── Renderer ───────────────────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.2, 600);
camera.position.set(0, 12, 18);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ── Session state ──────────────────────────────────────────────────── */
const socket = window.io({ transports: ['websocket', 'polling'] });

let selectedMapId = 'gravelPit';
let localId = null;
let world = null;          // { map, render, fx }
let predictor = null;
const interp = createInterpolator();
const karts = new Map();   // playerId → { mesh, info }
let rosterById = new Map();
let latestSnapshot = null;
let localSnapshot = null;
let joined = false;
/** True while sitting in a private room that has not started yet. */
let waitingRoom = false;
/** Last waiting-room state from the server, or null outside one. */
let lobbyInfo = null;
let lastFrame = performance.now();
let elapsed = 0;
const shake = { amount: 0 };
const outbox = [];

const input = { forward: false, back: false, left: false, right: false, drift: false, fire: false };

/* ── Input ──────────────────────────────────────────────────────────── */
const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'drift', ShiftRight: 'drift',
  Space: 'fire',
};

/**
 * Undocumented. Shift + a number row key. Deliberately absent from the HUD,
 * the lobby and the controls hint — the only way to find these is to be told.
 *
 * The client only asks; the server decides, same as every other action, so a
 * cheat behaves correctly under prediction and reconciliation.
 */
const CHEAT_KEYS = {
  Digit1: CHEAT.INVINCIBLE,
  Digit2: CHEAT.INVISIBLE,
  Digit3: CHEAT.HOP,
  Digit4: CHEAT.SPEED,
  Digit5: CHEAT.POWERUP,
};

window.addEventListener('keydown', (e) => {
  // The waiting room has a name field and buttons in it; driving keys and
  // cheats have no business firing while someone is typing or clicking there.
  if (waitingRoom) return;
  if (e.shiftKey && joined) {
    const cheat = CHEAT_KEYS[e.code];
    if (cheat) {
      // Only on the initial press: holding the key must not repeat-fire.
      if (!e.repeat) socket.emit(EVENT.CHEAT, { code: cheat });
      e.preventDefault();
      return;
    }
  }
  const action = KEYMAP[e.code];
  if (!action) return;
  input[action] = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  const action = KEYMAP[e.code];
  if (action) input[action] = false;
});
window.addEventListener('blur', () => {
  for (const k of Object.keys(input)) input[k] = false;
});
canvas.addEventListener('pointerdown', () => { input.fire = true; });
window.addEventListener('pointerup', () => { input.fire = false; });

/* ── Lobby ──────────────────────────────────────────────────────────── */
function toast(msg, ms = 2200) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

// Prefill from last time so returning players are not retyping their name.
if (nameInput && !nameInput.value) nameInput.value = recallName();

for (const card of document.querySelectorAll('.map-card')) {
  card.addEventListener('click', () => {
    selectedMapId = card.dataset.map;
    for (const c of document.querySelectorAll('.map-card')) c.classList.toggle('selected', c === card);
  });
}

function join(mode, code) {
  const name = (nameInput?.value || '').trim() || recallName();
  if (name) rememberName(name);
  socket.emit(EVENT.JOIN, {
    name: name || undefined,
    mapId: selectedMapId,
    maxPlayers: Number(playerCountInput?.value || 8),
    difficulty: difficultyInput?.value || undefined,
    mode,
    code,
  });
}

document.getElementById('btn-play').addEventListener('click', () => join(JOIN_MODE.QUICK));

document.getElementById('btn-create-party')?.addEventListener('click', () => {
  join(JOIN_MODE.PRIVATE);
});

const joinCodeInput = document.getElementById('join-code');
joinCodeInput?.addEventListener('input', () => {
  joinCodeInput.value = normalizeRoomCode(joinCodeInput.value);
});

document.getElementById('join-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeRoomCode(joinCodeInput?.value);
  if (code.length < ROOM_CODE_LENGTH) {
    toast(`Match codes are ${ROOM_CODE_LENGTH} characters`);
    return;
  }
  join(JOIN_MODE.CODE, code);
});

/* ── Invite links ───────────────────────────────────────────────────── */
const inviteEl = document.getElementById('invite');
const inviteCodeEl = document.getElementById('invite-code');
const inviteDifficultyEl = document.getElementById('invite-difficulty');

/** Easy reads calm, hard reads dangerous. */
const DIFFICULTY_TINT = { low: '#57d98b', medium: '#ffd166', high: '#ff5c5c' };

function inviteLink(code) {
  const url = new URL(window.location.href);
  url.search = `?join=${code}`;
  url.hash = '';
  return url.toString();
}

/**
 * Put text on the clipboard, by whatever route this browser actually allows.
 *
 * `navigator.clipboard` only exists in a secure context, and the whole point
 * of this link is that you send it to someone else — which means the game is
 * very often being served from a plain `http://` LAN address, where that API
 * is simply not there. The textarea route is ancient but it works on exactly
 * the origins the modern one refuses.
 */
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* not permitted here; try the fallback below */ }
  }
  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.top = '-1000px';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    scratch.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    scratch.remove();
    canvas.focus();
    return copied;
  } catch {
    return false;
  }
}

document.getElementById('btn-invite')?.addEventListener('click', async () => {
  const link = inviteLink(inviteCodeEl.textContent);

  // Only hand off to the native share sheet on a touch device, where it is
  // what people expect. Desktop Safari and Chrome both expose `navigator.share`
  // too, so preferring it whenever it exists meant a button labelled "Copy"
  // opened a share dialog and never copied anything.
  const touchDevice = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
  if (navigator.share && touchDevice) {
    try {
      await navigator.share({ title: 'Kart Combat', url: link });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // they closed the sheet
      // Anything else: fall through and copy instead.
    }
  }

  if (await copyText(link)) toast('Invite link copied');
  else toast(link, 8000); // last resort — show it so it can be copied by hand
});

// Arriving on a ?join= link skips the lobby and goes straight to that match.
const invited = normalizeRoomCode(new URLSearchParams(window.location.search).get('join'));
if (invited.length === ROOM_CODE_LENGTH) {
  if (joinCodeInput) joinCodeInput.value = invited;
  // Give socket.io a moment to connect; a JOIN sent before then is dropped.
  socket.on('connect', function joinInvited() {
    socket.off('connect', joinInvited);
    toast(`Joining match ${invited}…`);
    join(JOIN_MODE.CODE, invited);
  });
}

document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
});

/* ── Waiting room ───────────────────────────────────────────────────── */
const waitingEl = document.getElementById('waiting');
const waitingCodeEl = document.getElementById('waiting-code');
const waitingListEl = document.getElementById('waiting-list');
const waitingCountEl = document.getElementById('waiting-count');
const waitingHostEl = document.getElementById('waiting-host');
const waitingGuestEl = document.getElementById('waiting-guest');
const waitingBotsEl = document.getElementById('waiting-bots');
const waitingNameEl = document.getElementById('waiting-name');
const waitingLengthEl = document.getElementById('waiting-length');
const startMatchBtn = document.getElementById('btn-start-match');

/**
 * Remember the nickname between visits.
 *
 * It matters most for the people who never see the lobby: someone who arrives
 * on an invite link types their name once in the waiting room, and the next
 * link a friend sends them already knows who they are.
 */
const NAME_KEY = 'kartcombat.name';
function rememberName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
}
function recallName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

let renameTimer = 0;
waitingNameEl?.addEventListener('input', () => {
  const name = waitingNameEl.value.slice(0, 18).trim();
  clearTimeout(renameTimer);
  // Debounced so holding a key down does not emit once per character, but
  // short enough that the list updates while you are still looking at it.
  renameTimer = setTimeout(() => {
    if (!name) return;
    rememberName(name);
    socket.emit(EVENT.RENAME, { name });
  }, 350);
});
// Enter should commit immediately rather than wait out the debounce.
waitingNameEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const name = waitingNameEl.value.slice(0, 18).trim();
  if (!name) return;
  clearTimeout(renameTimer);
  rememberName(name);
  socket.emit(EVENT.RENAME, { name });
  waitingNameEl.blur();
});

document.getElementById('btn-waiting-invite')?.addEventListener('click', async () => {
  const link = inviteLink(waitingCodeEl.textContent);
  if (await copyText(link)) toast('Invite link copied');
  else toast(link, 8000);
});

startMatchBtn?.addEventListener('click', () => socket.emit(EVENT.START));

waitingBotsEl?.addEventListener('change', () => {
  socket.emit(EVENT.CONFIG, { fillWithBots: waitingBotsEl.checked });
});

waitingLengthEl?.addEventListener('change', () => {
  socket.emit(EVENT.CONFIG, { matchSeconds: Number(waitingLengthEl.value) });
});

document.getElementById('btn-waiting-leave')?.addEventListener('click', () => {
  // Drop the ?join= code too, or a refresh would walk straight back in.
  window.location.href = window.location.pathname;
});

function renderWaiting(state) {
  if (!waitingEl) return;
  waitingCodeEl.textContent = state.code || '';
  waitingCountEl.textContent = `${state.players.length} / ${state.maxPlayers}`;

  // Reflect the authoritative name back, but never while they are mid-word:
  // overwriting a focused field would fight whoever is typing in it.
  const me = state.players.find((p) => p.i === localId);
  if (waitingNameEl && me && document.activeElement !== waitingNameEl) {
    waitingNameEl.value = me.n;
  }

  waitingListEl.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    if (p.i === localId) li.classList.add('me');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = `#${(p.c ?? 0x888888).toString(16).padStart(6, '0')}`;
    const name = document.createElement('span');
    name.textContent = p.n;
    li.append(swatch, name);
    if (p.i === localId) {
      const you = document.createElement('span');
      you.className = 'you';
      you.textContent = '(you)';
      li.append(you);
    }
    if (p.host) {
      const badge = document.createElement('span');
      badge.className = 'host-badge';
      badge.textContent = 'Host';
      li.append(badge);
    }
    waitingListEl.appendChild(li);
  }

  // Only the host gets the controls; everyone else is told what they are
  // waiting for rather than shown a button that would do nothing.
  const isHost = state.hostId === localId;
  waitingHostEl?.classList.toggle('hidden', !isHost);
  waitingGuestEl?.classList.toggle('hidden', isHost);
  if (isHost && waitingBotsEl) waitingBotsEl.checked = !!state.fillWithBots;
  if (isHost && waitingLengthEl && document.activeElement !== waitingLengthEl) {
    waitingLengthEl.value = String(state.matchSeconds);
  }
}

socket.on(EVENT.LOBBY, (state) => {
  lobbyInfo = state;
  if (waitingRoom) renderWaiting(state);
});

socket.on(EVENT.STARTED, () => {
  waitingRoom = false;
  waitingEl?.classList.add('hidden');
  hudEl.classList.remove('hidden');
  // The server reseats everyone on start, so drop the history gathered while
  // waiting. The local kart is corrected by the first snapshot — that is a
  // teleport-sized move, which the predictor deliberately snaps rather than
  // slides, and it lands under the "Go!" toast where nobody is looking.
  interp.clear();
  canvas.focus();
  toast('Go!', 1200);
});

/* ── Networking ─────────────────────────────────────────────────────── */
socket.on(EVENT.WELCOME, (welcome) => {
  localId = welcome.id;
  buildWorld(welcome);
  joined = true;
  lobbyEl.classList.add('hidden');

  // A private room you arrive at before it starts shows the waiting room
  // instead of the HUD. Arriving at one already in progress — or any quick
  // match — goes straight to driving.
  waitingRoom = welcome.status === ROOM_STATUS.LOBBY;
  waitingEl?.classList.toggle('hidden', !waitingRoom);
  hudEl.classList.toggle('hidden', waitingRoom);
  if (!waitingRoom) canvas.focus();

  // The code is worth showing for any match, not just private ones — it is how
  // you pull a friend into the game you are already playing.
  // Codes are a private-room concept now. Quick play has nothing to invite
  // anyone to — the next person to press Play is routed to whichever public
  // room is busiest, not to this one — so it shows no code at all.
  if (welcome.code && inviteCodeEl) {
    inviteCodeEl.textContent = welcome.code;
    inviteEl?.classList.remove('hidden');
  } else {
    inviteEl?.classList.add('hidden');
  }
  // The room may not be the one you asked for — quick match drops you into an
  // existing game — so report the skill level actually in force, not the pick.
  if (inviteDifficultyEl) {
    const tier = getDifficulty(welcome.difficulty);
    inviteDifficultyEl.textContent = tier.label;
    inviteDifficultyEl.style.color = DIFFICULTY_TINT[tier.id] || '#fff';
    if (difficultyInput && welcome.difficulty) difficultyInput.value = welcome.difficulty;
  }
  // Keep the address bar pointing at this match so a refresh or a copied URL
  // lands back in the same place — but only for a private room, which is the
  // only kind a code can take you back to. A quick match leaves the URL clean.
  history.replaceState(null, '', welcome.code ? inviteLink(welcome.code) : window.location.pathname);
});

socket.on('roster', (list) => {
  rosterById = new Map(list.map((p) => [p.i, p]));
  for (const [id, entry] of karts) {
    if (!rosterById.has(id)) {
      scene.remove(entry.mesh.group);
      entry.mesh.dispose();
      karts.delete(id);
    }
  }
});

socket.on(EVENT.SNAPSHOT, (snap) => {
  if (!joined) return;
  latestSnapshot = snap;
  interp.push(snap);

  const mine = snap.p.find((p) => p.i === localId);
  if (mine && predictor) {
    localSnapshot = mine;
    predictor.reconcile(mine);
  }

  world?.fx.syncCrates(snap.b || []);
  world?.fx.syncProjectiles(snap.r || []);

  if (snap.e) for (const e of snap.e) handleEvent(e);
  updateHud(snap);
  updateMatchClock(snap);
});

socket.on(EVENT.ERROR, (err) => toast(err?.message || 'Something went wrong'));
socket.on('disconnect', () => toast('Disconnected from server'));

function handleEvent(e) {
  world?.fx.handleEvent(e);

  if (e.t === 'hit') {
    karts.get(e.i)?.mesh.flash();
    if (e.i === localId) shake.amount = Math.min(1, shake.amount + 0.35);
  } else if (e.t === 'kill') {
    const victim = rosterById.get(e.i)?.n || 'Someone';
    const killer = e.by ? (rosterById.get(e.by)?.n || 'Someone') : null;
    pushKillFeed(killer ? `${killer} knocked out ${victim}` : `${victim} was wrecked`);
    if (e.i === localId) shake.amount = 1;
  } else if (e.t === 'pickup' && e.i === localId) {
    startRoulette();
    weaponIconEl.classList.add('spinning');
  } else if (e.t === 'respawn' && e.i === localId && predictor) {
    predictor.teleport({ x: e.x, y: e.y, z: e.z, yaw: 0 });
  }
}

/* ── World ──────────────────────────────────────────────────────────── */
function buildWorld(welcome) {
  teardownWorld();

  const map = getMap(welcome.mapId);
  camBoom = CAMERA.distance;
  camPitch = 1;
  camYaw = welcome.spawn?.yaw ?? 0;
  const render = buildMap(map);
  scene.add(render.group);
  scene.background = new THREE.Color(map.theme.background);
  scene.fog = new THREE.Fog(map.theme.fog.color, map.theme.fog.near, map.theme.fog.far);

  const fx = createFx(scene, welcome.boxes);
  world = { map, render, fx };

  predictor = createPredictor(map, welcome.spawn);
  rosterById = new Map((welcome.roster || []).map((p) => [p.i, p]));
  interp.clear();
}

function teardownWorld() {
  for (const entry of karts.values()) {
    scene.remove(entry.mesh.group);
    entry.mesh.dispose();
  }
  karts.clear();
  if (world) {
    scene.remove(world.render.group);
    world.render.dispose();
    world.fx.dispose();
    world = null;
  }
  predictor = null;
}

function kartFor(id) {
  let entry = karts.get(id);
  if (entry) return entry;
  const info = rosterById.get(id);
  const mesh = createKartMesh(info?.c ?? 0xcccccc, info?.n ?? id, { showTag: id !== localId });
  scene.add(mesh.group);
  entry = { mesh, prevSpeed: 0 };
  karts.set(id, entry);
  return entry;
}

/** Name tags fade out with distance so a crowded arena stays readable. */
function tagOpacity(x, y, z) {
  const d = camera.position.distanceTo(tmpVec.set(x, y, z));
  if (d < 45) return 1;
  return Math.max(0, 1 - (d - 45) / 35);
}

/* ── HUD ────────────────────────────────────────────────────────────── */
function updateHud(snap) {
  const mine = snap.p.find((p) => p.i === localId);
  if (mine) {
    const hp = Math.max(0, Math.min(MAX_HP, mine.h));
    healthFill.style.width = `${hp}%`;
    healthText.textContent = String(Math.round(hp));
    healthFill.style.background = `linear-gradient(90deg, hsl(${hp * 1.2}, 85%, 45%), hsl(${hp * 1.2}, 90%, 60%))`;

    respawnEl.classList.toggle('hidden', !!mine.al);
  }

  const rows = [...snap.p].sort((a, b) => b.sc - a.sc || b.k - a.k).slice(0, 10);
  leaderboardEl.innerHTML = '';
  for (const p of rows) {
    const info = rosterById.get(p.i);
    const li = document.createElement('li');
    if (p.i === localId) li.classList.add('me');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = `#${(info?.c ?? 0x888888).toString(16).padStart(6, '0')}`;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = info?.n || p.i;

    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = String(p.sc);

    li.append(swatch, name, score);
    leaderboardEl.appendChild(li);
  }
}

/**
 * The weapon slot. Picking something up spins through the whole arsenal for a
 * beat before landing on what you actually got, which is what makes opening a
 * crate feel like a reward rather than a silent state change.
 */
const ROULETTE_TIME = 0.85;
const roulette = { left: 0, tick: 0, shown: null };
const WEAPON_LIST = Object.values(WEAPONS);

function startRoulette() {
  roulette.left = ROULETTE_TIME;
  roulette.tick = 0;
}

function renderWeaponSlot(dt) {
  const held = localSnapshot?.w ? WEAPONS[localSnapshot.w] : null;
  let def = held;

  if (roulette.left > 0 && held) {
    roulette.left -= dt;
    roulette.tick -= dt;
    if (roulette.tick <= 0) {
      // Slow the cycle down as it settles, like a slot machine.
      const progress = 1 - roulette.left / ROULETTE_TIME;
      roulette.tick = 0.04 + progress * progress * 0.16;
      def = WEAPON_LIST[Math.floor(Math.random() * WEAPON_LIST.length)];
      roulette.shown = def;
    } else {
      def = roulette.shown || held;
    }
    if (roulette.left <= 0) {
      def = held;
      weaponIconEl.classList.remove('spinning');
      weaponIconEl.classList.add('landed');
      setTimeout(() => weaponIconEl.classList.remove('landed'), 400);
    }
  }

  if (def === roulette.lastDrawn) return;
  roulette.lastDrawn = def;

  weaponNameEl.textContent = def ? def.name : 'Empty';
  weaponIconEl.textContent = def ? def.glyph : '';
  weaponIconEl.style.background = def
    ? `radial-gradient(circle at 35% 28%, #ffffff33, #${def.color.toString(16).padStart(6, '0')})`
    : 'rgba(255,255,255,0.08)';
  weaponIconEl.classList.toggle('armed', !!def);
}

/* ── Match clock and results ────────────────────────────────────────── */
const matchTimerEl = document.getElementById('match-timer');
const matchClockEl = document.getElementById('match-clock');
const resultsEl = document.getElementById('results');
const resultsListEl = document.getElementById('results-list');
const resultsWinnerEl = document.getElementById('results-winner');
const resultsCountdownEl = document.getElementById('results-countdown');

const mmss = (s) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * The countdown runs off the snapshot's `tl`, so it is the server's clock
 * every client is reading rather than each browser counting on its own and
 * drifting apart.
 */
function updateMatchClock(snap) {
  if (!matchTimerEl || snap.tl === undefined) return;
  const results = snap.ph === ROOM_STATUS.RESULTS;
  matchTimerEl.classList.toggle('hidden', results);
  if (results) {
    if (resultsCountdownEl) resultsCountdownEl.textContent = String(Math.max(0, Math.ceil(snap.tl)));
    return;
  }
  matchClockEl.textContent = mmss(snap.tl);
  matchTimerEl.classList.toggle('urgent', snap.tl <= 10);
}

function showResults(standings) {
  if (!resultsEl) return;
  const winner = standings[0];
  resultsWinnerEl.textContent = winner
    ? (winner.i === localId ? 'You win!' : `${winner.n} wins!`)
    : 'Time!';

  resultsListEl.innerHTML = '';
  for (const p of standings.slice(0, 10)) {
    const li = document.createElement('li');
    if (p.rank === 1) li.classList.add('first');
    if (p.i === localId) li.classList.add('me');

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(p.rank);

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = `#${(p.c ?? 0x888888).toString(16).padStart(6, '0')}`;

    const name = document.createElement('span');
    name.textContent = p.n;

    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = String(p.sc);

    li.append(rank, swatch, name, pts);
    resultsListEl.appendChild(li);
  }
  resultsEl.classList.remove('hidden');
}

socket.on(EVENT.MATCH_OVER, ({ standings }) => {
  showResults(standings || []);
  // Let go of the controls: the next match reseats everyone anyway, and
  // holding forward through the results screen should not bank you a head
  // start the moment it clears.
  for (const k of Object.keys(input)) input[k] = false;
});

socket.on(EVENT.MATCH_START, () => {
  resultsEl?.classList.add('hidden');
  interp.clear();
  canvas.focus();
});

function pushKillFeed(text) {
  const row = document.createElement('div');
  row.className = 'feed-row';
  row.textContent = text;
  killFeedEl.prepend(row);
  setTimeout(() => row.classList.add('fade'), 2600);
  setTimeout(() => row.remove(), 3400);
  while (killFeedEl.children.length > 5) killFeedEl.lastChild.remove();
}

/* ── Frame loop ─────────────────────────────────────────────────────── */
const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();
/** Current boom length, eased between frames so scenery cannot jolt the view. */
let camBoom = CAMERA.distance;
/** How far the boom is lifted to clear scenery, as a multiple of its height. */
let camPitch = 1;
/** Smoothed heading the boom hangs off, so yaw corrections do not shake it. */
let camYaw = 0;
const forward = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  elapsed += dt;

  if (joined && predictor && world && !waitingRoom) {
    // ── Local kart: predict, then ship the commands we just simulated ──
    const commands = predictor.advance(dt, input);
    if (commands.length) {
      outbox.push(...commands);
      socket.emit(EVENT.INPUT, outbox.splice(0, outbox.length));
    }

    const view = predictor.view();
    const localEntry = kartFor(localId);
    localEntry.mesh.apply({
      ...view,
      steer: (input.left ? 1 : 0) - (input.right ? 1 : 0),
      accel: (view.speed - localEntry.prevSpeed) / Math.max(dt, 1e-4),
      shield: localSnapshot?.sh === 1,
      invisible: localSnapshot?.iz === 1,
      isLocal: true,
      alive: localSnapshot ? localSnapshot.al === 1 : true,
    }, dt);
    localEntry.prevSpeed = view.speed;
    localEntry.mesh.setLabel(rosterById.get(localId)?.n || 'You', localSnapshot?.h ?? MAX_HP);

    // ── Remote karts: interpolate in the past for smoothness ──
    for (const [id, info] of rosterById) {
      if (id === localId) continue;
      const sample = interp.sample(id);
      if (!sample) continue;
      const entry = kartFor(id);
      entry.mesh.apply({
        x: sample.x,
        y: sample.y,
        z: sample.z,
        yaw: sample.yaw,
        speed: sample.sp,
        yawRate: sample.yr,
        drifting: sample.dr === 1,
        grounded: sample.g === 1,
        boost: sample.bt > 0,
        stunned: sample.st > 0,
        shield: sample.sh === 1,
        invisible: sample.iz === 1,
        alive: sample.al === 1,
        steer: THREE.MathUtils.clamp(sample.yr / 2, -1, 1),
        accel: (sample.sp - entry.prevSpeed) / Math.max(dt, 1e-4),
        tagOpacity: tagOpacity(sample.x, sample.y, sample.z),
        camDist: camera.position.distanceTo(tmpVec.set(sample.x, sample.y, sample.z)),
      }, dt);
      entry.prevSpeed = sample.sp;
      entry.mesh.setLabel(info.n, sample.h);
    }

    world.render.update(dt, elapsed);
    world.fx.update(dt, elapsed);
    renderWeaponSlot(dt);
    updateCamera(view, dt);
  }

  renderer.render(scene, camera);
}

/**
 * Walk from the kart out to where the camera wants to be and stop at the first
 * thing in the way, so the view never ends up inside a wall. This queries the
 * same solids the physics uses, so it is always consistent with the arena.
 */
function cameraBlocked(px, py, pz) {
  const solids = world.map.solids;
  if (pointInSolid(solids, px, py, pz)) return true;
  // Rings are hollow walls that hold karts in; keep the camera inside them.
  for (const s of solids) {
    if (s.t !== 'ring') continue;
    if (py < s.y || py > s.y + s.h) continue;
    if (Math.hypot(px - s.x, pz - s.z) > s.r - 0.5) return true;
  }
  return false;
}

/**
 * How far back the camera can sit before it ends up inside the scenery.
 *
 * The returned distance has to be *continuous* as the kart drives, not
 * quantised to whatever the sampling interval happens to be: a value that
 * jumps in 0.75 m increments drags the camera back and forth every frame, and
 * that reads as the entire screen juddering. So the coarse walk below only
 * brackets the first blocked sample, and a short bisection then converges on
 * the actual surface.
 */
function unobstructedDistance(ax, ay, az, dx, dy, dz, wanted) {
  const STEPS = 10;
  let lo = 0;
  let hi = -1;
  for (let i = 2; i <= STEPS; i++) {
    const f = (i / STEPS) * wanted;
    if (cameraBlocked(ax + dx * f, ay + dy * f, az + dz * f)) { hi = f; break; }
    lo = f;
  }
  if (hi < 0) return wanted;

  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) * 0.5;
    if (cameraBlocked(ax + dx * mid, ay + dy * mid, az + dz * mid)) hi = mid;
    else lo = mid;
  }
  return lo;
}

function updateCamera(view, dt) {
  // Debug flyover used by the automated play test to inspect arena layout.
  if (window.__freeCam) {
    const r = (world.map.arenaRadius || 46) * 1.55;
    camera.position.set(r * 0.72, r * 0.95, r * 0.72);
    camera.lookAt(0, 0, 0);
    camera.fov = CAMERA.fov;
    camera.updateProjectionMatrix();
    return;
  }

  // Follow a smoothed heading rather than the raw predicted one.
  //
  // The boom is ~10 m long, so it multiplies whatever the heading does: a
  // half-degree yaw correction at the kart is centimetres of camera travel,
  // and those arrive with every snapshot. On a map that rotates the kart for
  // free — the spinning dish — yaw is being corrected constantly and the
  // camera ends up shaking even though the kart looks fine. Easing the
  // heading costs a few tens of milliseconds of lag on a hard turn, which
  // reads as weight rather than delay.
  let dYaw = view.yaw - camYaw;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  camYaw += dYaw * (1 - Math.exp(-14 * dt));
  forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));

  // Pull back a little at speed for a sense of pace.
  const speedK = Math.min(1, Math.abs(view.speed) / KART.maxSpeed);
  const wanted = CAMERA.distance + speedK * 1.8;
  const height = CAMERA.height + speedK * 0.5;

  // Direction from the kart to the ideal camera spot: back and up.
  const ax = view.x;
  const ay = view.y + 1.2;
  const az = view.z;
  // Climb over scenery before giving up any distance.
  //
  // Shortening the boom is the only move a pull-in-only camera has, and on a
  // stepped arena — the terraced dish, the floating islands — the distance it
  // can keep genuinely changes as the kart crosses each step. Chasing that
  // stepping value at 26/s inward and 4/s outward ratchets the camera in and
  // lets it drift out again every few frames, which is most of the judder on
  // those two maps. Lifting the boom instead usually clears the obstacle with
  // no loss of distance at all, and the pitch it settles on moves smoothly
  // because it is eased rather than recomputed from scratch.
  const PITCHES = [1, 1.35, 1.75, 2.2, 2.8];
  let bestPitch = PITCHES[PITCHES.length - 1];
  let bestClear = 0;
  for (const pitch of PITCHES) {
    const px = -forward.x * wanted;
    const pz = -forward.z * wanted;
    const py = height * pitch;
    const len = Math.hypot(px, py, pz) || 1;
    const got = unobstructedDistance(ax, ay, az, px / len, py / len, pz / len, len);
    if (got > bestClear) { bestClear = got; bestPitch = pitch; }
    // Near enough to the full boom that lifting further would only cost the
    // player their view of the track ahead.
    if (got >= len - 0.25) { bestPitch = pitch; break; }
  }
  // Rise quickly, settle back slowly. Without the asymmetry the probe flips
  // between two neighbouring pitches every few frames on a bowl-shaped arena —
  // where the terrace behind the kart is forever crossing the boom — and the
  // camera oscillates instead of holding a line. Being slow to come back down
  // costs nothing a player would notice.
  const pitchRate = bestPitch > camPitch ? 12 : 2.0;
  camPitch += (bestPitch - camPitch) * (1 - Math.exp(-pitchRate * dt));

  const rawX = -forward.x * wanted;
  const rawZ = -forward.z * wanted;
  const rawY = height * camPitch;
  const rawLen = Math.hypot(rawX, rawY, rawZ) || 1;
  const clear = Math.max(
    3.0,
    unobstructedDistance(ax, ay, az, rawX / rawLen, rawY / rawLen, rawZ / rawLen, rawLen),
  );

  // Ease the boom length itself rather than switching the camera between two
  // follow speeds. Pulling in has to be quick, because a slow push through a
  // wall is very obvious; letting back out is slow, because nobody notices it.
  // Doing this on the scalar keeps the follow behaviour identical in open
  // space, where flipping between two lerp rates used to make the camera
  // stutter every time the occlusion test changed its mind.
  const rate = clear < camBoom ? 26 : 4;
  camBoom += (clear - camBoom) * (1 - Math.exp(-rate * dt));

  camTarget.set(
    ax + (rawX / rawLen) * camBoom,
    ay + (rawY / rawLen) * camBoom,
    az + (rawZ / rawLen) * camBoom,
  );
  camLook.set(view.x, view.y + 1.5, view.z).addScaledVector(forward, CAMERA.lookAhead);

  camera.position.lerp(camTarget, 1 - Math.exp(-CAMERA.stiffness * dt));
  camera.lookAt(camLook);
  camera.fov = CAMERA.fov + speedK * 6 + (view.boost ? 5 : 0);
  camera.updateProjectionMatrix();

  if (shake.amount > 0) {
    shake.amount = Math.max(0, shake.amount - dt * 2.4);
    const s = shake.amount * shake.amount * 0.55;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
  }
}

requestAnimationFrame(frame);

// Handle for the automated play test and for poking at a live match in devtools.
window.__kc = {
  get socket() { return socket; },
  get renderer() { return renderer; },
  get scene() { return scene; },
  get camera() { return camera; },
  get world() { return world; },
  get predictor() { return predictor; },
};

console.info('[kart-combat] client ready');
