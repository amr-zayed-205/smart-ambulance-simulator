/**
 * Comprehensive verification of the reorganized project structure:
 * - Algorithms in src/core/algorithms.js
 * - Factory in src/patterns/mapFactory.js
 * - Model in src/model/model.js
 * - View in src/view/view.js
 * - Controller in src/controller/controller.js
 * - CSS in assets/css/style.css
 * - HTML in index.html
 */
import fs from 'fs';
import path from 'path';

// ── Polyfill performance.now for Node ──────────────────────────────────────
if (typeof performance === 'undefined') {
  const { performance: perf } = await import('perf_hooks');
  global.performance = perf;
}

const baseDir = process.cwd();

console.log('\n══════════════════════════════════════════════════════════════');
console.log('    VERIFYING REORGANIZED FOLDER STRUCTURE & ES6 MODULES      ');
console.log('══════════════════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  const icon = condition ? '✅' : '❌';
  console.log(`  ${icon} ${label}${detail ? ' — ' + detail : ''}`);
  if (condition) passed++; else { failed++; console.error('     ASSERTION FAILED'); }
}

// 1. Verify File Existence in New Structure
console.log('--- 1. File Locations ---');
const expectedFiles = [
  'index.html',
  'assets/css/style.css',
  'src/core/algorithms.js',
  'src/patterns/mapFactory.js',
  'src/model/model.js',
  'src/view/view.js',
  'src/controller/controller.js'
];

for (const relPath of expectedFiles) {
  const fullPath = path.join(baseDir, relPath);
  const exists = fs.existsSync(fullPath);
  assert(`File exists: ${relPath}`, exists);
}

// 2. Dynamic ES6 Module Imports from New Structure
console.log('\n--- 2. Module Imports from src/ ---');

let dijkstra, aStar, testAlgorithms;
try {
  const algoMod = await import('../src/core/algorithms.js');
  dijkstra = algoMod.dijkstra;
  aStar = algoMod.aStar;
  testAlgorithms = algoMod.testAlgorithms;
  assert('Imported dijkstra and aStar from src/core/algorithms.js', typeof dijkstra === 'function' && typeof aStar === 'function');
} catch (e) {
  assert('Imported dijkstra and aStar from src/core/algorithms.js', false, e.message);
}

let MapFactory, MAP_TYPES;
try {
  const mapMod = await import('../src/patterns/mapFactory.js');
  MapFactory = mapMod.MapFactory;
  MAP_TYPES = mapMod.MAP_TYPES;
  assert('Imported MapFactory from src/patterns/mapFactory.js', typeof MapFactory.createMap === 'function');
} catch (e) {
  assert('Imported MapFactory from src/patterns/mapFactory.js', false, e.message);
}

let SimulatorModel, CELL, EVENT;
try {
  const modelMod = await import('../src/model/model.js');
  SimulatorModel = modelMod.SimulatorModel;
  CELL = modelMod.CELL;
  EVENT = modelMod.EVENT;
  assert('Imported SimulatorModel from src/model/model.js', typeof SimulatorModel === 'function');
} catch (e) {
  assert('Imported SimulatorModel from src/model/model.js', false, e.message);
}

// 3. Functional Test with Model & Algorithms in new locations
console.log('\n--- 3. Functional Execution ---');
try {
  const model = new SimulatorModel(20, 20);
  assert('Model initialized with 20x20', model.rows === 20 && model.cols === 20);

  model.loadPreset('RushHour');
  assert('RushHour preset loaded via MapFactory', model.currentMapType === 'RushHour');

  const results = model.runPathfinding();
  assert('Dijkstra and A* executed cleanly', results && results.dijkstra && results.aStar);
  assert('Paths found without errors', results.dijkstra.totalCost > 0 && results.aStar.totalCost > 0);
  console.log(`     Dijkstra cost: ${results.dijkstra.totalCost}, A* cost: ${results.aStar.totalCost}`);
} catch (e) {
  assert('Functional Execution', false, e.message);
}

// 4. Check HTML Links
console.log('\n--- 4. HTML Links to Assets and Src ---');
const htmlContent = fs.readFileSync(path.join(baseDir, 'index.html'), 'utf8');
assert('HTML links to assets/css/style.css', htmlContent.includes('href="assets/css/style.css"'));
assert('HTML links to src/controller/controller.js', htmlContent.includes('src="src/controller/controller.js"'));

// 5. Check CSS Validity
console.log('\n--- 5. CSS Earth-Toned Theme Presence ---');
const cssContent = fs.readFileSync(path.join(baseDir, 'assets/css/style.css'), 'utf8');
assert('CSS has soft warm beige base (#F5F2EB)', cssContent.includes('#F5F2EB'));
assert('CSS has olive green brand (#4A5D23 or #556B2F)', cssContent.includes('#4A5D23') || cssContent.includes('#556B2F'));
assert('CSS grid container direction is ltr', cssContent.includes('direction: ltr !important'));

console.log('\n==============================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? 'ALL CHECKS PASSED ✅' : 'SOME CHECKS FAILED ❌');
console.log('==============================================================\n');

process.exit(failed > 0 ? 1 : 0);
