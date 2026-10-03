/**
 * A ranked list of players: hex badge in the kart's colour with the position
 * in it, the name, and the score on the right.
 *
 * Rows are keyed by player id and reused, never rebuilt. The list redraws 20
 * times a second from snapshots, and tearing it down with innerHTML every
 * time made it flicker under the pointer and churned the DOM for nothing.
 *
 * Collapsing hides rows with a class rather than removing them: every player
 * stays in the list (the party and lobby tests read their names out of it,
 * and screen readers can still reach them), it just is not all drawn.
 */

const hexColour = (n) => `#${(n ?? 0x888888).toString(16).padStart(6, '0')}`;

/** How many leaders stay visible when the board is folded down. */
const FOLDED_TOP = 3;

/**
 * @param {HTMLOListElement} listEl
 */
export function createLeaderboard(listEl) {
  /** playerId → { li, badge, name, score, last } */
  const rows = new Map();

  function rowFor(id) {
    let row = rows.get(id);
    if (row) return row;
    const li = document.createElement('li');
    li.dataset.id = id;
    const badge = document.createElement('span');
    badge.className = 'lb-hex';
    const name = document.createElement('span');
    name.className = 'name';
    const score = document.createElement('span');
    score.className = 'score';
    li.append(badge, name, score);
    row = { li, badge, name, score, last: {} };
    rows.set(id, row);
    return row;
  }

  /** Only touch the DOM for what actually changed since the last render. */
  function set(row, key, value, apply) {
    if (row.last[key] === value) return;
    row.last[key] = value;
    apply(value);
  }

  return {
    /**
     * @param {{i:string, n:string, c:number, sc:number|null}[]} list  already sorted, best first;
     *   `sc: null` means the player is sitting this round out and shows '-'.
     * @param {string|null} localId
     * @param {{ folded?: boolean }} [opts]
     */
    render(list, localId, { folded = false } = {}) {
      const seen = new Set();
      const myIndex = list.findIndex((p) => p.i === localId);
      // Folding only earns its keep on a long board; five rows fit anyway.
      const fold = folded && list.length > FOLDED_TOP + 2;

      list.forEach((p, index) => {
        seen.add(p.i);
        const row = rowFor(p.i);
        const me = p.i === localId;
        set(row, 'me', me, (v) => row.li.classList.toggle('me', v));
        set(row, 'pos', index + 1, (v) => { row.badge.textContent = String(v); });
        set(row, 'colour', p.c, (v) => row.badge.style.setProperty('--hex-fill', hexColour(v)));
        set(row, 'name', p.n, (v) => { row.name.textContent = v; });
        set(row, 'score', p.sc, (v) => { row.score.textContent = v === null ? '-' : String(v); });

        const hidden = fold && index >= FOLDED_TOP && !me;
        set(row, 'folded', hidden, (v) => row.li.classList.toggle('folded', v));
        // The dotted gap sits on the local row when it is cut off from the
        // leaders; if it directly follows them there is nothing to elide.
        const gap = fold && me && index > FOLDED_TOP;
        set(row, 'gap', gap, (v) => row.li.classList.toggle('gap-before', v));

        // insertBefore moves an existing node, so this re-sorts in place.
        if (listEl.children[index] !== row.li) listEl.insertBefore(row.li, listEl.children[index] || null);
      });

      for (const [id, row] of rows) {
        if (seen.has(id)) continue;
        row.li.remove();
        rows.delete(id);
      }
      return myIndex;
    },

    clear() {
      for (const row of rows.values()) row.li.remove();
      rows.clear();
    },
  };
}

/**
 * Sort live players the way the board shows them: score, then kills, and
 * anyone sitting the round out at the bottom. `Array.prototype.sort` is
 * stable, so equal players keep the server's (join) order instead of
 * swapping places every snapshot.
 */
export function rankPlayers(players) {
  return [...players].sort((a, b) => {
    const outA = a.jn === 0 ? 1 : 0;
    const outB = b.jn === 0 ? 1 : 0;
    return outA - outB || (b.sc ?? 0) - (a.sc ?? 0) || (b.k ?? 0) - (a.k ?? 0);
  });
}

/** 1 → "st", 2 → "nd", 3 → "rd", 11 → "th"… */
export function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}
