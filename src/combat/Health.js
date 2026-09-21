/** Kart health: 100 HP default, damage / heal / invuln / respawn. */

export const MAX_HP = 100;

export function createHealth(maxHp = MAX_HP) {
  const state = {
    hp: maxHp,
    maxHp,
    alive: true,
    invulnRemaining: 0,
    lastHitBy: null,
  };

  function tick(dt) {
    if (state.invulnRemaining > 0) {
      state.invulnRemaining = Math.max(0, state.invulnRemaining - dt);
    }
  }

  function damage(amount, sourceId = null, { ignoreInvuln = false, invulnAfter = 0.6 } = {}) {
    if (!state.alive) return { applied: 0, killed: false, blocked: true };
    if (!ignoreInvuln && state.invulnRemaining > 0) {
      return { applied: 0, killed: false, blocked: true };
    }
    const applied = Math.min(state.hp, Math.max(0, amount));
    state.hp -= applied;
    state.lastHitBy = sourceId;
    if (invulnAfter > 0) state.invulnRemaining = invulnAfter;
    if (state.hp <= 0) {
      state.hp = 0;
      state.alive = false;
      return { applied, killed: true, blocked: false };
    }
    return { applied, killed: false, blocked: false };
  }

  function heal(amount) {
    if (!state.alive) return 0;
    const before = state.hp;
    state.hp = Math.min(state.maxHp, state.hp + Math.max(0, amount));
    return state.hp - before;
  }

  function reset(full = true) {
    if (full) state.hp = state.maxHp;
    state.alive = state.hp > 0;
    state.invulnRemaining = 0;
    state.lastHitBy = null;
  }

  function respawn(hp = state.maxHp) {
    state.hp = hp;
    state.alive = true;
    state.invulnRemaining = 1.5;
    state.lastHitBy = null;
  }

  return { state, tick, damage, heal, reset, respawn, MAX_HP: state.maxHp };
}

export default createHealth;
