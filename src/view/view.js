/**
 * @file view.js
 * @description MVC View + Observer Pattern Listener.
 *
 * Responsibilities (zero model mutations):
 *   • Subscribes to SimulatorModel events.
 *   • Builds and maintains two separate DOM grids (Dijkstra / A*).
 *   • Runs the step-by-step animation engine for path exploration & results.
 *   • Updates metrics cards and status badges.
 *   • Renders toast notifications and the verdict banner.
 *
 * @module view
 */

import { CELL, EVENT } from '../model/model.js';

// ─────────────────────────────────────────────
//  Animation Speed Map
// ─────────────────────────────────────────────

/** Milliseconds per step for each speed setting. */
const SPEED_DELAY = {
  instant: 0,
  fast:    10,
  medium:  35,
};

// ─────────────────────────────────────────────
//  AnimationEngine — internal helper
// ─────────────────────────────────────────────

/**
 * Manages a cancellable queue of setTimeout-based animation steps.
 * Wraps individual timeouts so the whole sequence can be aborted at once.
 */
class AnimationEngine {
  #timers  = [];
  #running = false;

  get isRunning() { return this.#running; }

  /** Cancel all pending steps immediately. */
  cancel() {
    this.#timers.forEach(id => clearTimeout(id));
    this.#timers  = [];
    this.#running = false;
  }

  /**
   * Runs the full animation sequence for both algorithms simultaneously.
   *
   * Phase 1 — visited-node exploration (interleaved, same frame cadence).
   * Phase 2 — pause, then reveal final paths cell by cell.
   *
   * @param {object}   cfg
   * @param {number[][]} cfg.visitedD   - Dijkstra visited order [[r,c],…]
   * @param {number[][]} cfg.visitedA   - A* visited order [[r,c],…]
   * @param {number[][]} cfg.pathD      - Dijkstra final path
   * @param {number[][]} cfg.pathA      - A* final path
   * @param {number}   cfg.delay        - ms per step
   * @param {string}   cfg.mode         - 'compare' | 'dijkstra' | 'astar'
   * @param {Function} cfg.markVisitedD - (r,c)=>void
   * @param {Function} cfg.markVisitedA - (r,c)=>void
   * @param {Function} cfg.markPathD    - (r,c)=>void
   * @param {Function} cfg.markPathA    - (r,c)=>void
   * @param {Function} cfg.onComplete   - called when all steps finish
   */
  run(cfg) {
    this.cancel();
    this.#running = true;

    const {
      visitedD, visitedA, pathD, pathA,
      delay, mode,
      markVisitedD, markVisitedA, markPathD, markPathA,
      onComplete,
    } = cfg;

    const showD = (mode !== 'astar');
    const showA = (mode !== 'dijkstra');

    // ── Instant mode — apply everything synchronously ──────────────────────
    if (delay === 0) {
      if (showD) { visitedD.forEach(([r,c]) => markVisitedD(r,c)); pathD.forEach(([r,c]) => markPathD(r,c)); }
      if (showA) { visitedA.forEach(([r,c]) => markVisitedA(r,c)); pathA.forEach(([r,c]) => markPathA(r,c)); }
      this.#running = false;
      onComplete?.();
      return;
    }

    // ── Animated mode ─────────────────────────────────────────────────────
    const schedule = (fn, delay) => {
      const id = setTimeout(() => {
        if (!this.#running) return;
        fn();
      }, delay);
      this.#timers.push(id);
    };

    // Phase 1: visited nodes (both algorithms run in lock-step)
    const maxVisited = Math.max(
      showD ? visitedD.length : 0,
      showA ? visitedA.length : 0,
    );
    let t = 0;
    for (let i = 0; i < maxVisited; i++) {
      const idx = i;
      schedule(() => {
        if (showD && idx < visitedD.length) markVisitedD(...visitedD[idx]);
        if (showA && idx < visitedA.length) markVisitedA(...visitedA[idx]);
      }, t);
      t += delay;
    }

    // Phase 2: brief dramatic pause before path reveal
    t += delay * 6;

    // Phase 3: path cells revealed (slightly slower for drama)
    const pathDelay = delay * 2.2;
    const maxPath = Math.max(
      showD ? pathD.length : 0,
      showA ? pathA.length : 0,
    );
    for (let i = 0; i < maxPath; i++) {
      const idx = i;
      schedule(() => {
        if (showD && idx < pathD.length) markPathD(...pathD[idx]);
        if (showA && idx < pathA.length) markPathA(...pathA[idx]);
      }, t);
      t += pathDelay;
    }

    // Complete callback
    schedule(() => {
      this.#running = false;
      onComplete?.();
    }, t + delay * 2);
  }
}

// ─────────────────────────────────────────────
//  SimulatorView — public class
// ─────────────────────────────────────────────

/**
 * @typedef {'dijkstra'|'astar'} WhichGrid
 */

export class SimulatorView {
  /** @type {import('../model/model.js').SimulatorModel} */
  #model;

  /** @type {{ dijkstra: HTMLElement[][], astar: HTMLElement[][] }} */
  #cells = { dijkstra: [], astar: [] };

  /** @type {AnimationEngine} */
  #anim = new AnimationEngine();

  /** Unsubscribe handle from the model */
  #unsub;

  /** @type {boolean} Flag indicating real-time reactive rerouting is active */
  #isLiveMode = false;

  /**
   * @param {import('../model/model.js').SimulatorModel} model
   */
  constructor(model) {
    this.#model = model;
    this.#unsub = model.subscribe((type, data) => this.#onEvent(type, data));
    this.#buildGrids();
    this.#renderAll();
    this.#initModalListeners();
  }

  get isLiveMode() { return this.#isLiveMode; }

  /**
   * Enables or disables live rerouting mode.
   * When active, paints trigger instant recalculations.
   * @param {boolean} active
   */
  setLiveMode(active) {
    this.#isLiveMode = active;
    const indicator = document.getElementById('live-indicator');
    if (indicator) {
      indicator.classList.toggle('hidden', !active);
    }
  }

  // ─────────────────────────────────────────────
  //  DOM Construction
  // ─────────────────────────────────────────────

  /** Creates all 2×400 cell elements and stores references. */
  #buildGrids() {
    const { rows, cols } = this.#model;

    for (const which of /** @type {WhichGrid[]} */ (['dijkstra', 'astar'])) {
      const container = document.getElementById(`grid-${which}`);
      if (!container) continue;

      container.innerHTML = '';
      this.#cells[which] = [];

      for (let r = 0; r < rows; r++) {
        this.#cells[which][r] = [];
        for (let c = 0; c < cols; c++) {
          const el = document.createElement('div');
          el.className = 'cell';
          el.dataset.r     = String(r);
          el.dataset.c     = String(c);
          el.dataset.which = which;
          // ARIA
          el.setAttribute('role', 'gridcell');
          container.appendChild(el);
          this.#cells[which][r][c] = el;
        }
      }
    }
  }

  /** Full re-render of every cell's base visual. */
  #renderAll() {
    const { rows, cols } = this.#model;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        this.#applyCellBase(r, c);
  }

  /**
   * Updates BOTH grids' visual for cell (r,c) based on model state.
   * Clears any animation overlay classes on that cell.
   */
  #applyCellBase(r, c) {
    const { startPos, endPos } = this.#model;
    const val = this.#model.getCellValue(r, c);

    let cls = 'cell';
    if      (r === startPos.r && c === startPos.c) cls += ' cell-start';
    else if (r === endPos.r   && c === endPos.c  ) cls += ' cell-end';
    else if (val === CELL.WALL)                     cls += ' cell-wall';
    else if (val === CELL.TRAFFIC)                  cls += ' cell-traffic';
    else                                            cls += ' cell-road';

    for (const which of /** @type {WhichGrid[]} */ (['dijkstra', 'astar'])) {
      const el = this.#cells[which]?.[r]?.[c];
      if (el) el.className = cls;
    }
  }

  // ─────────────────────────────────────────────
  //  Observer — Model Event Handler
  // ─────────────────────────────────────────────

  #onEvent(type, data) {
    switch (type) {

      case EVENT.GRID_LOADED:
        this.setLiveMode(false);
        this.#hideBlockedBanner();
        this.#anim.cancel();
        this.#buildGrids();
        this.#renderAll();
        this.#clearMetrics();
        this.#setStatus('dijkstra', 'جاهز', '');
        this.#setStatus('astar',    'جاهز', '');
        this.#hideVerdict();
        break;

      case EVENT.CELL_CHANGED:
        this.#applyCellBase(data.r, data.c);
        if (!this.#isLiveMode) {
          this.#anim.cancel();
          this.#clearPathOverlay();
          this.#clearMetrics();
          this.#hideVerdict();
          this.#hideBlockedBanner();
        }
        break;

      case EVENT.START_MOVED:
        this.#applyCellBase(data.oldPos.r, data.oldPos.c);
        this.#applyCellBase(data.newPos.r, data.newPos.c);
        if (!this.#isLiveMode) {
          this.#anim.cancel();
          this.#clearPathOverlay();
          this.#clearMetrics();
          this.#hideVerdict();
          this.#hideBlockedBanner();
        }
        break;

      case EVENT.END_MOVED:
        this.#applyCellBase(data.oldPos.r, data.oldPos.c);
        this.#applyCellBase(data.newPos.r, data.newPos.c);
        if (!this.#isLiveMode) {
          this.#anim.cancel();
          this.#clearPathOverlay();
          this.#clearMetrics();
          this.#hideVerdict();
          this.#hideBlockedBanner();
        }
        break;

      case EVENT.PF_RUNNING:
        if (!this.#isLiveMode) {
          this.#clearPathOverlay();
          this.#setStatus('dijkstra', 'جاري الحساب…', 'running');
          this.#setStatus('astar',    'جاري الحساب…', 'running');
          this.#hideVerdict();
        }
        break;

      case EVENT.PF_DONE:
        this.#onPFDone(data);
        break;

      case EVENT.PF_ERROR:
        this.#setStatus('dijkstra', 'خطأ', 'error');
        this.#setStatus('astar',    'خطأ', 'error');
        this.showToast(data.message, 'error');
        // Re-enable the run button via custom event
        document.dispatchEvent(new CustomEvent('simulation:complete', { detail: { isLive: this.#isLiveMode } }));
        break;

      case EVENT.MODEL_RESET:
        this.setLiveMode(false);
        this.#hideBlockedBanner();
        this.#anim.cancel();
        this.#buildGrids();
        this.#renderAll();
        this.#clearMetrics();
        this.#setStatus('dijkstra', 'جاهز', '');
        this.#setStatus('astar',    'جاهز', '');
        this.#hideVerdict();
        break;
    }
  }

  // ─────────────────────────────────────────────
  //  Pathfinding Animation
  // ─────────────────────────────────────────────

  #onPFDone({ dijkstra: dr, aStar: ar }) {
    this.#clearPathOverlay();

    const mode     = document.getElementById('select-mode')?.value  ?? 'compare';
    const speedKey = document.getElementById('select-speed')?.value ?? 'fast';
    const delay    = this.#isLiveMode ? 0 : (SPEED_DELAY[speedKey] ?? SPEED_DELAY.fast);

    // Update metrics immediately (before animation starts)
    this.#updateMetrics('dijkstra', dr);
    this.#updateMetrics('astar',    ar);

    const { startPos, endPos } = this.#model;

    /** Mark a cell with an overlay class, skipping start/end markers. */
    const mark = (which, r, c, cls) => {
      if ((r === startPos.r && c === startPos.c) ||
          (r === endPos.r   && c === endPos.c  )) return;
      this.#cells[which]?.[r]?.[c]?.classList.add(cls);
    };

    this.#anim.run({
      visitedD: dr.visitedOrder,
      visitedA: ar.visitedOrder,
      pathD: dr.totalCost === -1 ? [] : dr.shortestPath,
      pathA: ar.totalCost === -1 ? [] : ar.shortestPath,
      delay,
      mode,
      markVisitedD: (r, c) => mark('dijkstra', r, c, 'cell-visited-d'),
      markVisitedA: (r, c) => mark('astar',    r, c, 'cell-visited-a'),
      markPathD:    (r, c) => mark('dijkstra', r, c, 'cell-path-d'),
      markPathA:    (r, c) => mark('astar',    r, c, 'cell-path-a'),
      onComplete: () => {
        // Status labels in Arabic
        const dLabel = dr.totalCost === -1 ? 'لا يوجد مسار' : `التكلفة: ${dr.totalCost}`;
        const aLabel = ar.totalCost === -1 ? 'لا يوجد مسار' : `التكلفة: ${ar.totalCost}`;
        this.#setStatus('dijkstra', dLabel, dr.totalCost === -1 ? 'error' : 'done');
        this.#setStatus('astar',    aLabel, ar.totalCost === -1 ? 'error' : 'done');
        this.#renderVerdict(dr, ar);
        this.#updateBlockedBanner(dr, ar);
        document.dispatchEvent(new CustomEvent('simulation:complete', { detail: { isLive: this.#isLiveMode } }));
      },
    });
  }

  // ─────────────────────────────────────────────
  //  Cell Overlay Management
  // ─────────────────────────────────────────────

  static #OVERLAY_CLASSES = ['cell-visited-d', 'cell-visited-a', 'cell-path-d', 'cell-path-a'];

  /** Remove all animation overlay classes from every cell in both grids. */
  #clearPathOverlay() {
    const cls = SimulatorView.#OVERLAY_CLASSES;
    for (const which of ['dijkstra', 'astar'])
      for (const row of (this.#cells[which] ?? []))
        for (const el of (row ?? []))
          if (el) el.classList.remove(...cls);
  }

  // ─────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────

  /**
   * Clears path visuals without touching model state.
   * Called by controller when the user clicks "Clear Path".
   */
  clearPath() {
    this.setLiveMode(false);
    this.#anim.cancel();
    this.#clearPathOverlay();
    this.#clearMetrics();
    this.#setStatus('dijkstra', 'جاهز', '');
    this.#setStatus('astar',    'جاهز', '');
    this.#hideVerdict();
    this.#hideBlockedBanner();
  }

  /** Cancels an in-progress animation (but keeps results). */
  cancelAnimation() {
    this.#anim.cancel();
  }

  /**
   * Applies mode-specific panel visibility and stage CSS class.
   * @param {'compare'|'dijkstra'|'astar'} mode
   */
  setMode(mode) {
    const stage = document.getElementById('stage');
    if (!stage) return;
    stage.className = `mode-${mode}`;

    document.getElementById('panel-dijkstra')?.classList.toggle('hidden', mode === 'astar');
    document.getElementById('panel-astar')   ?.classList.toggle('hidden', mode === 'dijkstra');
  }

  /**
   * Returns the flat cell-element array for event delegation in the controller.
   * @param {WhichGrid} which
   * @returns {HTMLElement[][]}
   */
  getCells(which) { return this.#cells[which]; }

  /** Cleanly detach the view from the model. */
  destroy() {
    this.#unsub?.();
    this.#anim.cancel();
  }

  // ─────────────────────────────────────────────
  //  Metrics Card
  // ─────────────────────────────────────────────

  /**
   * @param {WhichGrid} which
   * @param {import('./model.js').PathResult} result
   */
  #updateMetrics(which, result) {
    const p = which === 'dijkstra' ? 'dijk' : 'astar';
    const $  = id => document.getElementById(id);

    const noPath = result.totalCost === -1;
    const explored = $(`${p}-explored`);
    const cost     = $(`${p}-cost`);
    const steps    = $(`${p}-steps`);
    const time     = $(`${p}-time`);
    if (!explored) return;

    explored.textContent = result.visitedOrder.length.toLocaleString();
    steps   .textContent = noPath ? '0' : result.shortestPath.length.toLocaleString();
    time    .textContent = result.executionTime.toFixed(3);

    if (noPath) {
      cost.textContent = '∅ لا يوجد مسار';
      cost.classList.add('metric-no-path');
    } else {
      cost.textContent = result.totalCost.toLocaleString();
      cost.classList.remove('metric-no-path');
    }
  }

  #clearMetrics() {
    for (const id of [
      'dijk-explored','dijk-cost','dijk-steps','dijk-time',
      'astar-explored','astar-cost','astar-steps','astar-time',
    ]) {
      const el = document.getElementById(id);
      if (el) { el.textContent = '—'; el.classList.remove('metric-no-path'); }
    }
  }

  // ─────────────────────────────────────────────
  //  Status Badge
  // ─────────────────────────────────────────────

  /**
   * @param {WhichGrid} which
   * @param {string}    text
   * @param {'running'|'done'|'error'|''} state
   */
  #setStatus(which, text, state) {
    const el = document.getElementById(`status-${which}`);
    if (!el) return;
    el.textContent = text;
    el.className = `panel-status${state ? ` status-${state}` : ''}`;
  }

  // ─────────────────────────────────────────────
  //  Verdict Banner
  // ─────────────────────────────────────────────

  #renderVerdict(dr, ar) {
    const bar  = document.getElementById('verdict-bar');
    const text = document.getElementById('verdict-text');
    if (!bar || !text) return;

    const dCost = dr.totalCost;
    const aCost = ar.totalCost;

    if (dCost === -1 && aCost === -1) {
      text.textContent = '⛔ الطريق مغلق بالكامل: لم تعثر أي من الخوارزميتين على مسار للمستشفى.';
    } else if (dCost === -1) {
      text.textContent = '🟢 خوارزمية A* وجدت مساراً — بينما تعذّر على Dijkstra الوصول للمستشفى.';
    } else if (aCost === -1) {
      text.textContent = '🟡 خوارزمية Dijkstra وجدت مساراً — بينما تعذّر على A* الوصول للمستشفى.';
    } else {
      const dNodes = dr.visitedOrder.length;
      const aNodes = ar.visitedOrder.length;
      const nodeSaved  = dNodes - aNodes;
      const pctSaved   = ((nodeSaved / dNodes) * 100).toFixed(0);
      const costEqual  = dCost === aCost;

      let msg = '';
      if (costEqual) {
        msg += `⚖️ كلا الخوارزميتين وصلتا للمسار الأمثل بنفس التكلفة (${dCost}). `;
      } else if (dCost < aCost) {
        msg += `🟡 خوارزمية Dijkstra حققت تكلفة أقل (${dCost} مقابل ${aCost}). `;
      } else {
        msg += `🟢 خوارزمية A* حققت تكلفة أقل (${aCost} مقابل ${dCost}). `;
      }

      if (nodeSaved > 0) {
        msg += `خوارزمية A* وفّرت فحص ${nodeSaved} مربعاً (${pctSaved}% جهد أقل) بفضل التوجيه الذكي نحو المستشفى!`;
      } else if (nodeSaved < 0) {
        msg += `خوارزمية Dijkstra فحصت ${Math.abs(nodeSaved)} مربعاً أقل في هذا التوزيع.`;
      } else {
        msg += `كلا الخوارزميتين فحصتا نفس عدد المربعات تماماً.`;
      }

      text.textContent = msg;
    }

    bar.classList.remove('hidden');
  }

  #hideVerdict() {
    document.getElementById('verdict-bar')?.classList.add('hidden');
  }

  // ─────────────────────────────────────────────
  //  Route Blocked Warning Banner
  // ─────────────────────────────────────────────

  #updateBlockedBanner(dr, ar) {
    const banner = document.getElementById('route-blocked-banner');
    if (!banner) return;
    const isBlocked = (dr.totalCost === -1 && ar.totalCost === -1) || 
                      (dr.shortestPath.length === 0 && ar.shortestPath.length === 0);
    if (isBlocked) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  #hideBlockedBanner() {
    document.getElementById('route-blocked-banner')?.classList.add('hidden');
  }

  // ─────────────────────────────────────────────
  //  Architecture Modal
  // ─────────────────────────────────────────────

  openModal() {
    document.getElementById('arch-modal')?.classList.remove('hidden');
  }

  closeModal() {
    document.getElementById('arch-modal')?.classList.add('hidden');
  }

  #initModalListeners() {
    document.getElementById('btn-dismiss-blocked')?.addEventListener('click', () => {
      this.#hideBlockedBanner();
    });

    document.getElementById('btn-arch')?.addEventListener('click', () => {
      this.openModal();
    });

    document.getElementById('modal-close')?.addEventListener('click', () => {
      this.closeModal();
    });

    document.getElementById('modal-ok-btn')?.addEventListener('click', () => {
      this.closeModal();
    });

    document.getElementById('arch-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'arch-modal') {
        this.closeModal();
      }
    });
  }

  // ─────────────────────────────────────────────
  //  Toast Notification
  // ─────────────────────────────────────────────

  /**
   * Shows a toast notification that auto-dismisses after 3.5 s.
   * @param {string} message
   * @param {'info'|'error'|'success'} [type='info']
   */
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger CSS transition on next frame
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-visible')));

    setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 3500);
  }
}
