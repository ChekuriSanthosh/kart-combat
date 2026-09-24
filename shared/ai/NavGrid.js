/**
 * Navigation grid built from a map's collision solids.
 *
 * The arena is 2.5D — flat ground with ramps, decks, bridges and islands at
 * different heights — so a plain 2D occupancy grid would either wall bots off
 * from every raised platform or let them walk up cliff faces. Instead each
 * cell stores the height of the surface a kart would rest on there, and an
 * edge between two cells only exists when the step between those surfaces is
 * one a kart could actually drive. Ramps then fall out for free: their cells
 * climb gradually, so the edges are traversable all the way up, while the
 * cliff beside the ramp is a single 2.6 m jump and is not.
 *
 * Three queries are built on that graph:
 *
 *   hasLineOfSight  cheap straight-line test, used before bothering with A*
 *   findPath        A* between two points, for chasing around obstacles
 *   buildFlowField  multi-source Dijkstra, for "walk to the nearest crate"
 *
 * The flow field deserves a note: running A* per bot per crate would be
 * O(bots x crates) searches. One Dijkstra seeded from every crate at once
 * gives every cell in the arena its distance to the *nearest* crate and which
 * neighbour to step to, so any number of bots can then look up their next
 * move in constant time. One search serves the whole field.
 */

import { sampleGround, resolveHorizontal, STEP_UP } from '../collision.js';
import { KART } from '../physics.js';
import { BinaryHeap } from './BinaryHeap.js';

/**
 * Cell size in metres. This is pinned by the steepest ramp in the game rather
 * than by the kart's width: a cell step has to stay under the 0.55 m step-up
 * limit or ramps read as walls and every raised platform becomes unreachable.
 * The shallowest access ramp climbs 0.42 m per metre, so 1 m cells leave a
 * comfortable margin. It also guarantees at least one full row of closed cells
 * along any wall, so a path can never squeeze between two cells that straddle
 * a thin rail.
 */
const CELL = 1.0;
/** Sentinel height for cells that are off the map entirely. */
const VOID = -Infinity;

const SQRT2 = Math.SQRT2;

/** Neighbour offsets: 8-way, with the diagonal cost baked in. */
const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Biggest drop a bot will deliberately path over. Decks are 2.6 m. */
const MAX_DROP = 3.5;

export function buildNavGrid(map) {
  const extent = (map.arenaRadius || 46) * 1.15;
  const size = Math.ceil((extent * 2) / CELL);
  const origin = -extent;

  const height = new Float32Array(size * size).fill(VOID);
  const open = new Uint8Array(size * size);

  const probe = { x: 0, z: 0, vx: 0, vz: 0 };
  const worldX = (gx) => origin + (gx + 0.5) * CELL;
  const worldZ = (gz) => origin + (gz + 0.5) * CELL;

  /**
   * Surface a kart standing at (x, z) with its feet at `from` would rest on,
   * or null if there is nothing to stand on or it is inside a wall.
   *
   * Sampling relative to the approaching kart's height rather than from high
   * above is the whole trick. Sample from above and every crate, bumper and
   * wall reports its *roof* as standable ground — which then sits 2.4 m above
   * its neighbours, so bots can drop onto it but never climb back off, and the
   * graph quietly fragments into disconnected islands.
   */
  function surfaceAt(x, z, from) {
    const y = sampleGround(map.solids, x, z, from, map.floorY);
    if (!Number.isFinite(y) || y <= map.killY) return null;
    probe.x = x;
    probe.z = z;
    probe.vx = 0;
    probe.vz = 0;
    // A slightly slim kart, so cells that merely brush a wall still count.
    resolveHorizontal(map.solids, probe, KART.radius * 0.8, y, y + KART.height);
    if (Math.hypot(probe.x - x, probe.z - z) > 0.05) return null;
    return y;
  }

  // Flood out from the spawn points using the same step-up rule the physics
  // uses, so the reachable set is exactly where a kart can actually drive.
  // Ramps are handled without any special case: their cells rise a few
  // centimetres at a time, so each step is climbable all the way to the top.
  const queue = [];
  for (const spawn of map.spawns) {
    const gx = Math.floor((spawn.x - origin) / CELL);
    const gz = Math.floor((spawn.z - origin) / CELL);
    if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
    const i = gz * size + gx;
    const y = surfaceAt(worldX(gx), worldZ(gz), spawn.y + STEP_UP);
    if (y === null) continue;
    if (open[i] && height[i] <= y) continue;
    height[i] = y;
    open[i] = 1;
    queue.push(i);
  }

  // Re-relaxation: a cell reached from a lower neighbour records the lower
  // surface, so standing on the floor always beats standing on a roof.
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const cx = current % size;
    const cz = Math.floor(current / size);
    const hc = height[current];

    for (const [dx, dz] of NEIGHBOURS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const n = nz * size + nx;

      const y = surfaceAt(worldX(nx), worldZ(nz), hc);
      if (y === null) continue;
      if (y - hc > STEP_UP) continue;   // too tall to climb
      if (hc - y > MAX_DROP) continue;  // too far to drop

      if (open[n] && height[n] <= y + 1e-4) continue;
      height[n] = y;
      open[n] = 1;
      queue.push(n);
    }
  }

  return {
    size,
    origin,
    cell: CELL,
    height,
    open,

    /** Grid index for a world position, or -1 when off the grid. */
    indexAt(x, z) {
      const gx = Math.floor((x - origin) / CELL);
      const gz = Math.floor((z - origin) / CELL);
      if (gx < 0 || gz < 0 || gx >= size || gz >= size) return -1;
      return gz * size + gx;
    },

    worldX(i) { return origin + ((i % size) + 0.5) * CELL; },
    worldZ(i) { return origin + (Math.floor(i / size) + 0.5) * CELL; },

    isOpen(i) { return i >= 0 && open[i] === 1; },

    /** Can a kart drive straight from cell a to cell b? */
    canStep(a, b) {
      if (open[a] !== 1 || open[b] !== 1) return false;
      // Downhill is free — you fall. Uphill is capped by the step-up height,
      // which is what stops bots from scaling the side of a deck.
      return height[b] - height[a] <= STEP_UP;
    },

    /**
     * Nearest open cell to a world position, searched in rings. A kart sitting
     * half inside a wall still needs somewhere to path from.
     *
     * `y` is the height the kart is actually at, and passing it matters more
     * than it looks. The grid is 2.5D, so the cells beside a raised deck and
     * the cells on top of it are neighbours in 2D while being 2.6 m apart
     * vertically. Snapping purely by 2D distance puts a kart standing at the
     * foot of a deck onto a deck-*top* cell, and every route then computed for
     * it starts on the deck — so it is told to drive forward into the wall it
     * is already touching, forever. Matching height first keeps the kart on
     * the surface it is really standing on.
     */
    nearestOpen(x, z, y, maxRings = 4) {
      const matchY = Number.isFinite(y);
      const start = this.indexAt(x, z);
      if (start >= 0 && open[start] === 1) {
        if (!matchY || Math.abs(height[start] - y) <= STEP_UP) return start;
      }
      const gx0 = Math.floor((x - origin) / CELL);
      const gz0 = Math.floor((z - origin) / CELL);
      for (let r = 1; r <= maxRings; r++) {
        let best = -1;
        let bestDy = Infinity;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const gx = gx0 + dx;
            const gz = gz0 + dz;
            if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
            const i = gz * size + gx;
            if (open[i] !== 1) continue;
            if (!matchY) return i;
            // Reachable from where the kart actually is: climbable up, or a
            // drop it could survive taking.
            const dy = height[i] - y;
            if (dy > STEP_UP || -dy > MAX_DROP) continue;
            const score = Math.abs(dy);
            if (score < bestDy) { bestDy = score; best = i; }
          }
        }
        if (best >= 0) return best;
      }
      // Nothing at a compatible height — fall back to plain 2D so callers still
      // get an answer rather than giving up on routing entirely.
      return matchY ? this.nearestOpen(x, z, undefined, maxRings) : -1;
    },
  };
}

/**
 * Is the straight line from a to b drivable?
 *
 * Walked at half-cell steps over the same passability data A* uses. Bots check
 * this first: in an open arena the answer is usually yes, and steering
 * straight at the target both looks better and costs nothing.
 */
export function hasLineOfSight(grid, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-3) return true;

  const steps = Math.ceil((dist / grid.cell) * 2);
  let prev = grid.indexAt(ax, az);
  if (!grid.isOpen(prev)) return false;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cell = grid.indexAt(ax + dx * t, az + dz * t);
    if (cell === prev) continue;
    if (!grid.isOpen(cell) || !grid.canStep(prev, cell)) return false;
    prev = cell;
  }
  return true;
}

/**
 * A* from one world position to another, returned as world-space waypoints.
 *
 * The heuristic is octile distance — the exact cost of an unobstructed 8-way
 * path — which is admissible and tight, so the search stays close to the
 * straight line instead of fanning out across the arena.
 */
export function findPath(grid, ax, az, bx, bz, { fromY, toY, budget = 2500 } = {}) {
  const start = grid.nearestOpen(ax, az, fromY);
  const goal = grid.nearestOpen(bx, bz, toY);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [{ x: bx, z: bz }];

  const { size } = grid;
  const gScore = new Float32Array(size * size).fill(Infinity);
  const cameFrom = new Int32Array(size * size).fill(-1);
  const closed = new Uint8Array(size * size);

  const gxOf = (i) => i % size;
  const gzOf = (i) => Math.floor(i / size);
  const goalX = gxOf(goal);
  const goalZ = gzOf(goal);

  const heuristic = (i) => {
    const dx = Math.abs(gxOf(i) - goalX);
    const dz = Math.abs(gzOf(i) - goalZ);
    const lo = Math.min(dx, dz);
    return (dx + dz - 2 * lo) + SQRT2 * lo;
  };

  const heap = new BinaryHeap();
  gScore[start] = 0;
  heap.push(start, heuristic(start));

  let expanded = 0;
  let found = false;

  while (heap.size > 0) {
    const current = heap.pop();
    if (current === goal) { found = true; break; }
    if (closed[current]) continue;
    closed[current] = 1;

    // Give up rather than stall the tick if a map ever gets pathological.
    if (++expanded > budget) break;

    const cx = gxOf(current);
    const cz = gzOf(current);
    for (const [dx, dz, cost] of NEIGHBOURS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const next = nz * size + nx;
      if (closed[next] || !grid.canStep(current, next)) continue;

      // Diagonals may not cut a corner past a blocked cell.
      if (dx !== 0 && dz !== 0) {
        if (!grid.canStep(current, cz * size + nx)) continue;
        if (!grid.canStep(current, nz * size + cx)) continue;
      }

      const tentative = gScore[current] + cost;
      if (tentative >= gScore[next]) continue;
      gScore[next] = tentative;
      cameFrom[next] = current;
      heap.push(next, tentative + heuristic(next));
    }
  }

  if (!found) return null;

  const cells = [];
  for (let i = goal; i !== -1; i = cameFrom[i]) cells.push(i);
  cells.reverse();

  // Drop waypoints we can already see past, so bots drive smooth lines instead
  // of tracing the staircase the grid produces.
  const path = [];
  let anchorX = ax;
  let anchorZ = az;
  for (let i = 1; i < cells.length; i++) {
    const wx = grid.worldX(cells[i]);
    const wz = grid.worldZ(cells[i]);
    const nextIsLast = i === cells.length - 1;
    if (nextIsLast || !hasLineOfSight(grid, anchorX, anchorZ, grid.worldX(cells[i + 1]), grid.worldZ(cells[i + 1]))) {
      path.push({ x: wx, z: wz });
      anchorX = wx;
      anchorZ = wz;
    }
  }
  if (path.length === 0) path.push({ x: bx, z: bz });
  else path[path.length - 1] = { x: bx, z: bz };
  return path;
}

/**
 * Multi-source Dijkstra from every goal at once.
 *
 * Returns, for each cell, the cost of reaching the closest goal and which
 * neighbour to move to. One search answers "where is my nearest crate, and
 * how do I get there around the scenery" for every bot on the map.
 */
export function buildFlowField(grid, goals) {
  const { size } = grid;
  const cost = new Float32Array(size * size).fill(Infinity);
  const next = new Int32Array(size * size).fill(-1);
  const closed = new Uint8Array(size * size);
  const heap = new BinaryHeap();

  for (const g of goals) {
    // Crates sit on decks as well as on the floor, so seed the search on the
    // surface the crate is actually resting on.
    const cell = grid.nearestOpen(g.x, g.z, g.y);
    if (cell < 0) continue;
    if (cost[cell] === 0) continue;
    cost[cell] = 0;
    heap.push(cell, 0);
  }
  if (heap.size === 0) return null;

  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % size;
    const cz = Math.floor(current / size);
    for (const [dx, dz, stepCost] of NEIGHBOURS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const neighbour = nz * size + nx;
      if (closed[neighbour]) continue;
      // Expanding *outward* from the goals, so the drivable direction to check
      // is neighbour -> current: that is the way a bot will actually travel.
      if (!grid.canStep(neighbour, current)) continue;
      if (dx !== 0 && dz !== 0) {
        if (!grid.canStep(neighbour, cz * size + nx)) continue;
        if (!grid.canStep(neighbour, nz * size + cx)) continue;
      }

      const tentative = cost[current] + stepCost;
      if (tentative >= cost[neighbour]) continue;
      cost[neighbour] = tentative;
      next[neighbour] = current;
      heap.push(neighbour, tentative);
    }
  }

  return {
    cost,
    next,
    /**
     * World position to steer at from (x, z), or null if unreachable.
     *
     * Following the field one cell at a time aims a kart at a point a single
     * metre away — barely more than its own radius. At that range the target
     * swings wildly as the kart moves, the steering never settles, and a bot
     * ends up oscillating in place instead of driving. So walk the chain
     * forward and return the furthest cell still in line of sight: the same
     * string-pulling `findPath` does, applied to the field.
     */
    stepFrom(x, z, y, lookahead = 12) {
      const cell = grid.nearestOpen(x, z, y);
      if (cell < 0) return null;
      let target = next[cell];
      if (target < 0) {
        // Already standing on a goal cell.
        return cost[cell] === 0 ? { x, z, arrived: true } : null;
      }

      let best = target;
      for (let i = 0; i < lookahead; i++) {
        const ahead = next[target];
        if (ahead < 0) break;
        if (!hasLineOfSight(grid, x, z, grid.worldX(ahead), grid.worldZ(ahead))) break;
        best = ahead;
        target = ahead;
      }
      return { x: grid.worldX(best), z: grid.worldZ(best), arrived: false };
    },
    /** Grid distance to the nearest goal, in metres. */
    distanceFrom(x, z, y) {
      const cell = grid.nearestOpen(x, z, y);
      if (cell < 0) return Infinity;
      return cost[cell] * grid.cell;
    },
  };
}
