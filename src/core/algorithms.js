/**
 * @file algorithms.js
 * @description Pure pathfinding algorithms for the Smart Ambulance Pathfinding & Traffic Simulator.
 *              Implements Dijkstra's Algorithm and A* Search (Manhattan heuristic).
 *
 * Grid Cell Conventions:
 *   1  → Normal road   (traversal cost = 1)
 *   5  → Heavy traffic (traversal cost = 5)
 *  -1  → Wall/Roadblock (impassable)
 *
 * @module algorithms
 */

// ─────────────────────────────────────────────
//  Shared Utilities
// ─────────────────────────────────────────────

/** Cardinal movement directions: [row-delta, col-delta] */
const DIRECTIONS = [
  [-1,  0], // North
  [ 1,  0], // South
  [ 0, -1], // West
  [ 0,  1], // East
];

/**
 * Checks whether a cell is within grid bounds and not a wall.
 * @param {number[][]} grid - 2D grid array.
 * @param {number} r - Row index.
 * @param {number} c - Column index.
 * @returns {boolean}
 */
function isTraversable(grid, r, c) {
  return (
    r >= 0 &&
    r < grid.length &&
    c >= 0 &&
    c < grid[0].length &&
    grid[r][c] !== -1
  );
}

/**
 * Reconstructs the shortest path by back-tracking through the cameFrom map.
 * @param {Map<string, string|null>} cameFrom - Maps "r,c" → "r,c" of predecessor.
 * @param {string} endKey - Serialised end-node key.
 * @returns {number[][]} Ordered array of [r, c] pairs from start → end.
 */
function reconstructPath(cameFrom, endKey) {
  const path = [];
  let current = endKey;
  while (current !== null) {
    const [r, c] = current.split(',').map(Number);
    path.unshift([r, c]);
    current = cameFrom.get(current);
  }
  return path;
}

// ─────────────────────────────────────────────
//  Min-Heap (Priority Queue)
// ─────────────────────────────────────────────

/**
 * A lightweight binary min-heap used as a priority queue.
 * Each element is an object { priority, key } where key is "r,c".
 */
class MinHeap {
  constructor() {
    /** @type {{ priority: number, key: string }[]} */
    this._heap = [];
  }

  get size() {
    return this._heap.length;
  }

  /**
   * Inserts a new element with the given priority.
   * @param {string} key
   * @param {number} priority
   */
  push(key, priority) {
    this._heap.push({ key, priority });
    this._bubbleUp(this._heap.length - 1);
  }

  /**
   * Removes and returns the element with the lowest priority.
   * @returns {{ priority: number, key: string }}
   */
  pop() {
    const top = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this._heap[parent].priority <= this._heap[i].priority) break;
      [this._heap[parent], this._heap[i]] = [this._heap[i], this._heap[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this._heap.length;
    while (true) {
      let smallest = i;
      const left  = 2 * i + 1;
      const right = 2 * i + 2;
      if (left  < n && this._heap[left].priority  < this._heap[smallest].priority) smallest = left;
      if (right < n && this._heap[right].priority < this._heap[smallest].priority) smallest = right;
      if (smallest === i) break;
      [this._heap[smallest], this._heap[i]] = [this._heap[i], this._heap[smallest]];
      i = smallest;
    }
  }
}

// ─────────────────────────────────────────────
//  Dijkstra's Algorithm
// ─────────────────────────────────────────────

/**
 * Finds the lowest-cost path from `start` to `end` using Dijkstra's Algorithm.
 *
 * @param {number[][]} grid  - 2D array of cell costs (1 = road, 5 = traffic, -1 = wall).
 * @param {{ r: number, c: number }} start - Starting cell.
 * @param {{ r: number, c: number }} end   - Target cell.
 * @returns {{
 *   visitedOrder: number[][],
 *   shortestPath: number[][],
 *   totalCost:    number,
 *   executionTime: number
 * }}
 */
export function dijkstra(grid, start, end) {
  const t0 = performance.now();

  const rows = grid.length;
  const cols = grid[0].length;
  const startKey = `${start.r},${start.c}`;
  const endKey   = `${end.r},${end.c}`;

  // dist[r][c] = best known cost to reach (r, c)
  const dist = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
  dist[start.r][start.c] = 0;

  // cameFrom maps key → predecessor key (null for the start node)
  const cameFrom = new Map([[startKey, null]]);

  const pq = new MinHeap();
  pq.push(startKey, 0);

  /** @type {number[][]} Cells popped in settlement order */
  const visitedOrder = [];

  /** @type {Set<string>} Already-settled keys */
  const settled = new Set();

  while (pq.size > 0) {
    const { key: currKey, priority: currCost } = pq.pop();

    // Lazy-deletion: skip if we already settled this node with a lower cost
    if (settled.has(currKey)) continue;
    settled.add(currKey);

    const [r, c] = currKey.split(',').map(Number);
    visitedOrder.push([r, c]);

    // Early exit once we settle the goal
    if (currKey === endKey) {
      return {
        visitedOrder,
        shortestPath: reconstructPath(cameFrom, endKey),
        totalCost:    currCost,
        executionTime: performance.now() - t0,
      };
    }

    // Explore neighbours
    for (const [dr, dc] of DIRECTIONS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!isTraversable(grid, nr, nc)) continue;

      const neighbourKey  = `${nr},${nc}`;
      const edgeCost      = grid[nr][nc]; // cost of entering the neighbour cell
      const tentativeCost = currCost + edgeCost;

      if (tentativeCost < dist[nr][nc]) {
        dist[nr][nc] = tentativeCost;
        cameFrom.set(neighbourKey, currKey);
        pq.push(neighbourKey, tentativeCost);
      }
    }
  }

  // No path found
  return {
    visitedOrder,
    shortestPath: [],
    totalCost:    -1,
    executionTime: performance.now() - t0,
  };
}

// ─────────────────────────────────────────────
//  A* Search
// ─────────────────────────────────────────────

/**
 * Manhattan-distance heuristic (admissible for cost ≥ 1 grids).
 * @param {number} r1 @param {number} c1
 * @param {number} r2 @param {number} c2
 * @returns {number}
 */
function manhattanHeuristic(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

/**
 * Finds the lowest-cost path from `start` to `end` using A* Search
 * with an admissible Manhattan-distance heuristic.
 *
 * @param {number[][]} grid  - 2D array of cell costs (1 = road, 5 = traffic, -1 = wall).
 * @param {{ r: number, c: number }} start - Starting cell.
 * @param {{ r: number, c: number }} end   - Target cell.
 * @returns {{
 *   visitedOrder: number[][],
 *   shortestPath: number[][],
 *   totalCost:    number,
 *   executionTime: number
 * }}
 */
export function aStar(grid, start, end) {
  const t0 = performance.now();

  const rows = grid.length;
  const cols = grid[0].length;
  const startKey = `${start.r},${start.c}`;
  const endKey   = `${end.r},${end.c}`;

  // gScore[r][c] = best known actual cost from start to (r, c)
  const gScore = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
  gScore[start.r][start.c] = 0;

  const cameFrom = new Map([[startKey, null]]);

  const pq = new MinHeap();
  const h0 = manhattanHeuristic(start.r, start.c, end.r, end.c);
  pq.push(startKey, h0); // f = g + h; g=0 so f = h

  /** @type {number[][]} */
  const visitedOrder = [];

  /** @type {Set<string>} */
  const closed = new Set();

  while (pq.size > 0) {
    const { key: currKey } = pq.pop();

    if (closed.has(currKey)) continue;
    closed.add(currKey);

    const [r, c] = currKey.split(',').map(Number);
    visitedOrder.push([r, c]);

    if (currKey === endKey) {
      return {
        visitedOrder,
        shortestPath: reconstructPath(cameFrom, endKey),
        totalCost:    gScore[end.r][end.c],
        executionTime: performance.now() - t0,
      };
    }

    for (const [dr, dc] of DIRECTIONS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!isTraversable(grid, nr, nc)) continue;

      const neighbourKey  = `${nr},${nc}`;
      const edgeCost      = grid[nr][nc];
      const tentativeG    = gScore[r][c] + edgeCost;

      if (tentativeG < gScore[nr][nc]) {
        gScore[nr][nc] = tentativeG;
        cameFrom.set(neighbourKey, currKey);
        const h = manhattanHeuristic(nr, nc, end.r, end.c);
        pq.push(neighbourKey, tentativeG + h); // f = g + h
      }
    }
  }

  // No path found
  return {
    visitedOrder,
    shortestPath: [],
    totalCost:    -1,
    executionTime: performance.now() - t0,
  };
}

// ─────────────────────────────────────────────
//  Console Test Suite
// ─────────────────────────────────────────────

/**
 * Self-contained test function. Run this in Node.js (≥ v18) or any browser
 * console to verify algorithm correctness before integrating with the UI.
 *
 * Run in Node.js:
 *   node --input-type=module < algorithms.js
 *   (or) import { testAlgorithms } from './algorithms.js'; testAlgorithms();
 */
export function testAlgorithms() {
  // ─── Polyfill performance.now for Node < 16 ───────────────────────────────
  if (typeof performance === 'undefined') {
    global.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };
  }

  // ─── Helper ───────────────────────────────────────────────────────────────
  const assert = (label, condition, detail = '') => {
    const icon = condition ? '✅' : '❌';
    console.log(`  ${icon} ${label}${detail ? ' — ' + detail : ''}`);
    if (!condition) console.error(`     ASSERTION FAILED`);
  };

  const pathStr = (p) => p.length ? p.map(([r, c]) => `(${r},${c})`).join(' → ') : '∅';

  // ─── Test Grid 1: Straight corridor, no obstacles ─────────────────────────
  //
  //   0  1  2  3  4
  // 0[S][1][1][1][E]   S=(0,0)  E=(0,4)
  // 1[1][1][1][1][1]   Expected cost: 4
  // 2[1][1][1][1][1]
  // 3[1][1][1][1][1]
  // 4[1][1][1][1][1]
  console.log('\n══════════════════════════════════════════');
  console.log(' SMART AMBULANCE — Algorithm Test Suite');
  console.log('══════════════════════════════════════════\n');

  console.log('📋 Test 1: Straight corridor (5×5, all roads)');
  const grid1 = [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ];
  const start1 = { r: 0, c: 0 };
  const end1   = { r: 0, c: 4 };
  const d1 = dijkstra(grid1, start1, end1);
  const a1 = aStar(grid1, start1, end1);
  console.log(`  Dijkstra  → cost=${d1.totalCost}  path=${pathStr(d1.shortestPath)}  visited=${d1.visitedOrder.length} nodes  time=${d1.executionTime.toFixed(4)}ms`);
  console.log(`  A*        → cost=${a1.totalCost}  path=${pathStr(a1.shortestPath)}  visited=${a1.visitedOrder.length} nodes  time=${a1.executionTime.toFixed(4)}ms`);
  assert('Dijkstra cost = 4',         d1.totalCost === 4);
  assert('A* cost = 4',               a1.totalCost === 4);
  assert('Dijkstra path length = 5',  d1.shortestPath.length === 5);
  assert('A* path length = 5',        a1.shortestPath.length === 5);
  assert('A* visits ≤ Dijkstra (heuristic prunes)', a1.visitedOrder.length <= d1.visitedOrder.length,
         `A*=${a1.visitedOrder.length} Dijkstra=${d1.visitedOrder.length}`);

  // ─── Test Grid 2: Heavy traffic forces detour decision ────────────────────
  //
  //   0  1  2  3  4
  // 0[S][5][5][5][E]   Direct top row: 0→(0,1 cost5)→(0,2 cost5)→(0,3 cost5)→(0,4 cost1) = 16
  // 1[1][1][1][1][1]   Detour via row 1: (1,0 cost1)→(1,1)→(1,2)→(1,3)→(1,4)→(0,4) = 1+1+1+1+1+1 = 6 ← optimal
  // 2[1][1][1][1][1]
  // 3[1][1][1][1][1]
  // 4[1][1][1][1][1]
  console.log('\n📋 Test 2: Heavy-traffic top row (detour via row 1 should be cheaper, cost=6)');
  const grid2 = [
    [1, 5, 5, 5, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ];
  const start2 = { r: 0, c: 0 };
  const end2   = { r: 0, c: 4 };
  const d2 = dijkstra(grid2, start2, end2);
  const a2 = aStar(grid2, start2, end2);
  console.log(`  Dijkstra  → cost=${d2.totalCost}  path=${pathStr(d2.shortestPath)}  visited=${d2.visitedOrder.length} nodes`);
  console.log(`  A*        → cost=${a2.totalCost}  path=${pathStr(a2.shortestPath)}  visited=${a2.visitedOrder.length} nodes`);
  assert('Dijkstra finds optimal (cost = 6)', d2.totalCost === 6);
  assert('A* finds optimal (cost = 6)',       a2.totalCost === 6);
  assert('Both agree on cost',               d2.totalCost === a2.totalCost);

  // ─── Test Grid 3: Fully walled — no path ──────────────────────────────────
  //
  //   0  1  2  3  4
  // 0[S][1][-1][1][E]
  // 1[1][1][-1][1][1]
  // 2[-1][-1][-1][-1][-1]  ← impenetrable wall
  // 3[1][1][-1][1][1]
  // 4[1][1][-1][1][1]
  console.log('\n📋 Test 3: Impassable wall — no path expected');
  const grid3 = [
    [ 1,  1, -1,  1,  1],
    [ 1,  1, -1,  1,  1],
    [-1, -1, -1, -1, -1],
    [ 1,  1, -1,  1,  1],
    [ 1,  1, -1,  1,  1],
  ];
  const start3 = { r: 0, c: 0 };
  const end3   = { r: 4, c: 4 };
  const d3 = dijkstra(grid3, start3, end3);
  const a3 = aStar(grid3, start3, end3);
  console.log(`  Dijkstra  → cost=${d3.totalCost}  path=${pathStr(d3.shortestPath)}`);
  console.log(`  A*        → cost=${a3.totalCost}  path=${pathStr(a3.shortestPath)}`);
  assert('Dijkstra: no path (cost = -1)',     d3.totalCost === -1);
  assert('A*: no path (cost = -1)',           a3.totalCost === -1);
  assert('Dijkstra: empty shortestPath',      d3.shortestPath.length === 0);
  assert('A*: empty shortestPath',            a3.shortestPath.length === 0);

  // ─── Test Grid 4: Maze with mixed costs ───────────────────────────────────
  //
  //   0  1  2  3  4
  // 0[S][-1][1][1][1]
  // 1[5][-1][1][-1][1]
  // 2[5][1][1][-1][E]
  // 3[5][5][-1][-1][1]
  // 4[1][1][1][1][1]
  //
  //  One valid path: (0,0)→(1,0)→(2,0)→(3,0)→(4,0)→(4,1)→(4,2)→(4,3)→(4,4)→(3,4)→(2,4)
  //  cost = 5+5+5+1+1+1+1+1+1 = 21
  //
  //  Another: (0,0)→(1,0)→(2,0)→(2,1)→(2,2)→(1,2)→(0,2)→(0,3)→(0,4)→(1,4)→(2,4)
  //  cost = 5+5+1+1+1+1+1+1+1+1 = 18  ← should win
  console.log('\n📋 Test 4: Maze with mixed traffic & walls');
  const grid4 = [
    [ 1, -1,  1,  1,  1],
    [ 5, -1,  1, -1,  1],
    [ 5,  1,  1, -1,  1],
    [ 5,  5, -1, -1,  1],
    [ 1,  1,  1,  1,  1],
  ];
  const start4 = { r: 0, c: 0 };
  const end4   = { r: 2, c: 4 };
  const d4 = dijkstra(grid4, start4, end4);
  const a4 = aStar(grid4, start4, end4);
  console.log(`  Dijkstra  → cost=${d4.totalCost}  path=${pathStr(d4.shortestPath)}  visited=${d4.visitedOrder.length} nodes`);
  console.log(`  A*        → cost=${a4.totalCost}  path=${pathStr(a4.shortestPath)}  visited=${a4.visitedOrder.length} nodes`);
  assert('Dijkstra cost = 18',         d4.totalCost === 18);
  assert('A* cost = 18',               a4.totalCost === 18);
  assert('Paths end at goal',
         d4.shortestPath.at(-1)?.[0] === 2 && d4.shortestPath.at(-1)?.[1] === 4);

  // ─── Test Grid 5: Start === End ───────────────────────────────────────────
  console.log('\n📋 Test 5: Start equals End');
  const grid5 = [[1, 1], [1, 1]];
  const d5 = dijkstra(grid5, { r: 1, c: 1 }, { r: 1, c: 1 });
  const a5 = aStar(grid5,   { r: 1, c: 1 }, { r: 1, c: 1 });
  console.log(`  Dijkstra  → cost=${d5.totalCost}  path=${pathStr(d5.shortestPath)}`);
  console.log(`  A*        → cost=${a5.totalCost}  path=${pathStr(a5.shortestPath)}`);
  assert('Dijkstra: cost = 0',  d5.totalCost === 0);
  assert('A*: cost = 0',        a5.totalCost === 0);
  assert('Dijkstra: path = [(1,1)]', d5.shortestPath.length === 1);
  assert('A*: path = [(1,1)]',       a5.shortestPath.length === 1);

  console.log('\n══════════════════════════════════════════');
  console.log(' All tests complete. Ready for Step 2 ✔');
  console.log('══════════════════════════════════════════\n');
}

// ─────────────────────────────────────────────
//  Auto-run when executed directly in Node.js
// ─────────────────────────────────────────────
// Detect "main module" execution (Node ESM)
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('algorithms.js')) {
  testAlgorithms();
}
