/**
 * Kart Combat — client.
 *
 * The server is authoritative for everything that matters. This file reads
 * input, predicts the local kart with the shared physics, interpolates the
 * other karts, and draws the result.
 */

import * as THREE from 'three';
import { getMap, getSpawn } from '/shared/maps/index.js';
import {
  EVENT, MAX_HP, JOIN_MODE, ROOM_CODE_LENGTH, normalizeRoomCode, CHEAT,
  ROOM_STATUS, MAP_IDS, DEFAULT_MAP_ID, MATCH_LENGTHS, DEFAULT_MATCH_SECONDS,
  MIN_PLAYERS, MAX_PLAYERS, DEFAULT_MAX_PLAYERS,
} from '/shared/constants.js';
import * as SHARED from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { getDifficulty, DIFFICULTY_IDS, DEFAULT_DIFFICULTY } from '/shared/ai/difficulty.js';
import {
  CHARACTERS, KARTS, DEFAULT_CHARACTER, DEFAULT_KART,
  validCharacter, validKart,
} from '/shared/cosmetics.js';
import { KART } from '/shared/physics.js';
import { sampleGround, topAt } from '/shared/collision.js';
import { settings } from './settings.js';
import { buildMap } from './render/MapBuilder.js';
import { createKartMesh } from './render/KartMesh.js';
import { createFx } from './render/Fx.js';
import { styleRenderer, createToyLights } from './render/lighting.js';
import { createPredictor } from './net/Predictor.js';
import { createInterpolator } from './net/Interpolator.js';
import { createHud } from './ui/hud.js';
import { createMatchModals } from './ui/modals.js';
import { rankPlayers } from './ui/leaderboard.js';

/**
 * Chase camera framing, tuned at 1400x820 against the original: the kart sits
 * centred, about 150 px wide, with the bottom of its wheels ~78% of the way
 * down the screen, and the view is pitched ~22° down so the horizon lands in
 * the top fifth and most of the picture is arena ahead of you. That is a much
 * higher camera than a racing game's — it has to see over the low walls and
 * show where the crates and rivals are, not just the road.
 *
 * The boom is described by where the camera sits relative to the kart's
 * wheels (back, height) and where it aims (lookAhead, lookHeight), because
 * those are the numbers the framing actually depends on. A length-and-angle
 * pair would have to be re-derived every time one of them was tuned.
 */
const CAMERA = {
  /** Metres behind the kart, along its heading. */
  back: 9.35,
  /** Metres above the kart's wheels. */
  height: 6.8,
  /** Aim this far ahead of the kart, at this height — together they set the pitch. */
  lookAhead: 5.0,
  lookHeight: 1.0,
  /** Where on the kart the boom (and the occlusion probe) starts, above the wheels. */
  anchor: 1.2,
  /** Vertical field of view, degrees. */
  fov: 60,
  /**
   * Natural frequency of the heading spring, rad/s. Low enough that the kart
   * visibly swings round on screen before the camera follows it, high enough
   * that it never feels like the camera has lost you.
   */
  yawFollow: 8,
  /**
   * Seconds of the kart's turn rate the spring aims ahead by. A spring alone
   * trails a steady turn by 2·rate/ω — 40° at full lock — which leaves the
   * camera looking well wide of where you are aiming. Leading by part of
   * that keeps the lazy swing on turn-in and turn-out but holds a sustained
   * turn to ~20°. Kept under 1/KART.turnResponse so the aim point never runs
   * past where the kart ends up, which would make the camera swing back.
   */
  yawLead: 0.12,
  /** Rate the boom's height eases toward the kart's, per second — absorbs bumps and jumps. */
  heightFollow: 7,
  /** How much of the ground's slope the camera leans into, when Camera Tilt is on. */
  tilt: 0.45,
  tiltFollow: 3,
  /** A little extra boom and field of view at top speed, for a sense of pace. */
  speedPullBack: 0.6,
  speedFov: 2,
  boostFov: 5,
  /** A followed kart that moves further than this in one frame was cut to, not driven to. */
  cutDistance: 8,
  /** How close above a surface the camera may sit before its near plane clips into it. */
  clearance: 0.3,
};
/** Boom length from the anchor; buildWorld seeds the occlusion easing with it. */
CAMERA.distance = Math.hypot(CAMERA.back, CAMERA.height - CAMERA.anchor);

/* ── DOM ────────────────────────────────────────────────────────────── */
const canvas = document.getElementById('game');
const lobbyEl = document.getElementById('lobby');
const hudEl = document.getElementById('hud');
const nameInput = document.getElementById('player-name');
// Bot skill is chosen in the Create dialog now, so the menu has no such field
// and this is null. Kept because the welcome handler still null-checks it.
const difficultyInput = document.getElementById('bot-difficulty');
const toastEl = document.getElementById('toast');

/* ── Renderer ───────────────────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
styleRenderer(renderer);

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

const LOOK_KEY = 'kartcombat.look';

/**
 * The chosen character and kart, remembered between visits the same way the
 * nickname is. Held as one object because they are always read together and
 * always written together.
 */
const look = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}');
    return { character: validCharacter(raw.character), kart: validKart(raw.kart) };
  } catch {
    return { character: DEFAULT_CHARACTER, kart: DEFAULT_KART };
  }
})();

function rememberLook() {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* private mode */ }
}


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

/** Somewhere keys mean text: Space types a space and arrows move the caret. */
function isTextField(el) {
  return !!el?.closest?.('input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=""], [contenteditable="true"]');
}

window.addEventListener('keydown', (e) => {
  // Text fields keep every key. This handler used to map Space and the arrows
  // to driving and swallow them everywhere, so a nickname could not contain a
  // space and the caret could not be moved.
  if (isTextField(e.target)) return;
  // The waiting room drives nothing. Space starts the round for the host,
  // unless a control was reached with the keyboard, where Space presses it.
  if (waitingRoom) {
    const keyboardFocus = e.target.closest?.('button, a, [tabindex]') && e.target.matches?.(':focus-visible');
    if (e.code === 'Space' && !e.repeat && !keyboardFocus && !menuLayerOpen()
        && lobbyInfo?.hostId === localId) {
      e.preventDefault();
      socket.emit(EVENT.START);
    }
    return;
  }
  // On the menu, Space and Enter belong to whatever is focused (buttons, arena
  // cards), so nothing is mapped or swallowed until there is a kart to drive.
  if (!joined) return;
  // The in-match menu is up: keys are for its checkboxes, not the kart.
  if (drivingBlocked()) return;
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

/* ── Menu memory ────────────────────────────────────────────────────── */
/**
 * The nickname and the arena are remembered between visits, like the look.
 *
 * The name matters most for the people who never see the menu: someone who
 * arrives on an invite link types their name once in the waiting room, and
 * the next link a friend sends them already knows who they are.
 *
 * Storage can be missing or throw (private mode, blocked site data) and none
 * of this is worth an error, so every access is guarded.
 */
const NAME_KEY = 'kartcombat.name';
const MAP_KEY = 'kartcombat.map';

function rememberName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
}
function recallName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
function rememberMap(id) {
  try { localStorage.setItem(MAP_KEY, id); } catch { /* private mode */ }
}
function recallMap() {
  try {
    const id = localStorage.getItem(MAP_KEY);
    // An arena remembered from an older build may no longer exist.
    return MAP_IDS.includes(id) ? id : DEFAULT_MAP_ID;
  } catch {
    return DEFAULT_MAP_ID;
  }
}

let selectedMapId = recallMap();

// Prefill from last time so returning players are not retyping their name.
// This used to run before the storage key above was initialised, which threw
// inside recallName's try and left the field empty on every single visit.
if (nameInput && !nameInput.value) nameInput.value = recallName();
nameInput?.addEventListener('change', () => {
  const name = nameInput.value.trim();
  if (name) rememberName(name);
});

/* ── Turntable ──────────────────────────────────────────────────────── */
/**
 * The selected driver in their kart, slowly spinning: under the logo on the
 * main menu, and large on the Customize screen.
 *
 * It builds the *actual game mesh* on its own small renderer, so what you are
 * shown is what you will drive — an illustration of a kart would drift out of
 * date the first time the real one changed. Both screens share one canvas and
 * one renderer: the canvas is moved into whichever stage is showing, which
 * keeps the page at two WebGL contexts rather than three.
 */
const czEl = document.getElementById('customize');
const czCanvas = document.getElementById('cz-canvas');
const menuStageEl = document.getElementById('menu-stage');
const czStageEl = czEl?.querySelector('.cz-stage');
const menuLoadoutEl = document.getElementById('menu-loadout');
const czOptionsEl = document.getElementById('cz-options');
const czBlurbEl = document.getElementById('cz-blurb');
const czNameEl = document.getElementById('cz-name');
const czSubEl = document.getElementById('cz-sub');
const czCategoryEl = document.getElementById('cz-category');
const czCountEl = document.getElementById('cz-count');
const czTabs = [...document.querySelectorAll('.cz-tab')];

/** The colour a kart gets in game is by join order, so preview a fixed one. */
const PREVIEW_COLOR = 0xe74c3c;
/** A kart at rest, for apply(): no speed, no steering, nothing switched on. */
const PARKED = Object.freeze({
  x: 0, y: 0, z: 0, yaw: 0, speed: 0, yawRate: 0, steer: 0, accel: 0,
  grounded: true, alive: true,
});
/** Turntable spin, rad/s: slow enough to read, quick enough to look alive. */
const SPIN_RATE = 0.45;
/** Camera pitch above the model's middle: high enough to see the driver's face over the nose. */
const PREVIEW_PITCH = 0.3;
/**
 * Fraction of the bounding sphere kept in frame. The sphere is wider than the
 * kart seen from any one side, so filling it exactly leaves the model small.
 */
const PREVIEW_FIT = 0.84;
/** CSS size of an option thumbnail; rendered at the screen's pixel ratio. */
const THUMB_PX = 150;

let czTab = 'character';
let czPreview = null;

/** A soft dark disc that grounds the model on the checkerboard. */
function contactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(11, 42, 107, 0.5)');
  grad.addColorStop(0.55, 'rgba(11, 42, 107, 0.26)');
  grad.addColorStop(1, 'rgba(11, 42, 107, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePreview() {
  if (czPreview || !czCanvas) return czPreview;
  const renderer = new THREE.WebGLRenderer({ canvas: czCanvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  styleRenderer(renderer);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(createToyLights({ preview: true, shadowSize: 3 }));

  // The floor is invisible except where the kart's real shadow falls on it,
  // and a soft disc under that, so the kart stands on the checkerboard
  // instead of floating in front of it.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.ShadowMaterial({ color: 0x0b2a6b, opacity: 0.3 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture(), transparent: true, depthWrite: false, toneMapped: false,
    }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.005;
  scene.add(blob);

  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  // turntable spins and bobs; pivot inside it centres the model on the axis.
  const turntable = new THREE.Group();
  const pivot = new THREE.Group();
  turntable.add(pivot);
  scene.add(turntable);

  czPreview = {
    renderer, scene, cam, turntable, pivot, blob,
    mesh: null,
    // Start three-quarters on with the nose to the left, like a showroom.
    spin: -0.75,
    bob: 0,
    drag: null,
    w: 0,
    h: 0,
    radius: 2,
    centreY: 0.8,
    /** Option thumbnails as data URLs, keyed by tab, driver and kart. */
    thumbs: new Map(),
  };
  return czPreview;
}

/**
 * World-space bounds of what is actually drawn. Hidden parts — the shield
 * bubble and freeze block are 1.6 m spheres — are skipped along with their
 * children, and matrices are brought up to date first: measuring before they
 * were ignored the body's ride height and scale and cropped the tall karts.
 */
const boundsScratch = new THREE.Box3();
function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(boundsScratch.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  return box;
}

function refreshPreview() {
  const pv = makePreview();
  if (!pv) return;
  if (pv.mesh) {
    pv.pivot.remove(pv.mesh.group);
    pv.mesh.dispose();
  }
  pv.mesh = createKartMesh(PREVIEW_COLOR, '', {
    showTag: false, character: look.character, kart: look.kart,
  });
  pv.mesh.apply(PARKED, 0);
  pv.pivot.add(pv.mesh.group);

  // Frame from the model's own size rather than a fixed distance: chassis
  // differ a lot in length and height, and one camera position either
  // cropped the big ones or left the small ones swimming in empty space.
  // Measured in the turntable's own frame, so whatever angle it has spun to
  // does not skew the box.
  pv.turntable.rotation.set(0, 0, 0);
  pv.turntable.position.set(0, 0, 0);
  pv.pivot.position.set(0, 0, 0);
  const box = visibleBounds(pv.mesh.group);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  // Spin about the model's middle rather than the kart's origin, so a long
  // nose does not swing the whole model around the stage.
  pv.pivot.position.set(-centre.x, 0, -centre.z);
  pv.centreY = centre.y;
  // The bounding sphere does not change as the model turns, so the framing
  // holds still through the spin instead of breathing in and out.
  pv.radius = Math.max(0.5, 0.5 * Math.hypot(size.x, size.y, size.z));
  pv.blob.scale.setScalar(0.62 * Math.hypot(size.x, size.z));

  const char = CHARACTERS[look.character];
  const kart = KARTS[look.kart];
  if (czNameEl) czNameEl.textContent = char.name;
  if (czSubEl) czSubEl.textContent = `driving the ${kart.name}`;
  if (menuLoadoutEl) menuLoadoutEl.textContent = `${char.name} · ${kart.name}`;
}

/** Point the preview camera at the model, filling the stage's tighter axis. */
function framePreview(pv) {
  const vHalf = THREE.MathUtils.degToRad(pv.cam.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * pv.cam.aspect);
  const dist = (pv.radius * PREVIEW_FIT) / Math.sin(Math.min(vHalf, hHalf));
  pv.cam.position.set(0, pv.centreY + Math.sin(PREVIEW_PITCH) * dist, Math.cos(PREVIEW_PITCH) * dist);
  pv.cam.lookAt(0, pv.centreY, 0);
}

function drawPreview(dt) {
  const pv = czPreview;
  if (!pv) return;
  // Draw only while the stage holding the canvas is on screen: the menu's
  // until a match is joined, Customize's while that is open. A stage inside a
  // hidden screen reports no size.
  const w = czCanvas.clientWidth;
  const h = czCanvas.clientHeight;
  if (!w || !h) return;
  // Compare with the CSS size last applied, not canvas.width: that is in
  // device pixels, so on a HiDPI screen the two never matched and the drawing
  // buffer was reallocated on every frame.
  if (w !== pv.w || h !== pv.h) {
    pv.w = w;
    pv.h = h;
    pv.renderer.setSize(w, h, false);
    pv.cam.aspect = w / h;
    pv.cam.updateProjectionMatrix();
  }

  if (!pv.drag) pv.spin += dt * SPIN_RATE;
  pv.bob += dt;
  pv.turntable.rotation.y = pv.spin;
  // A gentle idle bob, as if the engine were ticking over.
  pv.turntable.position.y = Math.sin(pv.bob * 2.4) * 0.025;
  framePreview(pv);

  pv.mesh?.apply(PARKED, dt);
  pv.renderer.render(pv.scene, pv.cam);
}

// Drag the turntable to look round the kart; it resumes spinning on release.
czCanvas?.addEventListener('pointerdown', (e) => {
  if (!czPreview || e.button !== 0) return;
  czPreview.drag = { x: e.clientX, spin: czPreview.spin };
  czCanvas.setPointerCapture?.(e.pointerId);
  czCanvas.classList.add('dragging');
});
czCanvas?.addEventListener('pointermove', (e) => {
  const drag = czPreview?.drag;
  if (drag) czPreview.spin = drag.spin + (e.clientX - drag.x) * 0.012;
});
for (const type of ['pointerup', 'pointercancel']) {
  czCanvas?.addEventListener(type, () => {
    if (czPreview) czPreview.drag = null;
    czCanvas.classList.remove('dragging');
  });
}

/**
 * Pictures for the Customize grid, rendered with the turntable's own renderer
 * and kept as data URLs: a head shot for each driver (in your current kart),
 * a three-quarter view of each chassis (with your current driver in it).
 *
 * Done in one go per tab, all within the current task, so the borrowed canvas
 * is back at its own size before the browser next paints it.
 */
function optionThumbs(kind, defs) {
  const pv = makePreview();
  const urls = new Map();
  if (!pv) return urls;
  const keyOf = (id) => (kind === 'character'
    ? `character:${id}:${look.kart}`
    : `kart:${look.character}:${id}`);
  const missing = [];
  for (const def of defs) {
    const url = pv.thumbs.get(keyOf(def.id));
    if (url) urls.set(def.id, url);
    else missing.push(def);
  }
  if (!missing.length) return urls;

  const cam = new THREE.PerspectiveCamera(kind === 'character' ? 24 : 28, 1, 0.1, 80);
  const centre = new THREE.Vector3();
  const size = new THREE.Vector3();
  pv.renderer.setSize(THUMB_PX, THUMB_PX, false);
  pv.turntable.visible = false;
  pv.blob.visible = kind === 'kart';
  try {
    for (const def of missing) {
      const mesh = createKartMesh(PREVIEW_COLOR, '', {
        showTag: false,
        character: kind === 'character' ? def.id : look.character,
        kart: kind === 'kart' ? def.id : look.kart,
      });
      mesh.apply(PARKED, 0);
      pv.scene.add(mesh.group);
      const box = visibleBounds(mesh.group);
      box.getCenter(centre);
      box.getSize(size);
      if (kind === 'character') {
        // Drivers are the top of the model: frame its upper half, face on and
        // a touch from the side, from just above eye level.
        const look = new THREE.Vector3(centre.x, box.max.y - size.y * 0.27, centre.z);
        const dist = (size.y * 0.3) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
        cam.position.copy(look).add(new THREE.Vector3(0.32, 0.16, 1).normalize().multiplyScalar(dist));
        cam.lookAt(look);
      } else {
        // Nose to the right and a little towards us, the way the original
        // shows a chassis.
        const radius = 0.5 * Math.hypot(size.x, size.y, size.z);
        const dist = (radius * 0.92) / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2));
        cam.position.copy(centre).add(new THREE.Vector3(-0.95, 0.5, 0.55).normalize().multiplyScalar(dist));
        cam.lookAt(centre);
      }
      pv.renderer.render(pv.scene, cam);
      const url = pv.renderer.domElement.toDataURL('image/png');
      pv.scene.remove(mesh.group);
      mesh.dispose();
      pv.thumbs.set(keyOf(def.id), url);
      urls.set(def.id, url);
    }
  } finally {
    pv.turntable.visible = true;
    pv.blob.visible = true;
    // Forces drawPreview to size the canvas back to its stage next frame.
    pv.w = 0;
    pv.h = 0;
  }
  return urls;
}

/* ── Customize ──────────────────────────────────────────────────────── */
/** Mark the current pick without rebuilding the grid, so focus stays put. */
function markSelectedOption() {
  const table = czTab === 'character' ? CHARACTERS : KARTS;
  const ids = Object.keys(table);
  for (const btn of czOptionsEl?.children || []) {
    const selected = btn.dataset.id === look[czTab];
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-pressed', String(selected));
  }
  const current = table[look[czTab]];
  if (czBlurbEl) czBlurbEl.textContent = current?.blurb || '';
  if (czCountEl) czCountEl.textContent = `${ids.indexOf(look[czTab]) + 1} / ${ids.length}`;
}

function renderOptions() {
  if (!czOptionsEl) return;
  // Read from the shared tables every time: the roster of drivers and karts
  // is data, and this screen should never need editing when it changes.
  const defs = Object.values(czTab === 'character' ? CHARACTERS : KARTS);
  const thumbs = optionThumbs(czTab, defs);
  if (czCategoryEl) czCategoryEl.textContent = czTab === 'character' ? 'Drivers' : 'Karts';

  czOptionsEl.innerHTML = '';
  for (const def of defs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = def.id;
    btn.title = def.blurb || def.name;
    const pic = document.createElement('span');
    pic.className = 'cz-thumb';
    const url = thumbs.get(def.id);
    if (url) pic.style.backgroundImage = `url("${url}")`;
    const label = document.createElement('span');
    label.className = 'cz-label';
    label.textContent = def.name;
    btn.append(pic, label);

    btn.addEventListener('click', () => {
      look[czTab] = def.id;
      applyLook();
      markSelectedOption();
    });
    czOptionsEl.appendChild(btn);
  }
  markSelectedOption();
}

/** Persist, redraw the preview, and tell the server if we are already in. */
function applyLook() {
  rememberLook();
  refreshPreview();
  if (joined) socket.emit(EVENT.CUSTOMIZE, { character: look.character, kart: look.kart });
}

function selectTab(name) {
  czTab = name;
  for (const t of czTabs) {
    const on = t.dataset.tab === name;
    t.classList.toggle('selected', on);
    t.setAttribute('aria-selected', String(on));
  }
  renderOptions();
}
for (const tab of czTabs) tab.addEventListener('click', () => selectTab(tab.dataset.tab));

let czOpener = null;

function openCustomize() {
  if (!czEl) return;
  czOpener = document.activeElement;
  czEl.classList.remove('hidden');
  if (czStageEl && czCanvas) czStageEl.prepend(czCanvas);
  if (!czPreview?.mesh) refreshPreview();
  renderOptions();
  document.getElementById('cz-back')?.focus();
}

function closeCustomize() {
  if (!czEl || czEl.classList.contains('hidden')) return;
  czEl.classList.add('hidden');
  if (menuStageEl && czCanvas) menuStageEl.prepend(czCanvas);
  czOpener?.focus?.();
  czOpener = null;
}

document.getElementById('btn-customize')?.addEventListener('click', openCustomize);
document.getElementById('btn-waiting-customize')?.addEventListener('click', openCustomize);
document.getElementById('cz-back')?.addEventListener('click', closeCustomize);

document.getElementById('cz-random')?.addEventListener('click', () => {
  const chars = Object.keys(CHARACTERS);
  const karts = Object.keys(KARTS);
  look.character = chars[Math.floor(Math.random() * chars.length)];
  look.kart = karts[Math.floor(Math.random() * karts.length)];
  applyLook();
  // The other tab's pictures show the old pick in them, so redraw the grid.
  renderOptions();
});

// The menu's turntable is the first thing anyone sees, so build it now. The
// Customize grid and its thumbnails wait until that screen is opened.
refreshPreview();

/* ── Menu modals ────────────────────────────────────────────────────── */
const menuModals = [...document.querySelectorAll('.menu-modal')];
let modalOpener = null;

function openMenuModal() {
  return menuModals.find((m) => !m.classList.contains('hidden')) || null;
}

/** Customize or a menu dialog is up, so menu-level keys belong to it. */
function menuLayerOpen() {
  return !!openMenuModal() || !czEl?.classList.contains('hidden');
}

function openModal(el, focusEl) {
  if (!el) return;
  for (const m of menuModals) if (m !== el) m.classList.add('hidden');
  modalOpener = document.activeElement;
  el.classList.remove('hidden');
  (focusEl || el.querySelector('.tk-modal__close'))?.focus();
}

function closeModal(el) {
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('hidden');
  if (el === arenaModal) clearInterval(arenaPoll);
  modalOpener?.focus?.();
  modalOpener = null;
}

for (const modal of menuModals) {
  // The X, or a click on the dimmed backdrop around the card.
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) closeModal(modal);
  });
}

/** Keep Tab cycling inside the open dialog instead of wandering behind it. */
function trapFocus(e, layer) {
  const items = [...layer.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.getClientRects().length > 0);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (!layer.contains(document.activeElement)) {
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    first.focus();
  } else {
    return;
  }
  e.preventDefault();
}

// Escape closes the topmost menu layer — a dialog, else Customize — and
// nothing else sees that press. Registered for the capture phase on window,
// so it runs before every other keydown listener and can stop it there.
window.addEventListener('keydown', (e) => {
  const modal = openMenuModal();
  const layer = modal || (czEl?.classList.contains('hidden') ? null : czEl);
  if (!layer) return;
  if (e.key === 'Escape') {
    if (modal) closeModal(modal);
    else closeCustomize();
    e.preventDefault();
    e.stopPropagation();
  } else if (e.key === 'Tab') {
    trapFocus(e, layer);
  }
}, true);

/**
 * ◀ value ▶ selector over a fixed list of { value, label } choices. Wraps at
 * both ends, so neither arrow is ever dead. `set` updates the display without
 * calling onChange, for reflecting state that came from the server.
 */
function stepper(root, choices, initial, onChange) {
  const [prev, next] = root ? root.querySelectorAll('button') : [];
  const out = root?.querySelector('output');
  let index = Math.max(0, choices.findIndex((c) => c.value === initial));
  const show = () => { if (out) out.textContent = choices[index].label; };
  const step = (by) => {
    index = (index + by + choices.length) % choices.length;
    show();
    onChange?.(choices[index].value);
  };
  prev?.addEventListener('click', () => step(-1));
  next?.addEventListener('click', () => step(1));
  root?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    step(e.key === 'ArrowLeft' ? -1 : 1);
  });
  show();
  return {
    get value() { return choices[index].value; },
    set(value) {
      const i = choices.findIndex((c) => c.value === value);
      if (i >= 0 && i !== index) {
        index = i;
        show();
      }
    },
  };
}

// The choices every settings stepper offers, straight from the shared tables
// the server validates against, so no stepper can offer a value it would
// refuse.
const ARENA_CHOICES = MAP_IDS.map((id) => ({ value: id, label: getMap(id).name }));
const LENGTH_CHOICES = MATCH_LENGTHS.map((s) => ({ value: s, label: `${Math.round(s / 60)} Min` }));
const PLAYER_CHOICES = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => ({
  value: MIN_PLAYERS + i, label: String(MIN_PLAYERS + i),
}));
const SKILL_CHOICES = DIFFICULTY_IDS.map((id) => ({ value: id, label: getDifficulty(id).label }));
const RANDOM_ARENA = 'random';

/* ── Arena picker ───────────────────────────────────────────────────── */
const arenaModal = document.getElementById('arena-modal');
const mapCardsEl = document.getElementById('map-cards');
const playArenaEl = document.getElementById('play-arena');
/** Arenas wearing the "New" ribbon. */
const NEW_ARENAS = new Set(['harvestHollow']);
const PERSON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="4.5"/>'
  + '<path d="M3.5 21.5a8.5 8.5 0 0 1 17 0Z"/></svg>';
let arenaPoll = 0;

// One card per arena in the shared list, so a new arena shows up here without
// anyone touching the page.
for (const id of MAP_IDS) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'map-card';
  card.dataset.map = id;
  if (NEW_ARENAS.has(id)) {
    const ribbon = document.createElement('span');
    ribbon.className = 'map-new';
    ribbon.textContent = 'New';
    card.append(ribbon);
  }
  const name = document.createElement('span');
  name.className = 'map-name';
  name.textContent = getMap(id).name;
  // Hidden until the server has said how many people are on it.
  const count = document.createElement('span');
  count.className = 'map-count hidden';
  count.title = 'Players in public matches here now';
  count.innerHTML = `${PERSON_ICON}<span class="n"></span>`;
  card.append(name, count);
  card.addEventListener('click', () => {
    selectArena(id);
    closeModal(arenaModal);
  });
  mapCardsEl?.appendChild(card);
}

function selectArena(id) {
  selectedMapId = id;
  rememberMap(id);
  for (const card of mapCardsEl?.children || []) {
    const on = card.dataset.map === id;
    card.classList.toggle('selected', on);
    card.setAttribute('aria-pressed', String(on));
  }
  if (playArenaEl) playArenaEl.textContent = getMap(id).name;
  // Creating a match starts from the arena you last picked, too.
  createArena?.set(id);
}

/** A real screenshot over the painted card, once one exists. */
function showArenaThumb(card, src) {
  if (card.querySelector('img')) return;
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  // If it fails anyway, the painted card underneath is still there.
  img.addEventListener('error', () => img.remove());
  img.src = src;
  card.prepend(img);
}

/**
 * Live player counts, and thumbnails if any have been rendered. Images come
 * only from this list: requesting a picture that might not exist would put a
 * 404 in the console for every arena on every open.
 */
async function refreshArenas() {
  try {
    const res = await fetch('/api/arenas', { cache: 'no-store' });
    if (!res.ok) return;
    const { arenas = [] } = await res.json();
    for (const a of arenas) {
      const card = mapCardsEl?.querySelector(`.map-card[data-map="${CSS.escape(String(a.id))}"]`);
      if (!card) continue;
      const count = card.querySelector('.map-count');
      count.querySelector('.n').textContent = String(a.players ?? 0);
      count.classList.remove('hidden');
      if (a.thumb) showArenaThumb(card, a.thumb);
    }
  } catch { /* offline or mid-restart: the cards work without counts */ }
}

document.getElementById('btn-arena')?.addEventListener('click', () => {
  openModal(arenaModal, mapCardsEl?.querySelector('.map-card.selected'));
  refreshArenas();
  clearInterval(arenaPoll);
  arenaPoll = setInterval(refreshArenas, 10_000);
});

/* ── Create a private match ─────────────────────────────────────────── */
const createModal = document.getElementById('create-modal');
const createArena = stepper(document.getElementById('cr-arena'),
  [{ value: RANDOM_ARENA, label: 'Random' }, ...ARENA_CHOICES], selectedMapId);
const createLength = stepper(document.getElementById('cr-length'), LENGTH_CHOICES, DEFAULT_MATCH_SECONDS);
const createMax = stepper(document.getElementById('cr-max'), PLAYER_CHOICES, DEFAULT_MAX_PLAYERS);
const createSkill = stepper(document.getElementById('cr-skill'), SKILL_CHOICES, DEFAULT_DIFFICULTY);
const createBotsEl = document.getElementById('cr-bots');

selectArena(selectedMapId);

document.getElementById('btn-create')?.addEventListener('click', () => {
  openModal(createModal, document.getElementById('btn-create-party'));
});

document.getElementById('btn-create-party')?.addEventListener('click', () => {
  const mapId = createArena.value === RANDOM_ARENA
    ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)]
    : createArena.value;
  join(JOIN_MODE.PRIVATE, {
    mapId,
    maxPlayers: createMax.value,
    difficulty: createSkill.value,
    matchSeconds: createLength.value,
    fillWithBots: createBotsEl ? createBotsEl.checked : true,
  });
});

/* ── Join by code ───────────────────────────────────────────────────── */
const joinModal = document.getElementById('join-modal');
const joinCodeInput = document.getElementById('join-code');
const joinErrorEl = document.getElementById('join-error');

function showJoinError(message) {
  if (joinErrorEl) joinErrorEl.textContent = message;
  if (!joinCodeInput) return;
  // Re-adding the class restarts the shake for a second bad code in a row.
  joinCodeInput.classList.remove('is-error');
  void joinCodeInput.offsetWidth;
  joinCodeInput.classList.add('is-error');
  joinCodeInput.focus();
  joinCodeInput.select();
}

function clearJoinError() {
  if (joinErrorEl) joinErrorEl.textContent = '';
  joinCodeInput?.classList.remove('is-error');
}

joinCodeInput?.addEventListener('input', () => {
  joinCodeInput.value = normalizeRoomCode(joinCodeInput.value);
  clearJoinError();
});

document.getElementById('btn-join')?.addEventListener('click', () => {
  clearJoinError();
  openModal(joinModal, joinCodeInput);
});

document.getElementById('join-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeRoomCode(joinCodeInput?.value);
  if (code.length < ROOM_CODE_LENGTH) {
    showJoinError(`Match codes are ${ROOM_CODE_LENGTH} characters`);
    return;
  }
  join(JOIN_MODE.CODE, { code });
});

/* ── Joining ────────────────────────────────────────────────────────── */
const loadingEl = document.getElementById('loading');
const joinButtons = ['btn-play', 'btn-arena', 'btn-create', 'btn-join', 'btn-create-party', 'btn-join-code']
  .map((id) => document.getElementById(id))
  .filter(Boolean);
/** The join request in flight, { mode, fromInvite }, or null. */
let joining = null;
let joinTimer = 0;

function setJoinBusy(busy) {
  loadingEl?.classList.toggle('hidden', !busy);
  for (const btn of joinButtons) btn.disabled = busy;
}

function finishJoin() {
  joining = null;
  clearTimeout(joinTimer);
  setJoinBusy(false);
}

/**
 * Ask the server for a seat. One request at a time: the server treats a
 * second JOIN as leave-then-join, so a double-click on Create used to open two
 * rooms and swap the code shown under the player's feet.
 */
function join(mode, options = {}, fromInvite = false) {
  if (joining) return;
  const name = (nameInput?.value || '').trim() || recallName();
  if (name) rememberName(name);
  joining = { mode, fromInvite };
  setJoinBusy(true);
  socket.emit(EVENT.JOIN, {
    name: name || undefined,
    mapId: selectedMapId,
    character: look.character,
    kart: look.kart,
    mode,
    ...options,
  });
  // A server that never answers must not leave the player on a blue screen.
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => {
    if (!joining) return;
    finishJoin();
    toast('Could not reach the server. Try again in a moment.', 4000);
  }, 12_000);
}

document.getElementById('btn-play')?.addEventListener('click', () => join(JOIN_MODE.QUICK));

// The menu's half of the welcome: the connecting screen and any dialog go.
socket.on(EVENT.WELCOME, () => {
  finishJoin();
  for (const m of menuModals) m.classList.add('hidden');
  clearInterval(arenaPoll);
  modalOpener = null;
});

socket.on(EVENT.ERROR, (err) => {
  const attempt = joining;
  if (!attempt) return;
  finishJoin();
  // A dead invite link must not stay in the address bar, or every refresh
  // would walk straight back into the same error.
  if (attempt.fromInvite) history.replaceState(null, '', window.location.pathname);
  if (attempt.mode === JOIN_MODE.CODE) {
    if (joinModal?.classList.contains('hidden')) openModal(joinModal, joinCodeInput);
    showJoinError(err?.message || 'Could not join that match');
  }
});

socket.on('disconnect', () => { if (joining) finishJoin(); });

/* ── Invite links ───────────────────────────────────────────────────── */
const inviteEl = document.getElementById('invite');
const inviteCodeEl = document.getElementById('invite-code');

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

// The HUD's invite button opens a card (ui/modals.js); its Copy Link button
// is the one that hands the link over.
document.getElementById('btn-invite-copy')?.addEventListener('click', async () => {
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
const inviteParam = new URLSearchParams(window.location.search).get('join');
const invited = normalizeRoomCode(inviteParam);
if (invited.length === ROOM_CODE_LENGTH) {
  if (joinCodeInput) joinCodeInput.value = invited;
  // Straight to the connecting screen rather than a flash of the menu.
  loadingEl?.classList.remove('hidden');
  // Give socket.io a moment to connect; a JOIN sent before then is dropped.
  socket.on('connect', function joinInvited() {
    socket.off('connect', joinInvited);
    toast(`Joining match ${invited}…`);
    join(JOIN_MODE.CODE, { code: invited }, true);
  });
} else if (inviteParam !== null) {
  // Not even the shape of a code: it can never work, so do not keep it.
  history.replaceState(null, '', window.location.pathname);
}

document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
});

/* ── Waiting room ───────────────────────────────────────────────────── */
const waitingEl = document.getElementById('waiting');
const waitingArenaEl = document.getElementById('waiting-arena');
const waitingModeEl = document.getElementById('waiting-mode');
const waitingCodeEl = document.getElementById('waiting-code');
const waitingListEl = document.getElementById('waiting-list');
const waitingCountEl = document.getElementById('waiting-count');
const waitingHostEl = document.getElementById('waiting-host');
const waitingStartEl = document.getElementById('waiting-start');
const waitingGuestEl = document.getElementById('waiting-guest');
const waitingBotsEl = document.getElementById('waiting-bots');
const waitingNameEl = document.getElementById('waiting-name');
const startMatchBtn = document.getElementById('btn-start-match');

// The host's settings. Each change goes to the server, which validates it and
// echoes the room back to everyone; that echo is what the steppers then show.
const waitingArena = stepper(document.getElementById('waiting-arena-pick'), ARENA_CHOICES, DEFAULT_MAP_ID,
  (mapId) => socket.emit(EVENT.CONFIG, { mapId }));
const waitingLength = stepper(document.getElementById('waiting-length'), LENGTH_CHOICES, DEFAULT_MATCH_SECONDS,
  (matchSeconds) => socket.emit(EVENT.CONFIG, { matchSeconds }));
const waitingMax = stepper(document.getElementById('waiting-max'), PLAYER_CHOICES, DEFAULT_MAX_PLAYERS,
  (maxPlayers) => socket.emit(EVENT.CONFIG, { maxPlayers }));
const waitingSkill = stepper(document.getElementById('waiting-skill'), SKILL_CHOICES, DEFAULT_DIFFICULTY,
  (difficulty) => socket.emit(EVENT.CONFIG, { difficulty }));

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

document.getElementById('btn-waiting-leave')?.addEventListener('click', () => {
  // Drop the ?join= code too, or a refresh would walk straight back in.
  window.location.href = window.location.pathname;
});

function renderWaiting(state) {
  if (!waitingEl) return;
  const minutes = Math.round(state.matchSeconds / 60);
  if (waitingArenaEl) waitingArenaEl.textContent = getMap(state.mapId).name;
  if (waitingModeEl) waitingModeEl.textContent = `Free For All\n${minutes} Min${minutes === 1 ? '' : 's'}`;
  waitingCodeEl.textContent = state.code || '';
  waitingCountEl.textContent = `${state.players.length} / ${state.maxPlayers}`;

  // Reflect the authoritative name back, but never while they are mid-word:
  // overwriting a focused field would fight whoever is typing in it.
  const me = state.players.find((p) => p.i === localId);
  if (waitingNameEl && me && document.activeElement !== waitingNameEl) {
    waitingNameEl.value = me.n;
  }

  waitingListEl.innerHTML = '';
  state.players.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.i === localId) li.classList.add('me');
    const place = document.createElement('span');
    place.className = 'tk-hex';
    place.textContent = String(i + 1);
    const name = document.createElement('span');
    name.className = 'wr-name';
    name.textContent = p.n;
    li.append(place, name);
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
    // Their kart colour, so you can find them once the round starts.
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = `#${(p.c ?? 0x888888).toString(16).padStart(6, '0')}`;
    li.append(swatch);
    waitingListEl.appendChild(li);
  });

  // Only the host gets the controls; everyone else is told what they are
  // waiting for rather than shown a button that would do nothing.
  const isHost = state.hostId === localId;
  waitingHostEl?.classList.toggle('hidden', !isHost);
  waitingStartEl?.classList.toggle('hidden', !isHost);
  waitingGuestEl?.classList.toggle('hidden', isHost);
  if (isHost) {
    if (waitingBotsEl) waitingBotsEl.checked = !!state.fillWithBots;
    waitingArena.set(state.mapId);
    waitingLength.set(state.matchSeconds);
    waitingMax.set(state.maxPlayers);
    waitingSkill.set(state.difficulty);
  }
}

/**
 * Rebuild the arena if the room's has changed under us. The host can switch
 * arenas while people wait, and a client still holding the old one would
 * predict its kart against the wrong walls and index the wrong crates.
 */
function followArena(mapId) {
  if (!world || !mapId || world.map.id === mapId) return;
  const map = getMap(mapId);
  buildWorld({
    mapId: map.id,
    // The server reseats everyone at the start anyway; this is only where the
    // predictor waits until the first snapshot says otherwise.
    spawn: getSpawn(map.id, 0),
    boxes: map.boxes.map((b) => ({ x: b.x, y: b.y, z: b.z })),
    roster: [...rosterById.values()],
  });
}

/**
 * The waiting room's backdrop: a slow orbit high over the arena, so the place
 * you are about to play is on show. Nothing moved the camera here before, so
 * the room sat over an unframed view from wherever it had been built.
 */
function flyOver(dt) {
  const r = world.map.arenaRadius || 46;
  const a = elapsed * 0.05 + 0.7;
  camera.position.set(Math.sin(a) * r * 0.92, r * 0.55 + 6, Math.cos(a) * r * 0.92);
  camera.lookAt(0, 0, 0);
  world.render.update(dt, elapsed);
}

socket.on(EVENT.LOBBY, (state) => {
  lobbyInfo = state;
  if (!waitingRoom) return;
  followArena(state.mapId);
  renderWaiting(state);
});

socket.on(EVENT.STARTED, (started) => {
  followArena(started?.mapId);
  waitingRoom = false;
  waitingEl?.classList.add('hidden');
  closeCustomize();
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
  if (difficultyInput && welcome.difficulty) difficultyInput.value = welcome.difficulty;
  // Keep the address bar pointing at this match so a refresh or a copied URL
  // lands back in the same place — but only for a private room, which is the
  // only kind a code can take you back to. A quick match leaves the URL clean.
  history.replaceState(null, '', welcome.code ? inviteLink(welcome.code) : window.location.pathname);

  // ── Match flow starts from whatever the room is doing right now ──
  // Arriving between rounds is a normal case, not an edge one: the round
  // screens have to come up for a late joiner too, not only for people who
  // saw the whistle.
  matchInfo = {
    code: welcome.code || null,
    difficulty: welcome.difficulty,
    seconds: welcome.matchSeconds ?? lobbyInfo?.matchSeconds ?? DEFAULT_MATCH_SECONDS,
  };
  phase = welcome.status === ROOM_STATUS.LOBBY ? ROOM_STATUS.PLAYING : welcome.status;
  roundEnd = null;
  death = null;
  localSnapshot = null;
  camFollow = null;
  pingSamples.length = 0;
  sentAt.clear();
  refreshMatchInfo();
});

// A private match only learns its final length when the host starts it.
socket.on(EVENT.STARTED, () => {
  if (matchInfo && lobbyInfo?.matchSeconds) matchInfo.seconds = lobbyInfo.matchSeconds;
  refreshMatchInfo();
});

socket.on('roster', (list) => {
  const previous = rosterById;
  rosterById = new Map(list.map((p) => [p.i, p]));
  // Cosmetics can change mid-match, and a kart's shape is baked into its mesh
  // at build time — so anyone who swapped needs theirs rebuilt rather than
  // just relabelled.
  for (const p of list) {
    const before = previous.get(p.i);
    if (!before) continue;
    if (before.ch === p.ch && before.kt === p.kt) continue;
    const entry = karts.get(p.i);
    if (!entry) continue;
    scene.remove(entry.mesh.group);
    entry.mesh.dispose();
    karts.delete(p.i);
  }
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
    localSnapshotAt = performance.now();
    predictor.reconcile(mine);
    samplePing(mine.q);
  }

  // Back in a round after the round screens: whatever the match-over
  // message said is finished with, even if the match-start one went astray.
  const before = phase;
  phase = snap.ph || ROOM_STATUS.PLAYING;
  if (phase === ROOM_STATUS.PLAYING && before !== ROOM_STATUS.PLAYING) roundEnd = null;

  world?.fx.syncCrates(snap.b || []);
  world?.fx.syncProjectiles(snap.r || []);

  if (snap.e) for (const e of snap.e) handleEvent(e);
  updateHud(snap);
});

socket.on(EVENT.ERROR, (err) => toast(err?.message || 'Something went wrong'));
socket.on('disconnect', () => toast('Disconnected from server'));

function handleEvent(e) {
  world?.fx.handleEvent(e);

  if (e.t === 'hit') {
    karts.get(e.i)?.mesh.flash();
    if (e.i === localId) {
      shake.amount = Math.min(1, shake.amount + 0.35);
      if (e.d > 0) hud.flashHit(e.d);
      // A server that predates the weapon on kill events still says what
      // did the damage here, a moment earlier in the same batch.
      lastLocalHit = e;
    }
  } else if (e.t === 'kill') {
    if (e.i === localId) {
      shake.amount = 1;
      death = { by: e.by ?? null, w: e.w ?? lastLocalHit?.w ?? null, self: !!e.self };
      hud.showDeath(describeDeath(death));
    } else if (e.by && e.by === localId) {
      hud.smash(rosterById.get(e.i)?.n || 'someone');
    }
  } else if (e.t === 'pickup' && e.i === localId) {
    hud.startRoulette();
  } else if (e.t === 'respawn' && e.i === localId && predictor) {
    // Face the way the server spawned us; yaw 0 made the kart and camera
    // swing round on the first reconcile after every respawn.
    predictor.teleport({ x: e.x, y: e.y, z: e.z, yaw: e.a ?? localSnapshot?.a ?? 0 });
    death = null;
    lastLocalHit = null;
    // Cut, do not sweep: the next frame snaps the camera behind the kart.
    camFollow = null;
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
  // The local kart gets no name over it — you know who you are — only the
  // health bar once you are hurt (setLabel's showBar, per frame).
  const mesh = createKartMesh(info?.c ?? 0xcccccc, info?.n ?? id, {
    local: id === localId,
    character: info?.ch,
    kart: info?.kt,
  });
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

/* ── HUD and match flow ─────────────────────────────────────────────── */
/*
 * Protocol pieces from the round-loop rework: the respawn request, the
 * round-over phase and the respawn countdown. They are read through the
 * namespace with fallbacks rather than imported by name, because a named
 * import of an export that is not there is a SyntaxError that takes the
 * whole page down — and against a server without them this client simply
 * falls back to the old automatic respawn.
 */
const RESPAWN_EVENT = EVENT.RESPAWN ?? 'player:respawn';
const PHASE = Object.freeze({
  PLAYING: ROOM_STATUS.PLAYING,
  ROUND_OVER: ROOM_STATUS.ROUND_OVER ?? 'roundOver',
  RESULTS: ROOM_STATUS.RESULTS,
});
const RESPAWN_COUNTDOWN = SHARED.RESPAWN_COUNTDOWN ?? 3;
const ROUND_OVER_SECONDS = SHARED.ROUND_OVER_SECONDS ?? 3;
const RESULTS_SECONDS = SHARED.RESULTS_SECONDS ?? 12;
/** With Minimise Leaderboard on, the board folds this long after you spawn. */
const BOARD_FOLD_DELAY = 4;
/** Keys that never count as "any key": the menu key, modifiers, F-keys. */
const NOT_ANY_KEY = /^(Escape|Shift|Control|Alt|Meta|OS|Tab|CapsLock|Fn|F\d+$)/;

const hud = createHud();
const modals = createMatchModals({
  inMatch: () => joined && !waitingRoom,
  onOpenChange(open) {
    // Let go of everything held when the menu opens, or a key that was down
    // keeps driving the kart while the player reads the menu.
    if (open) for (const k of Object.keys(input)) input[k] = false;
    else canvas.focus();
  },
  onQuit() {
    socket.emit(EVENT.LEAVE);
    // The waiting room's Leave does the same; dropping ?join= stops a
    // refresh from walking straight back into the match.
    window.location.href = window.location.pathname;
  },
});

/** True while an in-match menu has the keyboard. */
function drivingBlocked() {
  return modals.open;
}

/** Round state from the server: 'playing' | 'roundOver' | 'results'. */
let phase = PHASE.PLAYING;
/**
 * The last match-over message, held until the next round starts:
 * { standings, winners: Set<id>, resultsAt, nextAt } (times in performance.now()).
 */
let roundEnd = null;
/** How the local player last died — { by, w, self } — until they respawn. */
let death = null;
/** The local player's latest hit, for servers whose kill events name no weapon. */
let lastLocalHit = null;
/** When localSnapshot arrived, so the respawn timer can count down between snapshots. */
let localSnapshotAt = 0;
/** Arena, length and bots for the intermission card and the info popup. */
let matchInfo = null;
/**
 * What the local player is doing this frame. One value drives the camera,
 * the prediction and the HUD, so they can never disagree about it.
 */
let flow = { phase: PHASE.PLAYING, life: 'alive', stage: null, count: 0, followId: null };
/** elapsed when the local kart last came (back) to life. */
let spawnedAt = 0;
/**
 * Who the camera followed last frame ('local', a player id, 'orbit'), or
 * null to force a cut on the next frame (respawn, new world).
 */
let camFollow = null;

function refreshMatchInfo() {
  if (!world || !matchInfo) return;
  const tier = getDifficulty(matchInfo.difficulty);
  hud.setMatchInfo({
    arena: world.map.name,
    minutes: Math.max(1, Math.round(matchInfo.seconds / 60)),
    botsLabel: tier.label,
    botsColour: DIFFICULTY_TINT[tier.id],
    code: matchInfo.code,
  });
}

/** Everyone sharing the top score, or nobody when nobody scored. */
function winnersOf(standings) {
  const top = Math.max(0, ...standings.map((p) => p.sc ?? 0));
  return top > 0 ? standings.filter((p) => p.sc === top).map((p) => p.i) : [];
}

/**
 * The round state to show. Normally the server's own phase; a match-over
 * message on its own (from a server without the round-over phase, or a
 * faked one in a test) still gets the ROUND OVER beat and then the winners,
 * timed from when it arrived.
 */
function displayPhase() {
  if (phase === PHASE.ROUND_OVER || phase === PHASE.RESULTS) return phase;
  if (roundEnd) return performance.now() < roundEnd.resultsAt ? PHASE.ROUND_OVER : PHASE.RESULTS;
  return PHASE.PLAYING;
}

/** Seconds until the next round, for "New Round Starting In N". */
function nextRoundIn() {
  if (phase !== PHASE.PLAYING && typeof latestSnapshot?.tl === 'number') return latestSnapshot.tl;
  if (roundEnd) return (roundEnd.nextAt - performance.now()) / 1000;
  return 0;
}

function adoptRoundEnd({ standings, winners, roundOverSeconds, nextIn }) {
  const now = performance.now();
  roundEnd = {
    standings,
    winners: new Set(winners ?? winnersOf(standings)),
    resultsAt: now + roundOverSeconds * 1000,
    nextAt: now + nextIn * 1000,
  };
  hud.setResults({ standings, winners: roundEnd.winners, localId });
}

/**
 * Someone who arrives mid-way through the round screens and was never told
 * how the round ended still gets a winners screen: scoring is frozen once
 * the round is over, so the live scores *are* the final ones.
 */
function adoptRoundEndFromSnapshot(snap) {
  let rank = 0;
  let prev = null;
  const standings = rankPlayers(snap.p).map((p, i) => {
    // Competition ranking: ties share a place, the next place skips.
    if (p.sc !== prev) { rank = i + 1; prev = p.sc; }
    const info = rosterById.get(p.i);
    return { i: p.i, n: info?.n || p.i, ai: info?.ai, c: info?.c, sc: p.sc, k: p.k, rank };
  });
  adoptRoundEnd({ standings, winners: null, roundOverSeconds: 0, nextIn: nextRoundIn() });
}

function isAlive(id) {
  return latestSnapshot?.p.some((p) => p.i === id && p.al === 1) ?? false;
}

/** An interpolated remote pose in the shape the camera and meshes take. */
function sampleView(id) {
  const s = interp.sample(id);
  if (!s) return null;
  return {
    x: s.x, y: s.y, z: s.z, yaw: s.yaw,
    speed: s.sp ?? 0, yawRate: s.yr ?? 0,
    drifting: s.dr === 1, grounded: s.g === 1, boost: s.bt > 0, stunned: s.st > 0,
  };
}

/**
 * Death → spectate → continue, and sitting a round out, from the local
 * player's snapshot. `rt` is the server's seconds-until-respawn-allowed: the
 * camera holds on the wreck while it is above the countdown, then watches
 * the killer through a 3-2-1, then waits for a key. A server that sends no
 * `rt` respawns everyone by itself, so the wreck is all there is to show.
 */
function computeFlow() {
  const next = { phase: displayPhase(), life: 'alive', stage: null, count: 0, followId: localId };
  const mine = localSnapshot;
  if (mine?.jn === 0) {
    next.life = 'out';
    next.followId = null;
  } else if (mine && mine.al === 0) {
    next.life = 'dead';
    next.stage = 'wreck';
    if (typeof mine.rt === 'number') {
      const left = Math.max(0, mine.rt - (performance.now() - localSnapshotAt) / 1000);
      if (mine.rt <= 0) {
        next.stage = 'continue';
      } else if (left <= RESPAWN_COUNTDOWN) {
        next.stage = 'spectate';
        next.count = Math.max(1, Math.ceil(left));
      }
    }
    // Watch whoever did it — as long as they are still out there to watch.
    if (next.stage !== 'wreck' && mine.kb && isAlive(mine.kb)) next.followId = mine.kb;
  }
  // The winners screen follows a winner around, unless you are one.
  if (next.phase === PHASE.RESULTS && roundEnd && !roundEnd.winners.has(localId)) {
    const winner = [...roundEnd.winners].find(isAlive);
    if (winner) next.followId = winner;
  }
  return next;
}

/* Board rows: frozen standings on the round screens, live scores otherwise. */
function boardRows(snap) {
  const live = rankPlayers(snap.p);
  const nameOf = (id) => rosterById.get(id)?.n || id;
  const colourOf = (id) => rosterById.get(id)?.c;
  if (displayPhase() !== PHASE.PLAYING && roundEnd?.standings.length) {
    const rows = roundEnd.standings.map((p) => ({ i: p.i, n: p.n, c: p.c, sc: p.sc }));
    // Anyone who arrived after the whistle is still listed, with a dash.
    const listed = new Set(rows.map((r) => r.i));
    for (const p of live) {
      if (!listed.has(p.i)) rows.push({ i: p.i, n: nameOf(p.i), c: colourOf(p.i), sc: null });
    }
    return rows;
  }
  return live.map((p) => ({ i: p.i, n: nameOf(p.i), c: colourOf(p.i), sc: p.jn === 0 ? null : p.sc }));
}

/** Per snapshot: everything the HUD shows that comes from the server. */
function updateHud(snap) {
  const mine = localSnapshot;
  if (mine) {
    hud.setHealth(mine.al ? mine.h : 0);
    hud.setWeapon({ w: mine.al ? mine.w : null, wn: mine.wn, wt: mine.wt });
  }
  // `tl` is the server's clock, so every client reads the same countdown
  // rather than each browser counting on its own and drifting apart.
  if (typeof snap.tl === 'number' && phase === PHASE.PLAYING) hud.setClock(snap.tl);

  const rows = boardRows(snap);
  // Folded down to the leaders and you while you drive; open while you are
  // dead, on the round screens and whenever the player pins it open.
  const folded = settings.minimiseLeaderboard && !hud.boardPinned
    && flow.life === 'alive' && flow.phase === PHASE.PLAYING
    && elapsed - spawnedAt > BOARD_FOLD_DELAY;
  hud.setBoard(rows, localId, { folded });
  if (flow.life === 'out') hud.setIntermissionBoard(rows, localId);
}

/**
 * The two lines over the wreck. Our own wording for the original's beat:
 * "You were smashed by / <Name>'s <weapon>", with variants for falling off
 * and for your own weapon.
 */
function describeDeath({ by, w, self }) {
  const def = w ? WEAPONS[w] : null;
  const what = def?.killName || def?.name?.toLowerCase() || '';
  if (w === 'void') return { line1: 'You fell off the arena' };
  if (self || (by && by === localId)) {
    return { line1: 'You were smashed by', rest: what ? `your own ${what}` : 'yourself' };
  }
  const killer = by ? rosterById.get(by)?.n : null;
  if (killer) return { line1: 'You were smashed by', killer: what ? `${killer}'s` : killer, rest: what };
  return { line1: 'You were smashed!' };
}

socket.on(EVENT.MATCH_OVER, (payload = {}) => {
  const standings = payload.standings || [];
  const roundOverSeconds = payload.roundOverSeconds ?? ROUND_OVER_SECONDS;
  adoptRoundEnd({
    standings,
    winners: payload.winners ?? null,
    roundOverSeconds,
    nextIn: payload.nextIn ?? roundOverSeconds + RESULTS_SECONDS,
  });
  // Let go of the controls: holding forward through the round screens
  // should not bank anyone a head start the moment the next round begins.
  for (const k of Object.keys(input)) input[k] = false;
  syncHud();
});

socket.on(EVENT.MATCH_START, (payload = {}) => {
  roundEnd = null;
  phase = PHASE.PLAYING;
  if (matchInfo && payload.seconds) {
    matchInfo.seconds = payload.seconds;
    refreshMatchInfo();
  }
  interp.clear();
  canvas.focus();
  syncHud();
});

/** Apply the current state to the HUD now, without waiting for a frame. */
function syncHud() {
  if (!joined || waitingRoom) return;
  flow = computeFlow();
  hud.setMode(flow);
}

/* ── Respawn and join requests ── */

/**
 * Keys already down when "Press Any Key" appears do not count: you were
 * holding W when you died, and that must not respawn you the instant the
 * prompt shows. Only a fresh press does.
 */
const keysDown = new Set();
let staleKeys = new Set();
/** Whether "Press Any Key" was showing last frame. */
let promptUp = false;

function requestRespawn() {
  socket.emit(RESPAWN_EVENT);
}

window.addEventListener('keydown', (e) => {
  const fresh = !e.repeat && !staleKeys.has(e.code);
  keysDown.add(e.code);
  if (!joined || waitingRoom || drivingBlocked()) return;
  if (flow.life === 'out' && e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) requestRespawn();
    return;
  }
  if (flow.stage === 'continue' && fresh && !NOT_ANY_KEY.test(e.code)) requestRespawn();
});
window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
  staleKeys.delete(e.code);
});
window.addEventListener('blur', () => {
  keysDown.clear();
  staleKeys.clear();
});
canvas.addEventListener('pointerdown', () => {
  if (flow.stage === 'continue') requestRespawn();
});
document.getElementById('btn-join-round')?.addEventListener('click', () => {
  requestRespawn();
  canvas.focus();
});

/* ── Ping ── */

/** Send time of each input command, so its acknowledgement times the round trip. */
const sentAt = new Map();
const pingSamples = [];

/**
 * Round trip from input acknowledgements: the time from sending command N
 * to the first snapshot saying the server has applied it. That includes up
 * to one snapshot interval of waiting on the server, so show the best of
 * the last two seconds, which sits close to the wire time. No extra traffic
 * and nothing needed from the server.
 */
function samplePing(ackSeq) {
  const now = performance.now();
  const sent = sentAt.get(ackSeq);
  if (sent !== undefined) pingSamples.push({ t: now, ms: now - sent });
  // Map iterates in insertion order, which is sequence order.
  for (const seq of sentAt.keys()) {
    if (seq > ackSeq && sentAt.size < 600) break;
    sentAt.delete(seq);
  }
  while (pingSamples.length && now - pingSamples[0].t > 2000) pingSamples.shift();
  if (pingSamples.length) hud.setPing(Math.min(...pingSamples.map((s) => s.ms)));
}

/* ── Camera helpers for the match flow ── */

const ORBIT_FOV = 55;
let orbitAngle = 0;

/**
 * Slow fly-round of the arena while you sit a round out, so what is behind
 * the intermission card is the match you are about to join. Driven here
 * rather than through updateCamera, which follows a kart.
 */
function orbitCamera(dt) {
  orbitAngle += dt * 0.07;
  const r = (world.map.arenaRadius || 46) * 1.15;
  camera.position.set(Math.sin(orbitAngle) * r, r * 0.5, Math.cos(orbitAngle) * r);
  camera.lookAt(0, 0, 0);
  camera.fov = ORBIT_FOV;
  camera.updateProjectionMatrix();
}

const anchorVec = new THREE.Vector3();

/** Screen point a little above a kart, for the spectate countdown. */
function anchorAbove(view) {
  anchorVec.set(view.x, view.y + 3.4, view.z).project(camera);
  if (anchorVec.z > 1 || Math.abs(anchorVec.x) > 1.1) return null;
  const h = window.innerHeight;
  return {
    x: ((anchorVec.x + 1) / 2) * window.innerWidth,
    y: Math.min(h * 0.62, Math.max(h * 0.16, ((1 - anchorVec.y) / 2) * h)),
  };
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
/** Angular velocity of that heading — it is a spring, not a lerp. */
let camYawVel = 0;
/** The point the boom hangs from: the followed kart, with its height eased. */
const camPivot = new THREE.Vector3();
/** Eased ground gradient under the kart, along and across the camera heading. */
const camSlope = { along: 0, across: 0 };
let camFov = CAMERA.fov;
/** The world the camera was last placed in. A different one means cut, not glide. */
let camWorld = null;
const camUp = new THREE.Vector3();
const camAnchor = new THREE.Vector3();
const camBack = new THREE.Vector3();
const camRay = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

/*
 * Slope of the ground under a kart, for drawing it lying along the surface.
 * Purely cosmetic: physics keeps karts upright and only tracks the height
 * under their centre, so on a bowl or a ramp a level kart would push its nose
 * or tail into the surface. Samples the same solids the physics stands on,
 * under the front and back axles and the left and right wheels.
 */
const TILT_HALF_BASE = 1.1;
const TILT_HALF_TRACK = 0.8;
const TILT_MAX = 0.5;
function groundTilt(x, y, z, yaw) {
  const { solids, floorY } = world.map;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // +X is the kart's left when it faces +Z.
  const lx = fz;
  const lz = -fx;
  const at = (dx, dz) => {
    const h = sampleGround(solids, x + dx, z + dz, y, floorY);
    // Off an edge, or under something: no lean towards it.
    return Math.abs(h - y) > 1.2 ? y : h;
  };
  const front = at(fx * TILT_HALF_BASE, fz * TILT_HALF_BASE);
  const back = at(-fx * TILT_HALF_BASE, -fz * TILT_HALF_BASE);
  const left = at(lx * TILT_HALF_TRACK, lz * TILT_HALF_TRACK);
  const right = at(-lx * TILT_HALF_TRACK, -lz * TILT_HALF_TRACK);
  const clamp = (v) => Math.max(-TILT_MAX, Math.min(TILT_MAX, v));
  return {
    groundPitch: clamp(Math.atan2(front - back, TILT_HALF_BASE * 2)),
    groundRoll: clamp(Math.atan2(left - right, TILT_HALF_TRACK * 2)),
  };
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  elapsed += dt;

  if (joined && predictor && world && !waitingRoom) {
    const previousLife = flow.life;
    flow = computeFlow();
    if (flow.life === 'alive' && previousLife !== 'alive') {
      spawnedAt = elapsed;
      if (flow.phase === PHASE.PLAYING) hud.showHint();
    }
    // Whatever is held as the prompt comes up has been held since the death.
    if (flow.stage === 'continue' && !promptUp) staleKeys = new Set(keysDown);
    promptUp = flow.stage === 'continue';

    // ── Local kart: predict, then ship the commands we just simulated ──
    // Only while driving. A wreck, or a kart sitting the round out, is the
    // server's to place; predicting it anyway replayed an ever-growing
    // backlog of unacknowledged input on every snapshot and slid the wreck
    // (and the camera with it) across the floor.
    if (flow.life === 'alive') {
      const commands = predictor.advance(dt, input);
      if (commands.length) {
        const sentTime = performance.now();
        for (const c of commands) sentAt.set(c.seq, sentTime);
        outbox.push(...commands);
        socket.emit(EVENT.INPUT, outbox.splice(0, outbox.length));
      }
    }

    const view = flow.life === 'alive' ? predictor.view() : (sampleView(localId) || predictor.view());
    const localEntry = kartFor(localId);
    const localHp = localSnapshot?.h ?? MAX_HP;
    const hurt = localHp < MAX_HP;
    localEntry.mesh.apply({
      ...view,
      ...groundTilt(view.x, view.y, view.z, view.yaw),
      steer: flow.life === 'alive' ? (input.left ? 1 : 0) - (input.right ? 1 : 0) : 0,
      accel: (view.speed - localEntry.prevSpeed) / Math.max(dt, 1e-4),
      shield: localSnapshot?.sh === 1,
      spawnShield: localSnapshot?.iv === 1,
      orbit: localSnapshot?.w === 'spikes' && localSnapshot?.wt === 1,
      invisible: localSnapshot?.iz === 1,
      isLocal: true,
      alive: localSnapshot ? localSnapshot.al === 1 : true,
      // Your own bar only shows once you are hurt; at full health it would
      // just sit in the middle of the view.
      tagOpacity: hurt ? 1 : 0,
      camDist: camera.position.distanceTo(tmpVec.set(view.x, view.y, view.z)),
    }, dt);
    // Sitting the round out: there is no kart of yours in it.
    if (flow.life === 'out') localEntry.mesh.group.visible = false;
    localEntry.prevSpeed = view.speed;
    localEntry.mesh.setLabel(rosterById.get(localId)?.n || 'You', localHp, { showBar: hurt });

    // Karts that leave tyre marks and smoke this frame. An invisible kart
    // leaves nothing behind (that would give it away), and nobody sitting
    // the round out is on the track at all.
    const trailKarts = [];
    if (flow.life !== 'out' && localSnapshot?.iz !== 1) {
      trailKarts.push({
        id: localId, x: view.x, y: view.y, z: view.z, yaw: view.yaw,
        speed: view.speed, yawRate: view.yawRate, drifting: view.drifting,
        grounded: view.grounded, alive: localSnapshot ? localSnapshot.al === 1 : true,
      });
    }

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
        ...groundTilt(sample.x, sample.y, sample.z, sample.yaw),
        boost: sample.bt > 0,
        stunned: sample.st > 0,
        shield: sample.sh === 1,
        spawnShield: sample.iv === 1,
        orbit: sample.w === 'spikes' && sample.wt === 1,
        invisible: sample.iz === 1,
        alive: sample.al === 1,
        steer: THREE.MathUtils.clamp(sample.yr / 2, -1, 1),
        accel: (sample.sp - entry.prevSpeed) / Math.max(dt, 1e-4),
        tagOpacity: tagOpacity(sample.x, sample.y, sample.z),
        camDist: camera.position.distanceTo(tmpVec.set(sample.x, sample.y, sample.z)),
      }, dt);
      // Someone sitting the round out is not on the track.
      if (sample.jn === 0) entry.mesh.group.visible = false;
      else if (sample.iz !== 1) {
        trailKarts.push({
          id, x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw,
          speed: sample.sp, yawRate: sample.yr, drifting: sample.dr === 1,
          grounded: sample.g === 1, alive: sample.al === 1,
        });
      }
      entry.prevSpeed = sample.sp;
      entry.mesh.setLabel(info.n, sample.h, { badge: sample.sc, showBar: true });
    }

    world.render.update(dt, elapsed);
    world.fx.trackKarts(trailKarts);
    world.fx.update(dt, elapsed);

    // ── Camera: your kart, your wreck, your killer, a winner, or a fly-round ──
    let camView = view;
    if (flow.life === 'out') {
      orbitCamera(dt);
      camFollow = 'orbit';
    } else {
      const watched = flow.followId && flow.followId !== localId ? sampleView(flow.followId) : null;
      camView = watched || view;
      const camId = watched ? flow.followId : 'local';
      // Changing who is watched is a cut, not a swoop across the arena.
      if (camId !== camFollow) {
        snapCamera(camView);
        camFollow = camId;
      }
      updateCamera(camView, dt);
    }

    hud.setMode(flow);
    if (flow.stage === 'spectate') hud.setSpectateAnchor(anchorAbove(camView));
    if (flow.phase === PHASE.RESULTS) {
      if (!roundEnd && latestSnapshot) adoptRoundEndFromSnapshot(latestSnapshot);
      hud.setResultsCountdown(nextRoundIn());
    }
    hud.frame(dt);
  } else if (joined && world && waitingRoom) {
    flyOver(dt);
  }

  renderer.render(scene, camera);
  // The customize screen has its own tiny renderer; spin it from the same
  // clock rather than starting a second animation loop.
  drawPreview(dt);
}

/**
 * Walk from the kart out to where the camera wants to be and stop at the first
 * thing in the way, so the view never ends up inside a wall. This queries the
 * same solids the physics uses, so it is always consistent with the arena.
 */
function cameraBlocked(px, py, pz) {
  for (const s of world.map.solids) {
    // Rings are hollow walls that hold karts in; keep the camera inside them.
    if (s.t === 'ring') {
      if (py < s.y || py > s.y + s.h) continue;
      if (Math.hypot(px - s.x, pz - s.z) > s.r - 0.5) return true;
      continue;
    }
    if (s.passThrough) continue;
    if (py < s.y || py > s._top + CAMERA.clearance) continue;
    // Against the surface actually there, not the solid's bounding height:
    // pointInSolid treats a ramp as a block up to its high edge, which is fine
    // for spawning but made the boom "hit" the open air above every ramp and
    // slam the camera into the back of the kart whenever one was behind it.
    const top = topAt(s, px, pz);
    if (top !== null && py <= top + CAMERA.clearance) return true;
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

/**
 * The chase camera. `view` is whichever kart should be followed — normally
 * the local one, the killer while spectating — with at least x, y, z, yaw and
 * speed. Called once per frame.
 */
function updateCamera(view, dt) {
  // Debug flyover used by the automated play test to inspect arena layout.
  if (window.__freeCam) {
    // `true` is the overhead overview; scripts that frame a shot themselves
    // (the arena thumbnails) pass { pos: [x, y, z], look: [x, y, z] }.
    const pose = window.__freeCam;
    const r = (world.map.arenaRadius || 46) * 1.55;
    if (pose.pos) camera.position.set(...pose.pos);
    else camera.position.set(r * 0.72, r * 0.95, r * 0.72);
    camera.up.copy(WORLD_UP);
    if (pose.look) camera.lookAt(...pose.look);
    else camera.lookAt(0, 0, 0);
    camera.fov = CAMERA.fov;
    camera.updateProjectionMatrix();
    return;
  }

  // A new arena, or a followed kart that jumped further than anything can
  // drive in a frame (a respawn, a switch of spectate target), is a cut. Easing
  // across it would sweep the camera through the scenery for half a second.
  const cut = camWorld !== world
    || Math.hypot(view.x - camPivot.x, view.z - camPivot.z) > CAMERA.cutDistance
    || Math.abs(view.y - camPivot.y) > CAMERA.cutDistance * 3;
  placeCamera(view, dt, cut);
}

/**
 * Put the camera straight behind `view` with nothing eased: no swing, no
 * glide, no settling. Used on respawn and whenever the followed kart changes
 * abruptly, where any smoothing would only show the camera catching up.
 */
function snapCamera(view) {
  if (!world || !view) return;
  placeCamera(view, 0, true);
}

/** Wrap an angle difference into (-π, π]. */
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Ground gradient under the followed kart, measured along and across the
 * camera's heading (rise per metre). Samples the same surfaces the physics
 * stands on, a kart-length either side, so ramps and the bowl's terraces read
 * as one slope rather than as the step under each wheel.
 *
 * A sample that lands off a ledge (the void around the floating islands, the
 * drop off a deck) would read as a cliff, so anything far from the kart's own
 * height counts as level ground at the kart instead.
 */
function groundSlope(x, y, z) {
  const { solids, floorY } = world.map;
  const SPAN = 1.6;
  const feet = y + 0.6;
  const height = (dx, dz) => {
    const h = sampleGround(solids, x + dx, z + dz, feet, floorY ?? 0);
    return Math.abs(h - y) > 1.6 ? y : h;
  };
  const fx = forward.x * SPAN;
  const fz = forward.z * SPAN;
  // Right of the heading is (cos yaw, 0, -sin yaw) in this world's convention.
  const rx = forward.z * SPAN;
  const rz = -forward.x * SPAN;
  const clamp = (g) => Math.max(-0.5, Math.min(0.5, g));
  return {
    along: clamp((height(fx, fz) - height(-fx, -fz)) / (2 * SPAN)),
    across: clamp((height(rx, rz) - height(-rx, -rz)) / (2 * SPAN)),
  };
}

function placeCamera(view, dt, snap) {
  camWorld = world;
  const ease = (rate) => (snap ? 1 : 1 - Math.exp(-rate * dt));

  // ── Heading: a critically damped spring ──
  //
  // The kart turns first and the camera swings round after it, which is what
  // makes steering read on screen — with the camera locked to the heading the
  // kart never appears to turn at all, the world just rotates. A plain lerp
  // lags the same way but starts swinging at full rate the instant you steer,
  // which reads as the camera twitching; the spring builds up and settles,
  // and being critically damped it never swings past the kart. It also
  // filters the small yaw corrections every snapshot brings, which a ~10 m
  // boom would otherwise multiply into visible shake.
  //
  // This is the exact solution for a target held still over the step, so it
  // stays stable and overshoot-free at any frame rate.
  if (snap) {
    camYaw = view.yaw;
    camYawVel = 0;
  } else {
    const w = CAMERA.yawFollow;
    const aim = view.yaw + (view.yawRate || 0) * CAMERA.yawLead;
    const x = wrapAngle(camYaw - aim);
    const decay = Math.exp(-w * dt);
    const temp = (camYawVel + w * x) * dt;
    camYawVel = (camYawVel - w * temp) * decay;
    camYaw = wrapAngle(aim + (x + temp) * decay);
  }
  forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));

  // ── Pivot ──
  //
  // Horizontally the camera is rigidly attached: the original keeps the kart
  // in exactly the same place on screen at a standstill and flat out, and any
  // positional lag shows up as the kart creeping up the screen with speed.
  // Height is eased, so a bump, a step or a jump lifts the kart on screen for
  // a moment and the camera follows it up instead of jolting.
  if (snap) camPivot.set(view.x, view.y, view.z);
  else {
    camPivot.x = view.x;
    camPivot.z = view.z;
    camPivot.y += (view.y - camPivot.y) * ease(CAMERA.heightFollow);
  }

  // ── Slope tilt (Camera Tilt setting) ──
  //
  // Lean part of the way into the ground's slope: up a ramp the camera drops
  // and looks up it, over a crest it rises and looks down the far side, and on
  // the bowl's banked sides the horizon rolls with you. Airborne, the last
  // slope is held so a jump does not level the camera mid-flight.
  if (settings.cameraTilt) {
    if (view.grounded !== false || snap) {
      const g = groundSlope(view.x, view.y, view.z);
      const k = ease(CAMERA.tiltFollow);
      camSlope.along += (g.along - camSlope.along) * k;
      camSlope.across += (g.across - camSlope.across) * k;
    }
  } else {
    const k = ease(CAMERA.tiltFollow * 2);
    camSlope.along -= camSlope.along * k;
    camSlope.across -= camSlope.across * k;
  }
  // The rig's up is the world's, leaned toward the ground normal. For a height
  // field the normal is (-∂h/∂x, 1, -∂h/∂z); the gradient here is in the
  // camera's own (forward, right) frame.
  const t = CAMERA.tilt;
  camUp.set(
    -(forward.x * camSlope.along + forward.z * camSlope.across) * t,
    1,
    -(forward.z * camSlope.along - forward.x * camSlope.across) * t,
  ).normalize();
  // Forward along the leaned plane, so the boom follows the slope too.
  camBack.copy(forward).addScaledVector(camUp, -forward.dot(camUp)).normalize();

  // ── Boom ──
  const speedK = Math.min(1, Math.abs(view.speed || 0) / KART.maxSpeed);
  const back = CAMERA.back + speedK * CAMERA.speedPullBack;
  const rise = CAMERA.height - CAMERA.anchor;
  camAnchor.copy(camPivot).addScaledVector(camUp, CAMERA.anchor);
  const ax = camAnchor.x;
  const ay = camAnchor.y;
  const az = camAnchor.z;

  // Climb over scenery before giving up any distance.
  //
  // Shortening the boom is the only move a pull-in-only camera has, and on a
  // stepped arena — the terraced dish, the floating islands — the distance it
  // can keep genuinely changes as the kart crosses each step. Chasing that
  // stepping value at 26/s inward and 4/s outward ratchets the camera in and
  // lets it drift out again every few frames, which is most of the judder on
  // those two maps. Lifting the boom instead usually clears the obstacle with
  // no loss of distance at all, and the pitch it settles on moves smoothly
  // because it is eased rather than recomputed from scratch. The boom starts
  // high enough to see over the arena's low walls, so in open play none of
  // this runs past the first probe.
  const boomAt = (lift) => camRay.copy(camBack).multiplyScalar(-back).addScaledVector(camUp, rise * lift);
  const PITCHES = [1, 1.3, 1.65, 2.1];
  let bestPitch = PITCHES[PITCHES.length - 1];
  let bestClear = 0;
  for (const pitch of PITCHES) {
    const b = boomAt(pitch);
    const len = b.length() || 1;
    const got = unobstructedDistance(ax, ay, az, b.x / len, b.y / len, b.z / len, len);
    if (got > bestClear) { bestClear = got; bestPitch = pitch; }
    // Near enough to the full boom that lifting further would only cost the
    // player their view of the arena ahead.
    if (got >= len - 0.25) { bestPitch = pitch; break; }
  }
  // Rise quickly, settle back slowly. Without the asymmetry the probe flips
  // between two neighbouring pitches every few frames on a bowl-shaped arena —
  // where the terrace behind the kart is forever crossing the boom — and the
  // camera oscillates instead of holding a line. Being slow to come back down
  // costs nothing a player would notice.
  camPitch += (bestPitch - camPitch) * ease(bestPitch > camPitch ? 12 : 2.0);

  const boom = boomAt(camPitch);
  const boomLen = boom.length() || 1;
  boom.divideScalar(boomLen);
  const clear = Math.max(3.0, unobstructedDistance(ax, ay, az, boom.x, boom.y, boom.z, boomLen));

  // Ease the boom length itself rather than switching the camera between two
  // follow speeds. Pulling in has to be quick, because a slow push through a
  // wall is very obvious; letting back out is slow, because nobody notices it.
  camBoom += (clear - camBoom) * ease(clear < camBoom ? 26 : 4);

  camTarget.copy(camAnchor).addScaledVector(boom, camBoom);
  camLook.copy(camPivot)
    .addScaledVector(camBack, CAMERA.lookAhead)
    .addScaledVector(camUp, CAMERA.lookHeight);

  camera.position.copy(camTarget);
  camera.up.copy(camUp);
  camera.lookAt(camLook);

  // Field of view eases too: boost toggling it by 5° in one frame read as a
  // glitch, not a kick.
  const fov = CAMERA.fov + speedK * CAMERA.speedFov + (view.boost ? CAMERA.boostFov : 0);
  camFov += (fov - camFov) * ease(5);
  if (Math.abs(camera.fov - camFov) > 1e-3) {
    camera.fov = camFov;
    camera.updateProjectionMatrix();
  }

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
  get localId() { return localId; },
  /** The menu / Customize turntable: { renderer, scene, cam, mesh, … }. */
  get preview() { return czPreview; },
  /** What the match flow thinks is going on: { phase, life, stage, count, followId }. */
  get flow() { return flow; },
  /** Kart meshes by player id: { mesh, info, … }. */
  get karts() { return karts; },
};

console.info('[kart-combat] client ready');
