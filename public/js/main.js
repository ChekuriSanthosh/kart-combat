/**
 * Kart Combat — client orchestrator
 * Arcade lobby → join → sync entities → HUD + smooth render loop
 */
import { createKartController } from './vehicles/KartController.js';
import { createWeaponSystem } from './vehicles/WeaponSystem.js';
import {
  loadMap,
  loadGravelPit,
  loadSkyPinball,
  loadBeybladeArena,
} from './maps/MapManager.js';

void loadGravelPit;
void loadSkyPinball;
void loadBeybladeArena;

const MAP_LABELS = {
  gravelPit: 'Gravel Pit',
  skyPinball: 'Sky Pinball',
  beybladeArena: 'Beyblade Arena',
};

const KART_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6,
  0xe67e22, 0x1abc9c, 0xfd79a8, 0x00cec9, 0xa29bfe,
  0x55efc4, 0xff7675, 0x74b9ff, 0xffeaa7, 0xb2bec3,
];

const REMOTE_LERP = 15; // exp decay ~12–18
const BEYBLADE_CLAMP_R = 44; // keep inside scaled dish (arenaRadius 45)
const LOCAL_HARD_ERR = 12; // hard snap / teleport threshold
const LOCAL_SOFT_ERR = 1.5; // blend toward server above this
const LOCAL_RECONCILE_ALPHA = 0.2; // ~20% per snapshot

const canvas = document.getElementById('game');
const mapSelectEl = document.getElementById('map-select');
const hudEl = document.getElementById('hud');
const healthFill = document.getElementById('health-fill');
const healthText = document.getElementById('health-text');
const weaponNameEl = document.getElementById('weapon-name');
const leaderboardList = document.getElementById('leaderboard-list');
const nameInput = document.getElementById('player-name');
const mapPickerEl = document.getElementById('map-picker');
const lobbyToast = document.getElementById('lobby-toast');
const colorStub = document.getElementById('color-stub');
const playerCountInput = document.getElementById('player-count');

/** @type {typeof THREE} */
const THREE = window.THREE;
if (!THREE) throw new Error('THREE global missing — check CDN script (r128)');
if (!window.io) throw new Error('socket.io client missing');

const socket = window.io({ transports: ['websocket', 'polling'] });

let renderer;
let scene;
let camera;
let localKart = null;
let weapons = null;
let currentMap = null;
let localPlayerId = null;
let roomId = null;
let mapId = 'gravelPit';
let selectedMapId = 'gravelPit';
let joined = false;

/** @type {Map<string, any>} */
const entities = new Map();
let lastSnapshot = [];
let inputSeq = 0;
let fireHeld = false;
let lastInputEmit = 0;
let lastFrame = performance.now();
let rafId = 0;

const keys = {
  forward: false,
  back: false,
  left: false,
  right: false,
  drift: false,
  fire: false,
};

function expAlpha(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function showToast(msg, ms = 2200) {
  if (!lobbyToast) return;
  lobbyToast.textContent = msg;
  lobbyToast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => lobbyToast.classList.remove('show'), ms);
}

// ─── Bootstrap renderer ───────────────────────────────────

function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a0b8);
  scene.fog = new THREE.Fog(0x87a0b8, 50, 140);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 12, 18);

  const amb = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(amb);

  window.addEventListener('resize', onResize);
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}

// ─── Arcade lobby → join ──────────────────────────────────

function setupMapSelect() {
  // Restore selected card highlight
  mapSelectEl.querySelectorAll('.map-card').forEach((btn) => {
    if (btn.getAttribute('data-map') === selectedMapId) btn.classList.add('selected');
    else btn.classList.remove('selected');

    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-map');
      selectedMapId = id || 'gravelPit';
      mapSelectEl.querySelectorAll('.map-card').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      // Card click starts join (Smash-style pick-and-go)
      const name = (nameInput?.value || '').trim() || undefined;
      joinGame(selectedMapId, name);
    });
  });

  document.getElementById('btn-play')?.addEventListener('click', () => {
    const name = (nameInput?.value || '').trim() || undefined;
    joinGame(selectedMapId, name);
  });

  document.getElementById('btn-create')?.addEventListener('click', () => {
    mapPickerEl?.classList.add('open');
    showToast('Pick a map, then PLAY');
  });

  document.getElementById('btn-join')?.addEventListener('click', () => {
    const code = window.prompt('Room code (stub)', roomId || 'ROOM');
    if (code == null) return;
    showToast(`Join stub: ${code.trim() || 'ROOM'} — starting match`);
    const name = (nameInput?.value || '').trim() || undefined;
    joinGame(selectedMapId, name);
  });

  document.getElementById('btn-settings')?.addEventListener('click', () => {
    showToast('Settings coming soon');
  });

  document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
      root.requestFullscreen?.().catch(() => showToast('Fullscreen blocked'));
    } else {
      document.exitFullscreen?.();
    }
  });

  // Open picker by default so maps are visible under PLAY
  mapPickerEl?.classList.add('open');
}

function joinGame(selected, name) {
  mapId = selected || selectedMapId || 'gravelPit';
  selectedMapId = mapId;
  socket.emit('player:join', {
    name,
    mapId,
    maxPlayers: Number(playerCountInput?.value || 8),
  });
}

socket.on('player:welcome', (welcome) => {
  localPlayerId = welcome.playerId;
  roomId = welcome.roomId;
  mapId = welcome.mapId || mapId;
  joined = true;

  mapSelectEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  canvas.focus();

  bootWorld(welcome);
});

socket.on('error', (err) => {
  console.warn('[kart-combat] server error', err);
  alert(err?.message || 'Join failed');
});

// ─── World boot ───────────────────────────────────────────

function bootWorld(welcome) {
  clearWorld();

  currentMap = loadMap(THREE, mapId);
  scene.add(currentMap.group);
  if (currentMap.group?.userData?.fog) {
    const f = currentMap.group.userData.fog;
    scene.fog = new THREE.Fog(f.color, f.near, f.far);
    scene.background = new THREE.Color(currentMap.group.userData.background ?? f.color);
  }

  const spawn = welcome.spawn || { x: 0, y: 0.35, z: 0, yaw: 0 };
  let color = KART_COLORS[0];
  if (colorStub?.value) {
    const parsed = parseInt(String(colorStub.value).replace('#', ''), 16);
    if (!Number.isNaN(parsed)) color = parsed;
  }

  localKart = createKartController(THREE, {
    playerId: localPlayerId,
    playerName: nameInput?.value?.trim() || 'You',
    color,
    spawn: {
      position: [spawn.x, spawn.y ?? 0.35, spawn.z],
      yaw: spawn.yaw ?? spawn.rotY ?? 0,
    },
  });
  scene.add(localKart.group);
  entities.set(localPlayerId, {
    group: localKart.group,
    mesh: localKart.mesh,
    isLocal: true,
    kart: localKart,
    name: 'You',
    targetPos: new THREE.Vector3(spawn.x, spawn.y ?? 0.35, spawn.z),
    targetYaw: spawn.yaw ?? spawn.rotY ?? 0,
  });

  weapons = createWeaponSystem(THREE, { scene });
  seedMysteryBoxes(currentMap);

  applySnapshot(welcome.players || []);
  bindInput();
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function seedMysteryBoxes(map) {
  if (!weapons) return;
  const spawns = map?.mysteryBoxSpawns;
  if (typeof weapons.syncMysteryBoxSpawns === 'function') {
    if (Array.isArray(spawns) && spawns.length > 0) {
      weapons.syncMysteryBoxSpawns(spawns);
      return;
    }
    // Fallback ring if map has no spawns yet
    const radius = mapId === 'beybladeArena' ? 12 : mapId === 'skyPinball' ? 18 : 32;
    const y = mapId === 'beybladeArena' ? 0.6 : 0.4;
    const fallback = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      fallback.push({ x: Math.cos(a) * radius, y, z: Math.sin(a) * radius });
    }
    weapons.syncMysteryBoxSpawns(fallback);
    return;
  }
  if (Array.isArray(spawns) && spawns.length > 0) {
    for (const pt of spawns) {
      weapons.spawnMysteryBox?.(pt.x, pt.y ?? 0, pt.z);
    }
    return;
  }
  const radius = mapId === 'beybladeArena' ? 12 : mapId === 'skyPinball' ? 18 : 32;
  const y = mapId === 'beybladeArena' ? 0.6 : 0.4;
  weapons.spawnMysteryBoxRing?.({ x: 0, z: 0 }, 8, radius, y);
}

function clearWorld() {
  for (const [id, ent] of entities) {
    scene?.remove(ent.group);
    if (ent.kart) ent.kart.dispose();
    else disposeGroup(ent.group);
    entities.delete(id);
  }
  if (currentMap) {
    scene?.remove(currentMap.group);
    currentMap.dispose?.();
    currentMap = null;
  }
  if (weapons) {
    weapons.dispose();
    weapons = null;
  }
  localKart = null;
}

function disposeGroup(group) {
  if (!group) return;
  group.traverse((obj) => {
    obj.geometry?.dispose?.();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material.dispose?.();
    }
  });
}

// ─── Input ────────────────────────────────────────────────

function bindInput() {
  if (bindInput._done) return;
  bindInput._done = true;
  const onDown = (e) => mapKey(e.code, true, e);
  const onUp = (e) => mapKey(e.code, false, e);
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  canvas.addEventListener('pointerdown', () => {
    fireHeld = true;
    keys.fire = true;
  });
  window.addEventListener('pointerup', () => {
    fireHeld = false;
    keys.fire = false;
  });
}

function mapKey(code, pressed, e) {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.forward = pressed;
      break;
    case 'KeyS':
    case 'ArrowDown':
      keys.back = pressed;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      keys.left = pressed;
      break;
    case 'KeyD':
    case 'ArrowRight':
      keys.right = pressed;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      keys.drift = pressed;
      break;
    case 'Space':
      keys.fire = pressed;
      fireHeld = pressed;
      if (pressed && e) e.preventDefault();
      break;
    default:
      return;
  }
  if (pressed && e && code.startsWith('Arrow')) e.preventDefault();
}

function emitInput(now) {
  if (!joined || !localPlayerId) return;
  if (now - lastInputEmit < 33) return;
  lastInputEmit = now;
  inputSeq += 1;
  const payload = {
    seq: inputSeq,
    forward: keys.forward,
    back: keys.back,
    left: keys.left,
    right: keys.right,
    drift: keys.drift,
    fire: keys.fire || fireHeld,
  };
  socket.emit('player:input', payload);
  // localKart.setInput runs every frame in the raf loop (not throttled)

  if (payload.fire && weapons && localKart) {
    const pos = localKart.state.position;
    const origin = {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: localKart.state.yaw,
      ownerId: localPlayerId,
    };
    const ctx = { ownerId: localPlayerId, targets: snapshotAsTargets(), karts: snapshotAsTargets() };
    if (typeof weapons.useWeapon === 'function') {
      weapons.useWeapon(localPlayerId, origin, ctx);
    } else if (typeof weapons.fire === 'function') {
      const wid = weapons.getInventory?.(localPlayerId) || weapons.rollWeapon?.();
      if (wid) weapons.fire(wid, origin, ctx);
    }
    keys.fire = false;
    fireHeld = false;
    updateWeaponHud();
  }
}

function snapshotAsTargets() {
  return lastSnapshot
    .filter((p) => p.id !== localPlayerId)
    .map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw ?? p.rotY ?? 0, isLeader: false }));
}

// ─── Network sync ─────────────────────────────────────────

function onState(players) {
  if (!Array.isArray(players)) return;
  lastSnapshot = players;
  applySnapshot(players);
  updateHud(players);
}

socket.on('player:state', onState);
socket.on('stateUpdate', onState);

socket.on('player:leave', ({ playerId }) => {
  removeEntity(playerId);
});

socket.on('player:hit', (hit) => {
  if (!hit) return;
  if (hit.targetId === localPlayerId && localKart) {
    localKart.applyHit({
      damage: hit.damage || 0,
      effect: hit.effect
        ? { type: typeof hit.effect === 'string' ? hit.effect : hit.effect.type, duration: 0.8 }
        : null,
      fromId: hit.fromId,
    });
    updateHealthHud(localKart.state.hp);
  }
});

socket.on('room:update', (info) => {
  void info;
});


/** Sync combat flags into local statusEffects without wiping the array each tick. */
function syncLocalCombatFlags(p) {
  if (!localKart) return;
  const effects = localKart.state.statusEffects;

  function findEffect(types) {
    return effects.find((e) => e && types.includes(e.type));
  }

  function remainingFromServer(types) {
    if (!Array.isArray(p.statusEffects)) return null;
    for (const t of p.statusEffects) {
      if (typeof t === 'string' && types.includes(t)) return null; // flag-only strings: keep existing
      if (t && typeof t === 'object' && types.includes(t.type)) {
        return t.remaining ?? t.duration ?? null;
      }
    }
    return null;
  }

  function ensureEffect(type, aliases = []) {
    const types = [type, ...aliases];
    const existing = findEffect(types);
    const rem = remainingFromServer(types);
    if (existing) {
      if (rem != null) existing.remaining = rem;
      if (existing.type !== type) existing.type = type;
      return;
    }
    effects.push({ type, remaining: rem ?? 0.5 });
  }

  function clearEffects(types) {
    for (let i = effects.length - 1; i >= 0; i--) {
      if (effects[i] && types.includes(effects[i].type)) effects.splice(i, 1);
    }
  }

  function flagOn(flag, typeInList) {
    if (p[flag] != null) return !!p[flag];
    if (!Array.isArray(p.statusEffects)) return null;
    return p.statusEffects.some((t) => {
      const ty = typeof t === 'string' ? t : t?.type;
      return ty === typeInList;
    });
  }

  const frozen = flagOn('isFrozen', 'frozen');
  if (frozen === true) ensureEffect('frozen', ['freeze', 'iceBlock']);
  else if (frozen === false) clearEffects(['frozen', 'freeze', 'iceBlock']);

  const shrunk = flagOn('isShrunk', 'shrink');
  if (shrunk === true) ensureEffect('shrink', ['shrunk']);
  else if (shrunk === false) clearEffects(['shrink', 'shrunk']);

  const inv = flagOn('isInvincible', 'invincible');
  if (inv === true) ensureEffect('invincible', []);
  else if (inv === false) clearEffects(['invincible']);
}

function applySnapshot(players) {
  const seen = new Set();
  let colorIdx = 0;

  for (const p of players) {
    if (!p?.id) continue;
    seen.add(p.id);
    const yaw = p.yaw ?? p.rotY ?? 0;

    if (p.id === localPlayerId) {
      if (localKart) {
        if (p.hp != null) localKart.state.hp = p.hp;
        syncLocalCombatFlags(p);

        const dx = (p.x ?? 0) - localKart.state.position.x;
        const dz = (p.z ?? 0) - localKart.state.position.z;
        const err = Math.hypot(dx, dz);
        const snap = {
          x: p.x,
          y: p.y,
          z: p.z,
          yaw,
          vx: p.vx,
          vz: p.vz,
          hp: p.hp,
        };
        if (err > LOCAL_HARD_ERR) {
          localKart.applyNetworkState(snap, { hard: true });
        } else if (err > LOCAL_SOFT_ERR) {
          if (typeof localKart.reconcile === 'function') {
            localKart.reconcile(snap, LOCAL_RECONCILE_ALPHA);
          } else {
            const a = LOCAL_RECONCILE_ALPHA;
            localKart.state.position.x += dx * a;
            localKart.state.position.z += dz * a;
            if (p.y != null) {
              localKart.state.position.y += (p.y - localKart.state.position.y) * a;
            }
            if (p.vx != null) {
              localKart.state.velocity.x += (p.vx - localKart.state.velocity.x) * a;
            }
            if (p.vz != null) {
              localKart.state.velocity.z += (p.vz - localKart.state.velocity.z) * a;
            }
            let dyaw = yaw - localKart.state.yaw;
            while (dyaw > Math.PI) dyaw -= Math.PI * 2;
            while (dyaw < -Math.PI) dyaw += Math.PI * 2;
            localKart.state.yaw += dyaw * a;
          }
        }
      }
      clampLocalInGravel();
      clampLocalInBeyblade();
      clampLocalAltitude();
      if (weapons && (p.weapon != null || p.currentWeapon != null)) {
        const wid = p.weapon ?? p.currentWeapon;
        weapons.giveWeapon?.(localPlayerId, wid);
      }
      continue;
    }

    let ent = entities.get(p.id);
    if (!ent) {
      const color = KART_COLORS[(colorIdx++ + 1) % KART_COLORS.length];
      const remote = createKartController(THREE, {
        playerId: p.id,
        playerName: p.name || p.id,
        color,
        spawn: { position: [p.x, p.y ?? 0.35, p.z], yaw },
      });
      scene.add(remote.group);
      ent = {
        group: remote.group,
        mesh: remote.mesh,
        isLocal: false,
        kart: remote,
        name: p.name || p.id,
        targetPos: new THREE.Vector3(p.x, p.y ?? 0.35, p.z),
        targetYaw: yaw,
      };
      entities.set(p.id, ent);
    } else {
      ent.name = p.name || ent.name;
      ent.kart?.setPlayerName?.(p.name || ent.name);
    }

    // Network targets — lerped in the frame loop (no snap)
    if (!ent.targetPos) ent.targetPos = new THREE.Vector3();
    ent.targetPos.set(p.x, p.y ?? 0.35, p.z);
    ent.targetYaw = yaw;
    if (ent.kart?.state) {
      if (p.hp != null) ent.kart.state.hp = p.hp;
      if (p.vx != null) ent.kart.state.velocity.x = p.vx;
      if (p.vz != null) ent.kart.state.velocity.z = p.vz;
    }

    if (p.isShrunk) ent.group.scale.setScalar(0.55);
    else ent.group.scale.setScalar(1);
  }

  for (const id of [...entities.keys()]) {
    if (id === localPlayerId) continue;
    if (!seen.has(id)) removeEntity(id);
  }

  if (entities.size > 15) {
    for (const id of [...entities.keys()]) {
      if (entities.size <= 15) break;
      if (id !== localPlayerId && !seen.has(id)) removeEntity(id);
    }
  }
}

function removeEntity(id) {
  const ent = entities.get(id);
  if (!ent) return;
  scene.remove(ent.group);
  if (ent.kart) ent.kart.dispose();
  else disposeGroup(ent.group);
  entities.delete(id);
}

function lerpRemotes(dt) {
  const a = expAlpha(REMOTE_LERP, dt);
  for (const ent of entities.values()) {
    if (ent.isLocal || !ent.targetPos || !ent.kart) continue;
    const st = ent.kart.state;
    st.position.x += (ent.targetPos.x - st.position.x) * a;
    st.position.y += (ent.targetPos.y - st.position.y) * a;
    st.position.z += (ent.targetPos.z - st.position.z) * a;
    st.yaw = lerpAngle(st.yaw, ent.targetYaw ?? st.yaw, a);
    if (typeof ent.kart.syncVisual === 'function') {
      ent.kart.syncVisual(dt);
    } else {
      ent.group.position.copy(st.position);
      ent.group.rotation.y = st.yaw;
    }
  }
}


function clampLocalInGravel() {
  if (mapId !== 'gravelPit' || !localKart) return;
  // Soft keep-in for floorSize 92 (half ≈ 46); leave ~2 unit margin inside berms
  const half = (typeof currentMap?.floorSize === 'number' ? currentMap.floorSize * 0.5 : 46) - 2;
  const pos = localKart.state.position;
  const vel = localKart.state.velocity;
  if (pos.x > half) { pos.x = half; if (vel.x > 0) vel.x *= -0.35; }
  else if (pos.x < -half) { pos.x = -half; if (vel.x < 0) vel.x *= -0.35; }
  if (pos.z > half) { pos.z = half; if (vel.z > 0) vel.z *= -0.35; }
  else if (pos.z < -half) { pos.z = -half; if (vel.z < 0) vel.z *= -0.35; }
}

/** Recover if launched into the sky / fell through the world */
function clampLocalAltitude() {
  if (!localKart) return;
  const pos = localKart.state.position;
  const vel = localKart.state.velocity;
  const floor = 0.42;
  const maxY = mapId === 'skyPinball' ? 22 : mapId === 'beybladeArena' ? 12 : 10;
  if (pos.y > maxY) {
    pos.y = maxY;
    if (vel.y > 0) vel.y = 0;
  }
  if (pos.y < -2) {
    pos.set(0, floor, 0);
    vel.set(0, 0, 0);
  }
}

function clampLocalInBeyblade() {
  if (mapId !== 'beybladeArena' || !localKart) return;
  const limit = (currentMap?.arenaRadius ?? BEYBLADE_CLAMP_R) - 1;
  const pos = localKart.state.position;
  const r = Math.hypot(pos.x, pos.z);
  if (r <= limit || r < 1e-6) return;
  const s = limit / r;
  pos.x *= s;
  pos.z *= s;
  const vel = localKart.state.velocity;
  const radial = (vel.x * pos.x + vel.z * pos.z) / (limit * limit);
  if (radial > 0) {
    vel.x -= pos.x * radial;
    vel.z -= pos.z * radial;
  }
  // Do NOT write group.position here — KartController visual lerp owns the mesh.
}

function updateFollowCamera(dt) {
  if (!localKart || !camera) return;
  // Single owner: KartController updateCamera handles position + lookAt
  localKart.updateCamera(camera, dt);
}

// ─── HUD ──────────────────────────────────────────────────

function updateHud(players) {
  const sorted = [...players].sort((a, b) => {
    const s = (b.score || 0) - (a.score || 0);
    if (s !== 0) return s;
    return (b.hp || 0) - (a.hp || 0);
  });

  const rows = sorted.slice(0, 15);
  leaderboardList.innerHTML = '';
  for (const p of rows) {
    const li = document.createElement('li');
    if (p.id === localPlayerId) li.classList.add('me');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name || p.id;
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = String(p.score ?? 0);
    const hp = document.createElement('span');
    hp.className = 'hp';
    hp.textContent = `${Math.round(p.hp ?? 0)}`;
    li.append(name, score, hp);
    leaderboardList.appendChild(li);
  }

  const me = players.find((p) => p.id === localPlayerId);
  if (me) {
    updateHealthHud(me.hp ?? 100);
    if (weapons && (me.weapon != null || me.currentWeapon != null)) {
      weapons.giveWeapon?.(localPlayerId, me.weapon ?? me.currentWeapon);
    }
  } else if (localKart) {
    updateHealthHud(localKart.state.hp);
  }
  updateWeaponHud();
}

function updateHealthHud(hp) {
  const v = Math.max(0, Math.min(100, Number(hp) || 0));
  healthFill.style.width = `${v}%`;
  healthText.textContent = String(Math.round(v));
  const t = v / 100;
  const r = Math.round(239 + (34 - 239) * t);
  const g = Math.round(68 + (197 - 68) * t);
  const b = Math.round(68 + (94 - 68) * t);
  healthFill.style.background = `linear-gradient(90deg, rgb(${r},${g},${b}), rgb(${Math.min(255, r + 40)},${Math.min(255, g + 30)},${b}))`;
}

function updateWeaponHud() {
  if (!weapons || !localPlayerId) {
    weaponNameEl.textContent = 'Empty';
    return;
  }
  const id = weapons.getInventory?.(localPlayerId) || null;
  if (!id) {
    weaponNameEl.textContent = 'Empty';
    return;
  }
  const def = weapons.WEAPON_DEFS?.[id];
  weaponNameEl.textContent = def?.name || id;
}

// ─── Frame loop ───────────────────────────────────────────

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  // Always feed local prediction every frame; socket emit stays throttled in emitInput
  if (localKart) {
    localKart.setInput({
      forward: keys.forward,
      back: keys.back,
      left: keys.left,
      right: keys.right,
      drift: keys.drift,
    });
  }
  if (joined) emitInput(now);

  const world = {
    groundY: 0,
    colliders: currentMap?.colliders || [],
    players: [],
    applyForce(id, force) {
      if (id === localPlayerId && localKart && force) {
        localKart.state.velocity.x += (force.x || 0) * dt;
        localKart.state.velocity.z += (force.z || 0) * dt;
      }
    },
  };

  if (localKart) {
    world.players.push({
      id: localPlayerId,
      position: {
        x: localKart.state.position.x,
        y: localKart.state.position.y,
        z: localKart.state.position.z,
      },
      velocity: localKart.state.velocity,
      state: localKart.state,
    });
  }

  if (localKart) {
    localKart.update(dt, world);
    clampLocalInGravel();
    clampLocalInBeyblade();
    clampLocalAltitude();
  }

  lerpRemotes(dt);

  if (currentMap?.update) {
    currentMap.update(dt, world);
  }

  if (weapons) {
    const karts = [];
    if (localKart) {
      karts.push({
        id: localPlayerId,
        x: localKart.state.position.x,
        y: localKart.state.position.y,
        z: localKart.state.position.z,
        yaw: localKart.state.yaw,
        velocity: localKart.state.velocity,
        alive: localKart.state.hp > 0,
        applyHit: (hit) => localKart.applyHit(hit),
      });
    }
    for (const p of lastSnapshot) {
      if (p.id === localPlayerId) continue;
      karts.push({
        id: p.id,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw ?? p.rotY ?? 0,
        alive: (p.hp ?? 1) > 0,
        applyHit: () => {},
      });
    }
    weapons.update(dt, karts, {
      now,
      groundY: 0,
      bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
      colliders: currentMap?.colliders || [],
    });
    updateWeaponHud();
  }

  updateFollowCamera(dt);

  renderer.render(scene, camera);
}

// ─── Start ────────────────────────────────────────────────

initRenderer();
setupMapSelect();
console.info('[kart-combat] client ready — arcade lobby', MAP_LABELS);
