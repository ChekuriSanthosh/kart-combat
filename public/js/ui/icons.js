/**
 * Inline SVG icons for the HUD.
 *
 * Drawn here rather than shipped as image files so they stay crisp at every
 * HUD scale, recolour with CSS where that helps, and need no extra requests.
 * Every weapon gets one big, bright, toy-like picture with a thick dark-blue
 * outline — the slot is read at a glance in the corner of your eye while
 * driving, which an emoji glyph at 46 px never managed.
 *
 * All strings are static markup; nothing user-supplied ever goes through
 * here, so they are safe to assign with innerHTML.
 */

const INK = '#0d2257';

/** Shared stroke settings: chunky, rounded, the same weight on every icon. */
const S = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;

const svg = (body, viewBox = '0 0 120 120') => (
  `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`
);

/** One rocket pointing straight up, centred on (0,0); callers transform it. */
function rocketBody(body = '#ff5a3c', band = '#ffffff') {
  return `
    <path d="M-9 30 Q0 54 9 30 Z" fill="#ffd23f" ${S} stroke-width="4"/>
    <path d="M-5 30 Q0 42 5 30 Z" fill="#fff6c2"/>
    <path d="M-14 14 L-26 32 L-12 28 Z" fill="#2a7de1" ${S} stroke-width="4"/>
    <path d="M14 14 L26 32 L12 28 Z" fill="#2a7de1" ${S} stroke-width="4"/>
    <path d="M-14 30 L-14 -14 Q0 -46 14 -14 L14 30 Z" fill="${body}" ${S}/>
    <path d="M-14 -2 L14 -2 L14 8 L-14 8 Z" fill="${band}" stroke="${INK}" stroke-width="3"/>
    <circle cx="0" cy="-14" r="6.5" fill="#7fd6ff" stroke="${INK}" stroke-width="3.5"/>
    <path d="M-8 -22 Q-6 -32 0 -36" fill="none" stroke="#ffffff" stroke-opacity=".7" stroke-width="3.5" stroke-linecap="round"/>`;
}

/** One black spiked ball centred on (0,0) with radius r. */
function spikeBall(r) {
  const spikes = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x1 = Math.cos(a - 0.32) * r * 0.86;
    const y1 = Math.sin(a - 0.32) * r * 0.86;
    const x2 = Math.cos(a) * r * 1.55;
    const y2 = Math.sin(a) * r * 1.55;
    const x3 = Math.cos(a + 0.32) * r * 0.86;
    const y3 = Math.sin(a + 0.32) * r * 0.86;
    spikes.push(`M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${x3.toFixed(1)} ${y3.toFixed(1)} Z`);
  }
  return `
    <path d="${spikes.join(' ')}" fill="#f4f7ff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle r="${r}" fill="#23262e" stroke="${INK}" stroke-width="3"/>
    <circle cx="${-r * 0.35}" cy="${-r * 0.38}" r="${r * 0.28}" fill="#ffffff" fill-opacity=".35"/>`;
}

export const WEAPON_ICONS = Object.freeze({
  rocket: svg(`<g transform="translate(60 60) rotate(40)">${rocketBody()}</g>`),

  tripleRocket: svg(`
    <g transform="translate(30 70) rotate(-8) scale(.62)">${rocketBody('#ff8a3c')}</g>
    <g transform="translate(90 70) rotate(18) scale(.62)">${rocketBody('#ff8a3c')}</g>
    <g transform="translate(60 54) rotate(5) scale(.7)">${rocketBody('#ff5a3c')}</g>`),

  machineGun: svg(`
    <path d="M30 70 L22 98 L40 98 L48 72 Z" fill="#5b6475" ${S}/>
    <rect x="62" y="40" width="48" height="10" rx="5" fill="#c9d2e3" ${S} stroke-width="4"/>
    <rect x="62" y="52" width="52" height="10" rx="5" fill="#c9d2e3" ${S} stroke-width="4"/>
    <rect x="62" y="64" width="48" height="10" rx="5" fill="#c9d2e3" ${S} stroke-width="4"/>
    <rect x="96" y="36" width="10" height="42" rx="4" fill="#5b6475" ${S} stroke-width="4"/>
    <rect x="14" y="36" width="56" height="42" rx="13" fill="#ffd23f" ${S}/>
    <rect x="22" y="44" width="22" height="10" rx="5" fill="#ffffff" fill-opacity=".55"/>
    <rect x="50" y="30" width="16" height="54" rx="7" fill="#ff9a1f" ${S}/>
    <path d="M110 57 l8 -6 v12 z" fill="#ffd23f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`),

  freezeRay: svg(`
    <path d="M34 72 L26 100 L46 100 L52 74 Z" fill="#2a7de1" ${S}/>
    <rect x="16" y="42" width="58" height="34" rx="14" fill="#e8f6ff" ${S}/>
    <rect x="26" y="48" width="26" height="9" rx="4.5" fill="#ffffff"/>
    <rect x="70" y="50" width="22" height="18" rx="5" fill="#7fd6ff" ${S} stroke-width="4"/>
    <path d="M92 40 Q112 59 92 78 Z" fill="#3ee7ff" ${S}/>
    <g transform="translate(90 26)" stroke="#ffffff" stroke-width="4" stroke-linecap="round">
      <path d="M0 -15 V15 M-13 -7.5 L13 7.5 M-13 7.5 L13 -7.5" stroke="${INK}" stroke-width="9"/>
      <path d="M0 -15 V15 M-13 -7.5 L13 7.5 M-13 7.5 L13 -7.5"/>
    </g>`),

  bomb: svg(`
    <path d="M74 34 Q86 18 98 22" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M74 34 Q86 18 98 22" fill="none" stroke="#d9a35b" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M100 8 L104 18 L114 20 L105 25 L107 35 L99 29 L90 33 L94 24 L88 16 L98 17 Z"
          fill="#ffd23f" stroke="#ff7a1f" stroke-width="3" stroke-linejoin="round"/>
    <rect x="62" y="28" width="22" height="16" rx="4" transform="rotate(35 73 36)" fill="#5b6475" ${S} stroke-width="4"/>
    <circle cx="54" cy="70" r="38" fill="#2b2e38" ${S}/>
    <ellipse cx="40" cy="54" rx="11" ry="8" fill="#ffffff" fill-opacity=".38" transform="rotate(-35 40 54)"/>`),

  mine: svg(`
    <g fill="#c9d2e3" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round">
      <path d="M16 82 L4 76 L18 72 Z"/><path d="M104 82 L116 76 L102 72 Z"/>
      <path d="M40 54 L32 40 L48 48 Z"/><path d="M80 54 L88 40 L72 48 Z"/>
    </g>
    <ellipse cx="60" cy="84" rx="48" ry="16" fill="#3b3f4c" ${S}/>
    <path d="M22 80 Q24 46 60 44 Q96 46 98 80 Z" fill="#e8483f" ${S}/>
    <path d="M34 66 Q40 54 54 52" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>
    <circle cx="60" cy="40" r="10" fill="#ffe14d" ${S} stroke-width="4"/>
    <circle cx="60" cy="40" r="17" fill="none" stroke="#ffe14d" stroke-opacity=".55" stroke-width="3"/>`),

  shield: svg(`
    <path d="M60 10 L100 24 Q102 78 60 110 Q18 78 20 24 Z" fill="#4a98f0" ${S}/>
    <path d="M60 22 L89 32 Q90 72 60 96 Z" fill="#7fbaff"/>
    <path d="M60 36 l7 14 15 2 -11 10 3 15 -14 -7 -14 7 3 -15 -11 -10 15 -2 Z"
          fill="#ffd23f" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M32 32 Q34 54 42 68" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>`),

  boost: svg(`
    <path d="M70 6 L22 66 L54 66 L42 114 L98 46 L64 46 Z" fill="#ffd23f" ${S}/>
    <path d="M64 46 L98 46 L42 114 L54 66 Z" fill="#ff9a1f"/>
    <path d="M70 6 L22 66 L54 66 L42 114 L98 46 L64 46 Z" fill="none" ${S}/>
    <path d="M66 18 L34 60 L50 60" fill="none" stroke="#ffffff" stroke-opacity=".75" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),

  repair: svg(`
    <path d="M60 104 Q12 72 12 42 Q12 18 36 16 Q52 16 60 32 Q68 16 84 16 Q108 18 108 42 Q108 72 60 104 Z"
          fill="#ff4a5a" ${S}/>
    <path d="M30 32 Q22 40 26 52" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>
    <path d="M52 40 H68 V52 H80 V68 H68 V80 H52 V68 H40 V52 H52 Z" fill="#ffffff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`),

  spikes: svg(`
    <g transform="translate(60 26)">${spikeBall(15)}</g>
    <g transform="translate(26 62)">${spikeBall(15)}</g>
    <g transform="translate(94 62)">${spikeBall(15)}</g>
    <g transform="translate(60 96)">${spikeBall(15)}</g>`),
});

/**
 * The picture for a weapon id, or null when there is none — the caller then
 * falls back to the definition's glyph, so a weapon added on the server
 * before it has art here still shows up as something.
 */
export function weaponIcon(id) {
  return WEAPON_ICONS[id] || null;
}

/* ── HUD chrome ──────────────────────────────────────────────────────── */

export const HUD_ICONS = Object.freeze({
  /** Rank pill: a three-step podium with a star over the winner's step. */
  podium: svg(`
    <path d="M44 22 l6 11 12 2 -9 8 2 12 -11 -6 -11 6 2 -12 -9 -8 12 -2 Z" transform="translate(16 -6)"
          fill="#ffffff" stroke="#1f6fe0" stroke-width="4" stroke-linejoin="round"/>
    <path d="M42 56 H78 V100 H42 Z M14 72 H42 V100 H14 Z M78 80 H106 V100 H78 Z"
          fill="#1f6fe0" stroke="#1f6fe0" stroke-width="4" stroke-linejoin="round"/>`),

  heart: svg(`
    <path d="M60 106 Q10 74 10 42 Q10 16 36 14 Q52 14 60 30 Q68 14 84 14 Q110 16 110 42 Q110 74 60 106 Z"
          fill="#ffffff" stroke="#1f6fe0" stroke-width="9" stroke-linejoin="round"/>
    <path d="M30 34 Q24 42 27 52" fill="none" stroke="#b3dbff" stroke-width="6" stroke-linecap="round"/>`),

  clock: svg(`
    <circle cx="60" cy="60" r="48" fill="#ffffff" stroke="#1f6fe0" stroke-width="9"/>
    <path d="M60 30 V62 H82" fill="none" stroke="#1f6fe0" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`),

  gear: svg(`
    <path fill="currentColor" fill-rule="evenodd" d="M52 8h16l3 14a40 40 0 0 1 10 6l13-5 8 14-11 9a40 40 0 0 1 0 12l11 9-8 14-13-5a40 40 0 0 1-10 6l-3 14H52l-3-14a40 40 0 0 1-10-6l-13 5-8-14 11-9a40 40 0 0 1 0-12l-11-9 8-14 13 5a40 40 0 0 1 10-6zM60 44a16 16 0 1 0 0 32a16 16 0 1 0 0-32z" transform="translate(0 0)"/>`),

  invite: svg(`
    <circle cx="48" cy="38" r="20" fill="currentColor"/>
    <path d="M10 102 Q10 66 48 66 Q86 66 86 102 Z" fill="currentColor"/>
    <path d="M96 30 V62 M80 46 H112" stroke="currentColor" stroke-width="12" stroke-linecap="round"/>`),

  eye: svg(`
    <path d="M8 60 Q60 4 112 60 Q60 116 8 60 Z" fill="none" stroke="currentColor" stroke-width="10" stroke-linejoin="round"/>
    <circle cx="60" cy="60" r="20" fill="currentColor"/>`),

  close: svg(`<path d="M30 30 L90 90 M90 30 L30 90" stroke="currentColor" stroke-width="16" stroke-linecap="round"/>`),
});
