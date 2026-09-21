/**
 * Architect factory: createKart(THREE, { spawn, playerId, color })
 * Thin wrapper over KartController for the agreed API.
 */
import { createKartController } from './KartController.js';

export function createKart(THREE, opts = {}) {
  const kart = createKartController(THREE, {
    playerId: opts.playerId,
    playerName: opts.playerName ?? opts.playerId ?? 'Player',
    color: opts.color,
    accent: opts.accent,
    spawn: opts.spawn,
    config: opts.config,
  });

  return {
    mesh: kart.mesh,
    group: kart.group,
    state: kart.state,
    setInput: kart.setInput,
    update: (dt, world) => kart.update(dt, world),
    applyHit: kart.applyHit,
    getNetworkState: kart.getNetworkState,
    applyNetworkState: kart.applyNetworkState,
    dispose: kart.dispose,
    // extras
    bindInput: kart.bindInput,
    updateCamera: kart.updateCamera,
    reset: kart.reset,
    setPlayerName: kart.setPlayerName,
    controller: kart,
  };
}

export default createKart;
