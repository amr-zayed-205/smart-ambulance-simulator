/**
 * @file model.js
 * @description MVC Model + Observer Pattern Subject for the
 *              Smart Ambulance Pathfinding & Traffic Simulator.
 *
 * Responsibilities:
 *   • Owns all application state: grid, positions, pathfinding results.
 *   • Implements the Observer Subject interface (subscribe / notify).
 *   • Exposes clean mutation methods; zero DOM interaction.
 *
 * Observer Event Types (emitted via notify):
 *   'grid:cellChanged'    → { r, c, oldValue, newValue }
 *   'grid:loaded'         → { mapType, grid }
 *   'position:startMoved' → { oldPos, newPos }
 *   'position:endMoved'   → { oldPos, newPos }
 *   'pathfinding:running' → {}
 *   'pathfinding:done'    → { dijkstra, aStar }
 *   'pathfinding:error'   → { message }
 *   'model:reset'         → {}
 *
 * @module model
 */

import { dijkstra, aStar }       from '../core/algorithms.js';
import { MapFactory, MAP_TYPES } from '../patterns/mapFactory.js';

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────

/** Default grid dimensions */
export const DEFAULT_ROWS = 20;
export const DEFAULT_COLS = 20;

/** Default ambulance start position */
export const DEFAULT_START = Object.freeze({ r: 2,  c: 2  });

/** Default hospital end position */
export const DEFAULT_END   = Object.freeze({ r: 17, c: 17 });

/** Valid cell type values */
export const CELL = Object.freeze({
  ROAD:    1,
  TRAFFIC: 5,
  WALL:   -1,
});

/** All valid observer event type strings */
export const EVENT = Object.freeze({
  CELL_CHANGED:    'grid:cellChanged',
  GRID_LOADED:     'grid:loaded',
  START_MOVED:     'position:startMoved',
  END_MOVED:       'position:endMoved',
  PF_RUNNING:      'pathfinding:running',
  PF_DONE:         'pathfinding:done',
  PF_ERROR:        'pathfinding:error',
  MODEL_RESET:     'model:reset',
});

// ─────────────────────────────────────────────
//  SimulatorModel
// ─────────────────────────────────────────────

/**
 * @typedef {{ r: number, c: number }} GridPos
 *
 * @typedef {{
 *   visitedOrder: number[][],
 *   shortestPath: number[][],
 *   totalCost:    number,
 *   executionTime: number
 * }} PathResult
 *
 * @typedef {{
 *   dijkstra: PathResult | null,
 *   aStar:    PathResult | null
 * }} RunResults
 */

/**
 * Central model for the simulator.
 * Acts as both the MVC Model and the Observer Pattern Subject.
 *
 * Usage:
 * ```js
 * import { SimulatorModel } from './model.js';
 * const model = new SimulatorModel();
 * model.subscribe((eventType, data) => { ... });
 * model.loadPreset('RushHour');
 * model.runPathfinding();
 * ```
 */
export class SimulatorModel {
  // ── Private state ──────────────────────────────────────────────────────────
  #rows;
  #cols;
  #grid;         // number[][]
  #startPos;     // GridPos
  #endPos;       // GridPos
  #results;      // RunResults
  #observers;    // Set<Function>
  #currentMapType; // string | null

  /**
   * @param {number} [rows=DEFAULT_ROWS]
   * @param {number} [cols=DEFAULT_COLS]
   */
  constructor(rows = DEFAULT_ROWS, cols = DEFAULT_COLS) {
    this.#rows = rows;
    this.#cols = cols;
    this.#observers = new Set();
    this.#results = { dijkstra: null, aStar: null };
    this.#currentMapType = 'Empty';

    // Initialise with an empty grid and default positions
    this.#grid     = MapFactory.createMap('Empty', rows, cols);
    this.#startPos = { ...DEFAULT_START };
    this.#endPos   = { ...DEFAULT_END   };
  }

  // ─────────────────────────────────────────────
  //  Observer Pattern — Subject Interface
  // ─────────────────────────────────────────────

  /**
   * Registers an observer callback.
   * @param {(eventType: string, data: object) => void} observer
   * @returns {() => void} Unsubscribe function (call it to remove the observer).
   */
  subscribe(observer) {
    if (typeof observer !== 'function') {
      throw new TypeError('SimulatorModel.subscribe: observer must be a function');
    }
    this.#observers.add(observer);
    // Return an unsubscribe handle (convenient for cleanup in view)
    return () => this.#observers.delete(observer);
  }

  /**
   * Removes a previously-registered observer.
   * @param {(eventType: string, data: object) => void} observer
   */
  unsubscribe(observer) {
    this.#observers.delete(observer);
  }

  /**
   * Dispatches an event to all registered observers.
   * Errors inside individual observers are caught and logged to avoid
   * crashing the whole notification chain.
   * @param {string} eventType
   * @param {object} [data={}]
   */
  notify(eventType, data = {}) {
    for (const observer of this.#observers) {
      try {
        observer(eventType, data);
      } catch (err) {
        console.error(`[SimulatorModel] Observer threw on "${eventType}":`, err);
      }
    }
  }

  // ─────────────────────────────────────────────
  //  Read-only Accessors (deep-frozen snapshots)
  // ─────────────────────────────────────────────

  /** @returns {number} */
  get rows() { return this.#rows; }

  /** @returns {number} */
  get cols() { return this.#cols; }

  /**
   * Returns a deep copy of the grid (safe for the view to read without
   * accidentally mutating model state).
   * @returns {number[][]}
   */
  get grid() {
    return this.#grid.map(row => [...row]);
  }

  /**
   * Returns a copy of the start position.
   * @returns {GridPos}
   */
  get startPos() { return { ...this.#startPos }; }

  /**
   * Returns a copy of the end position.
   * @returns {GridPos}
   */
  get endPos() { return { ...this.#endPos }; }

  /**
   * Returns a snapshot of the last pathfinding results.
   * @returns {RunResults}
   */
  get results() {
    return {
      dijkstra: this.#results.dijkstra ? { ...this.#results.dijkstra } : null,
      aStar:    this.#results.aStar    ? { ...this.#results.aStar    } : null,
    };
  }

  /**
   * Returns the name of the currently loaded map preset (or null if unknown).
   * @returns {string | null}
   */
  get currentMapType() { return this.#currentMapType; }

  /**
   * Returns the raw value of a single cell without cloning the whole grid.
   * @param {number} r
   * @param {number} c
   * @returns {number} Cell value (1, 5, or -1).
   */
  getCellValue(r, c) {
    this.#assertInBounds(r, c, 'getCellValue');
    return this.#grid[r][c];
  }

  // ─────────────────────────────────────────────
  //  Grid Mutation
  // ─────────────────────────────────────────────

  /**
   * Sets the type of a single cell.
   * Guards:
   *   • Rejects out-of-bounds coordinates.
   *   • Prevents walling the start or end cell.
   *   • Prevents painting over the start or end cell with traffic.
   *
   * @param {number} r
   * @param {number} c
   * @param {-1 | 1 | 5} type - CELL.WALL, CELL.ROAD, or CELL.TRAFFIC.
   * @returns {boolean} True if the cell was actually changed.
   */
  setCellType(r, c, type) {
    this.#assertInBounds(r, c, 'setCellType');

    if (![CELL.WALL, CELL.ROAD, CELL.TRAFFIC].includes(type)) {
      throw new RangeError(
        `setCellType: invalid type "${type}". Must be ${CELL.WALL}, ${CELL.ROAD}, or ${CELL.TRAFFIC}.`
      );
    }

    // Protect start / end cells — they may only be roads
    if (this.#isSentinel(r, c)) {
      console.warn(`setCellType: cannot modify sentinel cell (${r},${c}).`);
      return false;
    }

    const oldValue = this.#grid[r][c];
    if (oldValue === type) return false; // No-op

    this.#grid[r][c] = type;
    // Invalidate stale pathfinding results
    this.#results = { dijkstra: null, aStar: null };
    this.notify(EVENT.CELL_CHANGED, { r, c, oldValue, newValue: type });
    return true;
  }

  /**
   * Paints a rectangular region of the grid.
   * Useful for the view's brush tool. Skips sentinel cells silently.
   * @param {number} r1
   * @param {number} c1
   * @param {number} r2
   * @param {number} c2
   * @param {-1 | 1 | 5} type
   */
  fillRegion(r1, c1, r2, c2, type) {
    const rMin = Math.max(0, Math.min(r1, r2));
    const rMax = Math.min(this.#rows - 1, Math.max(r1, r2));
    const cMin = Math.max(0, Math.min(c1, c2));
    const cMax = Math.min(this.#cols - 1, Math.max(c1, c2));
    for (let r = rMin; r <= rMax; r++)
      for (let c = cMin; c <= cMax; c++)
        this.setCellType(r, c, type); // Will notify per cell
  }

  // ─────────────────────────────────────────────
  //  Position Management
  // ─────────────────────────────────────────────

  /**
   * Moves the ambulance start position.
   * Guards:
   *   • Must be in-bounds.
   *   • Cannot be placed on a wall.
   *   • Cannot coincide with endPos.
   *
   * @param {number} r
   * @param {number} c
   * @returns {boolean} True if the position was changed.
   */
  setStartPos(r, c) {
    return this.#moveSentinel('start', r, c);
  }

  /**
   * Moves the hospital end position.
   * @param {number} r
   * @param {number} c
   * @returns {boolean} True if the position was changed.
   */
  setEndPos(r, c) {
    return this.#moveSentinel('end', r, c);
  }

  // ─────────────────────────────────────────────
  //  Preset Loading
  // ─────────────────────────────────────────────

  /**
   * Loads a preset map, resetting positions and results.
   * @param {import('./mapFactory.js').MapType} mapType
   * @param {number} [rows]  - Optionally resize the grid.
   * @param {number} [cols]
   */
  loadPreset(mapType, rows, cols) {
    if (!MAP_TYPES.includes(mapType)) {
      throw new Error(`loadPreset: Unknown map type "${mapType}". Valid: ${MAP_TYPES.join(', ')}`);
    }

    if (rows !== undefined) this.#rows = rows;
    if (cols !== undefined) this.#cols = cols;

    this.#grid         = MapFactory.createMap(mapType, this.#rows, this.#cols);
    this.#currentMapType = mapType;
    this.#results      = { dijkstra: null, aStar: null };

    // Reset positions to safe defaults
    this.#startPos = { ...DEFAULT_START };
    this.#endPos   = { ...DEFAULT_END   };
    // Ensure defaults are open roads (map might have covered them)
    this.#grid[this.#startPos.r][this.#startPos.c] = CELL.ROAD;
    this.#grid[this.#endPos.r  ][this.#endPos.c  ] = CELL.ROAD;

    this.notify(EVENT.GRID_LOADED, {
      mapType,
      grid: this.grid, // deep copy for observers
    });
  }

  /**
   * Resets everything back to defaults (Empty map, default positions, no results).
   */
  reset() {
    this.loadPreset('Empty', DEFAULT_ROWS, DEFAULT_COLS);
    this.notify(EVENT.MODEL_RESET, {});
  }

  // ─────────────────────────────────────────────
  //  Pathfinding
  // ─────────────────────────────────────────────

  /**
   * Runs both Dijkstra and A* on the current grid synchronously.
   *
   * Emits:
   *   • `pathfinding:running` immediately (lets the view show a spinner).
   *   • `pathfinding:done`    with both results on success.
   *   • `pathfinding:error`   if an exception is thrown.
   *
   * @returns {RunResults | null} The results, or null on error.
   */
  runPathfinding() {
    // Validate that start/end are not walls
    if (this.#grid[this.#startPos.r][this.#startPos.c] === CELL.WALL) {
      const msg = 'Start position is on a wall. Move it to an open road first.';
      this.notify(EVENT.PF_ERROR, { message: msg });
      return null;
    }
    if (this.#grid[this.#endPos.r][this.#endPos.c] === CELL.WALL) {
      const msg = 'End position is on a wall. Move it to an open road first.';
      this.notify(EVENT.PF_ERROR, { message: msg });
      return null;
    }

    this.notify(EVENT.PF_RUNNING, {});

    try {
      const gridSnapshot = this.#grid; // algorithms.js only reads
      const dijkstraResult = dijkstra(gridSnapshot, { ...this.#startPos }, { ...this.#endPos });
      const aStarResult    = aStar   (gridSnapshot, { ...this.#startPos }, { ...this.#endPos });

      this.#results = { dijkstra: dijkstraResult, aStar: aStarResult };

      this.notify(EVENT.PF_DONE, {
        dijkstra: { ...dijkstraResult },
        aStar:    { ...aStarResult    },
      });

      return this.results;
    } catch (err) {
      const message = `Pathfinding failed: ${err.message}`;
      console.error('[SimulatorModel]', message, err);
      this.notify(EVENT.PF_ERROR, { message });
      return null;
    }
  }

  // ─────────────────────────────────────────────
  //  Serialisation (bonus — useful for save/load)
  // ─────────────────────────────────────────────

  /**
   * Serialises the current model state to a plain JSON-safe object.
   * @returns {object}
   */
  toJSON() {
    return {
      rows:       this.#rows,
      cols:       this.#cols,
      mapType:    this.#currentMapType,
      grid:       this.grid,           // deep copy
      startPos:   { ...this.#startPos },
      endPos:     { ...this.#endPos   },
    };
  }

  /**
   * Restores model state from a plain object (e.g. parsed from JSON).
   * @param {ReturnType<SimulatorModel['toJSON']>} snapshot
   */
  fromJSON(snapshot) {
    const { rows, cols, mapType, grid, startPos, endPos } = snapshot;
    this.#rows = rows;
    this.#cols = cols;
    this.#currentMapType = mapType ?? null;
    this.#grid     = grid.map(row => [...row]);
    this.#startPos = { ...startPos };
    this.#endPos   = { ...endPos   };
    this.#results  = { dijkstra: null, aStar: null };
    this.notify(EVENT.GRID_LOADED, { mapType: this.#currentMapType, grid: this.grid });
  }

  // ─────────────────────────────────────────────
  //  Private Helpers
  // ─────────────────────────────────────────────

  /**
   * Throws if (r, c) is out of grid bounds.
   * @param {number} r @param {number} c @param {string} caller
   */
  #assertInBounds(r, c, caller = '?') {
    if (r < 0 || r >= this.#rows || c < 0 || c >= this.#cols) {
      throw new RangeError(
        `${caller}: (${r},${c}) is out of bounds for a ${this.#rows}×${this.#cols} grid.`
      );
    }
  }

  /**
   * Returns true if (r, c) is currently the start or end sentinel.
   */
  #isSentinel(r, c) {
    return (r === this.#startPos.r && c === this.#startPos.c)
        || (r === this.#endPos.r   && c === this.#endPos.c  );
  }

  /**
   * Internal method to move start or end sentinel positions.
   * @param {'start' | 'end'} which
   * @param {number} r @param {number} c
   * @returns {boolean}
   */
  #moveSentinel(which, r, c) {
    this.#assertInBounds(r, c, `set${which[0].toUpperCase() + which.slice(1)}Pos`);

    const isStart   = which === 'start';
    const current   = isStart ? this.#startPos : this.#endPos;
    const other     = isStart ? this.#endPos   : this.#startPos;

    // No-op if position hasn't changed
    if (current.r === r && current.c === c) return false;

    // Cannot land on the other sentinel
    if (other.r === r && other.c === c) {
      console.warn(`set${which}Pos: (${r},${c}) is already the ${isStart ? 'end' : 'start'} position.`);
      return false;
    }

    // Cannot land on a wall
    if (this.#grid[r][c] === CELL.WALL) {
      console.warn(`set${which}Pos: (${r},${c}) is a wall — position not moved.`);
      return false;
    }

    const oldPos = { ...current };
    const newPos = { r, c };

    if (isStart) {
      this.#startPos = newPos;
      this.#grid[r][c] = CELL.ROAD; // Ensure target cell is passable
    } else {
      this.#endPos = newPos;
      this.#grid[r][c] = CELL.ROAD;
    }

    // Invalidate stale results
    this.#results = { dijkstra: null, aStar: null };

    this.notify(
      isStart ? EVENT.START_MOVED : EVENT.END_MOVED,
      { oldPos, newPos }
    );
    return true;
  }
}
