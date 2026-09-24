/**
 * Binary min-heap, used as the open set for A* and Dijkstra.
 *
 * Both searches need "give me the unvisited node with the smallest cost" in a
 * tight loop. A linear scan makes that O(n) per pop and turns pathfinding into
 * the most expensive thing the server does; a heap makes it O(log n).
 *
 * Items are plain integers (grid cell indices) with their priority held in a
 * parallel array, which avoids allocating a wrapper object per node — A* on a
 * 3,400-cell grid pushes thousands of nodes per search.
 */

export class BinaryHeap {
  constructor() {
    /** @type {number[]} cell indices, arranged as a heap */
    this.items = [];
    /** @type {number[]} priority of items[i], kept in lockstep */
    this.costs = [];
  }

  get size() {
    return this.items.length;
  }

  clear() {
    this.items.length = 0;
    this.costs.length = 0;
  }

  push(item, cost) {
    this.items.push(item);
    this.costs.push(cost);
    this.#siftUp(this.items.length - 1);
  }

  /** Smallest-cost item, or -1 when empty. */
  pop() {
    const n = this.items.length;
    if (n === 0) return -1;

    const top = this.items[0];
    const lastItem = this.items.pop();
    const lastCost = this.costs.pop();
    if (n > 1) {
      this.items[0] = lastItem;
      this.costs[0] = lastCost;
      this.#siftDown(0);
    }
    return top;
  }

  #siftUp(i) {
    const { items, costs } = this;
    const item = items[i];
    const cost = costs[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (costs[parent] <= cost) break;
      items[i] = items[parent];
      costs[i] = costs[parent];
      i = parent;
    }
    items[i] = item;
    costs[i] = cost;
  }

  #siftDown(i) {
    const { items, costs } = this;
    const n = items.length;
    const item = items[i];
    const cost = costs[i];
    for (;;) {
      const left = i * 2 + 1;
      if (left >= n) break;
      const right = left + 1;
      const child = right < n && costs[right] < costs[left] ? right : left;
      if (costs[child] >= cost) break;
      items[i] = items[child];
      costs[i] = costs[child];
      i = child;
    }
    items[i] = item;
    costs[i] = cost;
  }
}
