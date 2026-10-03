/**
 * Confetti for the winners screen: plain DOM strips falling under CSS
 * animations, so it costs the WebGL frame nothing and needs no particle
 * system. Each piece removes itself when its fall ends; a slow trickle keeps
 * the air full for as long as the winners are on screen.
 */

const COLOURS = ['#ff4a5a', '#ffd23f', '#45d65a', '#3fa0ff', '#b14eff', '#ff9a1f', '#3ee7ff', '#ff7bac'];

const rand = (a, b) => a + Math.random() * (b - a);

export function createConfetti(layer) {
  let trickle = 0;
  const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function burst(n, fromTop) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const piece = document.createElement('i');
      const curl = Math.random() < 0.25;
      piece.className = curl ? 'curl' : '';
      piece.style.left = `${rand(-2, 100).toFixed(1)}%`;
      piece.style.setProperty('--c', COLOURS[(Math.random() * COLOURS.length) | 0]);
      piece.style.setProperty('--dx', `${rand(-18, 18).toFixed(1)}vw`);
      piece.style.setProperty('--spin', `${rand(-900, 900).toFixed(0)}deg`);
      piece.style.setProperty('--dur', `${rand(2.6, 4.6).toFixed(2)}s`);
      // The opening burst starts spread down the screen so it reads as an
      // explosion of paper rather than a curtain dropping from the top edge.
      piece.style.setProperty('--y0', fromTop ? '-6vh' : `${rand(-10, 45).toFixed(0)}vh`);
      piece.style.setProperty('--w', `${rand(0.8, 1.6).toFixed(2)}`);
      piece.addEventListener('animationend', () => piece.remove(), { once: true });
      frag.appendChild(piece);
    }
    layer.appendChild(frag);
  }

  return {
    start() {
      if (trickle) return;
      if (calm()) {
        burst(24, true);
        trickle = -1; // mark as running without a timer
        return;
      }
      burst(90, false);
      trickle = setInterval(() => burst(14, true), 450);
    },
    stop() {
      if (trickle > 0) clearInterval(trickle);
      trickle = 0;
      layer.replaceChildren();
    },
    get running() { return trickle !== 0; },
  };
}
