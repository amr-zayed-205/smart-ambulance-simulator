/**
 * @file controller.js
 * @description MVC Controller — wires DOM events to the Model.
 *
 * Responsibilities:
 *   • Instantiates SimulatorModel and SimulatorView (the entry point).
 *   • Attaches all UI event listeners (toolbar, grids).
 *   • Delegates every state mutation to the model.
 *   • Never reads or writes DOM directly for data display (view owns that).
 *
 * @module controller
 */

import { SimulatorModel, CELL } from '../model/model.js';
import { SimulatorView }         from '../view/view.js';

// ─────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────

const model = new SimulatorModel();
const view  = new SimulatorView(model);

// Apply initial view mode (compare side-by-side)
view.setMode('compare');

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────

/** @type {'wall'|'traffic'|'road'|'start'|'end'} */
let currentTool = 'wall';

/** True while mouse/touch button is held down over a grid. */
let isPainting = false;

/** True while a simulation is animating (block re-run). */
let isRunning = false;

/** True once a simulation has completed, enabling live reactive rerouting. */
let hasRun = false;

// ─────────────────────────────────────────────
//  DOM Helpers
// ─────────────────────────────────────────────

const $ = id => document.getElementById(id);

const btnRun   = $('btn-run');
const btnClear = $('btn-clear');
const btnReset = $('btn-reset');

/** Map tool name → CELL value for paint-type tools. */
const TOOL_TO_CELL = {
  wall:    CELL.WALL,
  traffic: CELL.TRAFFIC,
  road:    CELL.ROAD,
};

// ─────────────────────────────────────────────
//  Toolbar — Preset Map
// ─────────────────────────────────────────────

const PRESET_NAMES_AR = {
  Empty:    'الخريطة الفارغة',
  RushHour: 'زحام ساعة الذروة',
  Maze:     'متاهة المدينة',
  Random:   'العوائق العشوائية',
};

$('select-preset').addEventListener('change', e => {
  if (isRunning) return;
  hasRun = false;
  view.setLiveMode(false);
  model.loadPreset(e.target.value);
  const nameAr = PRESET_NAMES_AR[e.target.value] || e.target.value;
  view.showToast(`تم تحميل نمط: ${nameAr}`, 'success');
});

// ─────────────────────────────────────────────
//  Toolbar — View Mode
// ─────────────────────────────────────────────

$('select-mode').addEventListener('change', e => {
  view.setMode(e.target.value);
});

// ─────────────────────────────────────────────
//  Toolbar — Tool Selector (radio group)
// ─────────────────────────────────────────────

$('tool-selector').addEventListener('change', e => {
  if (e.target.type !== 'radio') return;
  _selectTool(e.target.value);
});

function _selectTool(tool) {
  currentTool = tool;

  // Update active class on labels
  document.querySelectorAll('#tool-selector .tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  // Cursor hint on <body> for move-type tools
  document.body.className = `tool-${tool}`;
}

// ─────────────────────────────────────────────
//  Toolbar — Speed (no extra wiring needed;
//            view reads it at animation time)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  Toolbar — Action Buttons
// ─────────────────────────────────────────────

btnRun.addEventListener('click', () => {
  if (isRunning) return;
  _setRunningState(true);

  // Yield one frame so the button updates visually before heavy work
  requestAnimationFrame(() => {
    setTimeout(() => {
      model.runPathfinding();
    }, 16);
  });
});

btnClear.addEventListener('click', () => {
  hasRun = false;
  view.setLiveMode(false);
  view.clearPath();
});

btnReset.addEventListener('click', () => {
  hasRun = false;
  view.setLiveMode(false);
  if (isRunning) {
    view.cancelAnimation();
    _setRunningState(false);
  }
  model.reset();
  $('select-preset').value = 'Empty';
  view.showToast('تمت إعادة ضبط الخريطة بالكامل.', 'info');
});

/** Fired by the view when the animation (or error) finishes. */
document.addEventListener('simulation:complete', () => {
  _setRunningState(false);
  hasRun = true;
  view.setLiveMode(true);
});

function _setRunningState(running) {
  isRunning = running;
  btnRun.disabled  = running;
  btnRun.innerHTML = running
    ? '<span class="btn-icon">⏳</span> جاري الحساب…'
    : '<span class="btn-icon">▶</span> تشغيل المحاكاة';
}

// ─────────────────────────────────────────────
//  Grid Painting (mouse + touch, delegated)
// ─────────────────────────────────────────────

/**
 * Core interaction handler.
 * @param {HTMLElement} cellEl - The `.cell` element that was targeted.
 */
function _handleCellInteraction(cellEl) {
  const r = Number(cellEl.dataset.r);
  const c = Number(cellEl.dataset.c);

  const { startPos, endPos } = model;
  const isSentinel = (r === startPos.r && c === startPos.c) || (r === endPos.r && c === endPos.c);

  // Edge-case guard: Prevent overwriting Ambulance or Hospital with walls or traffic
  if (isSentinel && (currentTool === 'wall' || currentTool === 'traffic')) {
    view.showToast('لا يمكن وضع جدار أو زحام فوق سيارة الإسعاف 🚑 أو المستشفى 🏥.', 'info');
    return;
  }

  let changed = false;
  switch (currentTool) {
    case 'wall':
    case 'traffic':
    case 'road':
      changed = model.setCellType(r, c, TOOL_TO_CELL[currentTool]);
      break;
    case 'start':
      changed = model.setStartPos(r, c);
      break;
    case 'end':
      changed = model.setEndPos(r, c);
      break;
  }

  // Live Rerouting (Observer Showcase): recalculate immediately if simulation has run
  if (changed && hasRun && !isRunning) {
    model.runPathfinding();
  }
}

/** Attach painting listeners to both grid containers via event delegation. */
for (const which of ['dijkstra', 'astar']) {
  const container = $(`grid-${which}`);
  if (!container) continue;

  // ── Mouse events ──────────────────────────────────────────────────────────
  container.addEventListener('mousedown', e => {
    if (isRunning) return;
    const el = e.target.closest('.cell');
    if (!el) return;
    e.preventDefault();
    isPainting = true;
    _handleCellInteraction(el);
  });

  container.addEventListener('mousemove', e => {
    if (!isPainting || isRunning) return;
    const el = e.target.closest('.cell');
    if (!el) return;
    // Move-type tools only act on click, not drag
    if (currentTool === 'start' || currentTool === 'end') return;
    _handleCellInteraction(el);
  });

  container.addEventListener('mouseleave', () => {
    // Keep isPainting so the user can re-enter and continue
  });

  // ── Touch events ──────────────────────────────────────────────────────────
  container.addEventListener('touchstart', e => {
    if (isRunning) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.cell');
    if (!el) return;
    e.preventDefault();
    isPainting = true;
    _handleCellInteraction(el);
  }, { passive: false });

  container.addEventListener('touchmove', e => {
    if (!isPainting || isRunning) return;
    if (currentTool === 'start' || currentTool === 'end') return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.cell');
    if (!el) return;
    e.preventDefault();
    _handleCellInteraction(el);
  }, { passive: false });
}

// Stop painting when mouse is released anywhere
document.addEventListener('mouseup',  () => { isPainting = false; });
document.addEventListener('touchend', () => { isPainting = false; });

// Prevent context menu on right-click over grids
document.querySelectorAll('.grid-container').forEach(g => {
  g.addEventListener('contextmenu', e => e.preventDefault());
});

// ─────────────────────────────────────────────
//  Keyboard Shortcuts
// ─────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Ignore when typing in an input/select
  if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;

  switch (e.key) {
    case 'r':
    case 'R':
      if (!isRunning) btnRun.click();
      break;

    case 'Escape': {
      const modal = $('arch-modal');
      if (modal && !modal.classList.contains('hidden')) {
        view.closeModal();
      } else {
        hasRun = false;
        view.setLiveMode(false);
        view.clearPath();
      }
      break;
    }

    case '1':
      _selectToolUI('wall');
      break;
    case '2':
      _selectToolUI('traffic');
      break;
    case '3':
      _selectToolUI('road');
      break;
    case '4':
      _selectToolUI('start');
      break;
    case '5':
      _selectToolUI('end');
      break;
  }
});

/** Programmatically activate a tool and sync the radio UI. */
function _selectToolUI(tool) {
  const radio = document.querySelector(`#tool-selector input[value="${tool}"]`);
  if (radio) {
    radio.checked = true;
    _selectTool(tool);
  }
}

// ─────────────────────────────────────────────
//  Right-click eraser convenience
//  (right-click any cell to erase it)
// ─────────────────────────────────────────────

for (const which of ['dijkstra', 'astar']) {
  const container = $(`grid-${which}`);
  if (!container) continue;

  container.addEventListener('mousedown', e => {
    if (e.button !== 2) return; // right-click only
    if (isRunning) return;
    const el = e.target.closest('.cell');
    if (!el) return;
    e.preventDefault();
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    const { startPos, endPos } = model;
    if ((r === startPos.r && c === startPos.c) || (r === endPos.r && c === endPos.c)) return;
    const changed = model.setCellType(r, c, CELL.ROAD); // erase
    if (changed && hasRun && !isRunning) {
      model.runPathfinding();
    }
    isPainting = true;
  });

  container.addEventListener('mousemove', e => {
    if (e.buttons !== 2) return; // right-button drag
    if (!isPainting || isRunning) return;
    const el = e.target.closest('.cell');
    if (!el) return;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    const { startPos, endPos } = model;
    if ((r === startPos.r && c === startPos.c) || (r === endPos.r && c === endPos.c)) return;
    const changed = model.setCellType(r, c, CELL.ROAD);
    if (changed && hasRun && !isRunning) {
      model.runPathfinding();
    }
  });
}
