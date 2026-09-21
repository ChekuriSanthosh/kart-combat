/**
 * Keyboard → kart input map (WASD / arrows / Shift drift).
 * Prefer kart.bindInput(window) from KartController; this helper is for
 * polling-style or remote input aggregation.
 */

export function createInputState() {
  return { forward: false, back: false, left: false, right: false, drift: false, fire: false };
}

export function bindKeyboardInput(target, inputState, { preventArrowScroll = true } = {}) {
  const set = (code, pressed, e) => {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        inputState.forward = pressed;
        break;
      case 'KeyS':
      case 'ArrowDown':
        inputState.back = pressed;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        inputState.left = pressed;
        break;
      case 'KeyD':
      case 'ArrowRight':
        inputState.right = pressed;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        inputState.drift = pressed;
        break;
      case 'Space':
        inputState.fire = pressed;
        break;
      default:
        return;
    }
    if (preventArrowScroll && pressed && e && code.startsWith('Arrow')) e.preventDefault();
  };
  const down = (e) => set(e.code, true, e);
  const up = (e) => set(e.code, false, e);
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
  };
}

export default { createInputState, bindKeyboardInput };
