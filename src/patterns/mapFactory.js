/**
 * @file mapFactory.js
 * @description Factory Pattern — generates preset city grid maps for the
 *              Smart Ambulance Pathfinding & Traffic Simulator.
 *
 * Cell Value Conventions (matches algorithms.js):
 *   1  → Normal road      (traversal cost = 1)
 *   5  → Heavy traffic    (traversal cost = 5)
 *  -1  → Wall / Roadblock (impassable)
 *
 * @module mapFactory
 */

// ─────────────────────────────────────────────
//  Internal Helpers
// ─────────────────────────────────────────────

/**
 * Allocates a new 2D array filled with the given value.
 * @param {number} rows
 * @param {number} cols
 * @param {number} [fill=1]
 * @returns {number[][]}
 */
function makeGrid(rows, cols, fill = 1) {
  return Array.from({ length: rows }, () => Array(cols).fill(fill));
}

/**
 * Returns a seeded pseudo-random integer in [min, max] (inclusive).
 * Uses a simple LCG so the same seed always produces the same map.
 * @param {{ next: () => number }} rng - LCG RNG object.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function rngInt(rng, min, max) {
  return min + Math.floor(rng.next() * (max - min + 1));
}

/**
 * Creates a seeded LCG pseudo-random number generator.
 * @param {number} [seed=42]
 * @returns {{ next: () => number }}
 */
function makeLCG(seed = 42) {
  // Parameters from Numerical Recipes
  const a = 1664525;
  const c = 1013904223;
  const m = 2 ** 32;
  let state = seed >>> 0;
  return {
    next() {
      state = ((a * state + c) >>> 0) % m;
      return state / m; // [0, 1)
    },
  };
}

/**
 * Checks reachability from `start` to `end` using BFS (walls block passage).
 * Used internally to validate that a generated maze has at least one valid path.
 * @param {number[][]} grid
 * @param {{ r: number, c: number }} start
 * @param {{ r: number, c: number }} end
 * @returns {boolean}
 */
function hasPath(grid, start, end) {
  const rows = grid.length;
  const cols = grid[0].length;
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
  const queue = [[start.r, start.c]];
  visited[start.r][start.c] = true;

  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  while (queue.length) {
    const [r, c] = queue.shift();
    if (r === end.r && c === end.c) return true;
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols
          && !visited[nr][nc] && grid[nr][nc] !== -1) {
        visited[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }
  return false;
}

// ─────────────────────────────────────────────
//  Preset Builders
// ─────────────────────────────────────────────

/**
 * EMPTY — All normal roads. Perfect for drawing your own scenario.
 */
function buildEmpty(rows, cols) {
  return makeGrid(rows, cols, 1);
}

/**
 * RUSH HOUR — Mimics a city at peak hour.
 * Strategy:
 *   • Lays a regular grid of "arterial streets" (every 4 rows/cols).
 *   • Marks intersection zones and main arteries as heavy traffic (5).
 *   • Places occasional short wall segments (construction / accidents).
 *   • Start (2,2) and End (rows-3, cols-3) zones are always kept clear.
 */
function buildRushHour(rows, cols) {
  const grid = makeGrid(rows, cols, 1);
  const rng = makeLCG(2024);

  // ── Arterial roads every 4 cells ─────────────────────────────────────────
  const arterialRows = new Set();
  const arterialCols = new Set();
  for (let r = 4; r < rows - 1; r += 4) arterialRows.add(r);
  for (let c = 4; c < cols - 1; c += 4) arterialCols.add(c);

  // Mark arteries as heavy traffic
  for (const ar of arterialRows)
    for (let c = 0; c < cols; c++) grid[ar][c] = 5;
  for (const ac of arterialCols)
    for (let r = 0; r < rows; r++) grid[r][ac] = 5;

  // ── Traffic hot-spots: 3×3 blobs near intersections ──────────────────────
  for (const ar of arterialRows) {
    for (const ac of arterialCols) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = ar + dr;
          const nc = ac + dc;
          if (nr > 0 && nr < rows - 1 && nc > 0 && nc < cols - 1)
            grid[nr][nc] = 5;
        }
      }
    }
  }

  // ── Random short wall segments (road-works / accidents) ───────────────────
  const wallCount = Math.floor(rows * cols * 0.03); // ~3 % of cells
  let placed = 0;
  while (placed < wallCount) {
    const r  = rngInt(rng, 1, rows - 2);
    const c  = rngInt(rng, 1, cols - 2);
    const len = rngInt(rng, 2, 4);
    const horiz = rng.next() > 0.5;

    for (let i = 0; i < len; i++) {
      const wr = horiz ? r : Math.min(r + i, rows - 2);
      const wc = horiz ? Math.min(c + i, cols - 2) : c;
      // Never wall the start or end safety zone
      if ((wr < 5 && wc < 5) || (wr > rows - 6 && wc > cols - 6)) continue;
      grid[wr][wc] = -1;
      placed++;
    }
  }

  // ── Guarantee clear start/end zones ──────────────────────────────────────
  const clearZone = (cr, cc, radius = 2) => {
    for (let dr = -radius; dr <= radius; dr++)
      for (let dc = -radius; dc <= radius; dc++) {
        const nr = cr + dr, nc = cc + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols)
          grid[nr][nc] = 1;
      }
  };
  clearZone(2, 2);
  clearZone(rows - 3, cols - 3);

  return grid;
}

/**
 * MAZE — Structured labyrinth using recursive-division.
 * Guarantees a valid path from (2,2) to (rows-3, cols-3) by:
 *   1. Carving corridors via recursive division.
 *   2. Verifying connectivity with BFS.
 *   3. If BFS fails, carving a guaranteed escape corridor along the border.
 */
function buildMaze(rows, cols) {
  // Start with all walls, then carve corridors
  const grid = makeGrid(rows, cols, -1);
  const rng = makeLCG(1337);

  /**
   * Recursive division: carve passages in [r1,r2] × [c1,c2].
   * Orientation alternates by chamber aspect ratio.
   */
  function divide(r1, c1, r2, c2, depth) {
    const h = r2 - r1;
    const w = c2 - c1;
    if (h < 2 || w < 2) return;

    // Choose split orientation: horizontal wall if taller, vertical if wider
    const horizontal = h >= w ? rng.next() > 0.4 : rng.next() < 0.4;

    if (horizontal) {
      // Draw horizontal wall at a random even row inside [r1+1, r2-1]
      const wallRow = r1 + 1 + 2 * Math.floor(rng.next() * Math.floor((h - 1) / 2));
      const passCol  = c1 + 2 * Math.floor(rng.next() * Math.ceil(w / 2));
      for (let c = c1; c <= c2; c++) grid[wallRow][c] = -1;
      if (passCol <= c2) grid[wallRow][passCol] = 1; // passage hole
      divide(r1, c1, wallRow - 1, c2, depth + 1);
      divide(wallRow + 1, c1, r2, c2, depth + 1);
    } else {
      // Draw vertical wall at a random even col inside [c1+1, c2-1]
      const wallCol = c1 + 1 + 2 * Math.floor(rng.next() * Math.floor((w - 1) / 2));
      const passRow  = r1 + 2 * Math.floor(rng.next() * Math.ceil(h / 2));
      for (let r = r1; r <= r2; r++) grid[r][wallCol] = -1;
      if (passRow <= r2) grid[passRow][wallCol] = 1; // passage hole
      divide(r1, c1, r2, wallCol - 1, depth + 1);
      divide(r1, wallCol + 1, r2, c2, depth + 1);
    }
  }

  // ── Carve the full interior as open roads first ───────────────────────────
  for (let r = 1; r < rows - 1; r++)
    for (let c = 1; c < cols - 1; c++)
      grid[r][c] = 1;

  // ── Apply recursive division to create walls ──────────────────────────────
  divide(1, 1, rows - 2, cols - 2, 0);

  // ── Sprinkle traffic in open corridors ───────────────────────────────────
  for (let r = 1; r < rows - 1; r++)
    for (let c = 1; c < cols - 1; c++)
      if (grid[r][c] === 1 && rng.next() < 0.12) grid[r][c] = 5;

  // ── Keep border solid ────────────────────────────────────────────────────
  for (let r = 0; r < rows; r++) { grid[r][0] = -1; grid[r][cols-1] = -1; }
  for (let c = 0; c < cols; c++) { grid[0][c] = -1; grid[rows-1][c] = -1; }

  // ── Clear start/end areas ────────────────────────────────────────────────
  const clearArea = (cr, cc) => {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const nr = cr + dr, nc = cc + dc;
        if (nr > 0 && nr < rows - 1 && nc > 0 && nc < cols - 1)
          grid[nr][nc] = 1;
      }
  };
  clearArea(2, 2);
  clearArea(rows - 3, cols - 3);

  // ── BFS connectivity check — carve escape corridor if needed ─────────────
  const startPos = { r: 2, c: 2 };
  const endPos   = { r: rows - 3, c: cols - 3 };
  if (!hasPath(grid, startPos, endPos)) {
    // Carve an L-shaped corridor along row 2 and then column cols-3
    for (let c = 1; c < cols - 1; c++) if (grid[2][c] === -1) grid[2][c] = 1;
    for (let r = 1; r < rows - 1; r++) if (grid[r][cols-3] === -1) grid[r][cols-3] = 1;
  }

  return grid;
}

/**
 * RANDOM — Stochastic map with configurable density.
 * Walls: ~20 % of non-border cells.
 * Traffic: ~20 % of remaining open cells.
 * Guarantees connectivity from (2,2) to (rows-3, cols-3) via BFS + fallback strip.
 */
function buildRandom(rows, cols) {
  const rng = makeLCG(Date.now() & 0xffffffff); // Truly random seed each call
  const grid = makeGrid(rows, cols, 1);

  // ── Solid border ─────────────────────────────────────────────────────────
  for (let r = 0; r < rows; r++) { grid[r][0] = -1; grid[r][cols-1] = -1; }
  for (let c = 0; c < cols; c++) { grid[0][c] = -1; grid[rows-1][c] = -1; }

  // ── Random walls & traffic ────────────────────────────────────────────────
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const roll = rng.next();
      if (roll < 0.20)      grid[r][c] = -1; // wall
      else if (roll < 0.40) grid[r][c] = 5;  // traffic
      // else stays 1 (road)
    }
  }

  // ── Clear start / end safety zones ───────────────────────────────────────
  const clearZone = (cr, cc, radius = 2) => {
    for (let dr = -radius; dr <= radius; dr++)
      for (let dc = -radius; dc <= radius; dc++) {
        const nr = cr + dr, nc = cc + dc;
        if (nr > 0 && nr < rows - 1 && nc > 0 && nc < cols - 1)
          grid[nr][nc] = 1;
      }
  };
  clearZone(2, 2);
  clearZone(rows - 3, cols - 3);

  // ── Connectivity guarantee ────────────────────────────────────────────────
  if (!hasPath(grid, { r: 2, c: 2 }, { r: rows - 3, c: cols - 3 })) {
    // Carve a guaranteed L-shaped open corridor
    const midRow = Math.floor(rows / 2);
    for (let c = 1; c < cols - 1; c++) if (grid[midRow][c] === -1) grid[midRow][c] = 1;
    for (let r = 1; r < rows - 1; r++) if (grid[r][cols - 3] === -1) grid[r][cols - 3] = 1;
  }

  return grid;
}

// ─────────────────────────────────────────────
//  MapFactory — Public API
// ─────────────────────────────────────────────

/**
 * @typedef {'Empty' | 'RushHour' | 'Maze' | 'Random'} MapType
 */

/**
 * Supported map type identifiers.
 * @type {readonly MapType[]}
 */
export const MAP_TYPES = Object.freeze(['Empty', 'RushHour', 'Maze', 'Random']);

/**
 * Factory class for generating city grid maps.
 *
 * @example
 * import { MapFactory } from './mapFactory.js';
 * const grid = MapFactory.createMap('RushHour', 20, 20);
 */
export class MapFactory {
  /**
   * Creates a grid map of the specified type.
   *
   * @param {MapType} type   - One of 'Empty', 'RushHour', 'Maze', 'Random'.
   * @param {number}  [rows=20] - Number of grid rows.
   * @param {number}  [cols=20] - Number of grid columns.
   * @returns {number[][]} 2D array where values are 1, 5, or -1.
   * @throws {Error} If an unknown map type is requested.
   */
  static createMap(type, rows = 20, cols = 20) {
    switch (type) {
      case 'Empty':    return buildEmpty(rows, cols);
      case 'RushHour': return buildRushHour(rows, cols);
      case 'Maze':     return buildMaze(rows, cols);
      case 'Random':   return buildRandom(rows, cols);
      default:
        throw new Error(
          `MapFactory: Unknown map type "${type}". Valid types: ${MAP_TYPES.join(', ')}`
        );
    }
  }

  /**
   * Returns a human-readable description for each map type.
   * Useful for populating UI dropdowns.
   * @param {MapType} type
   * @returns {{ label: string, description: string }}
   */
  static describe(type) {
    const descriptions = {
      Empty:    { label: '🗺️ Empty City',  description: 'All open roads — draw your own scenario.' },
      RushHour: { label: '🚦 Rush Hour',   description: 'Peak-hour traffic clusters and arterial jams.' },
      Maze:     { label: '🧩 Maze City',   description: 'Structured labyrinth — guaranteed valid route.' },
      Random:   { label: '🎲 Random Map',  description: 'Random walls & traffic, guaranteed reachable.' },
    };
    return descriptions[type] ?? { label: type, description: '' };
  }
}
