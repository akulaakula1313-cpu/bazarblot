/* ============================================================================
 * ԲԱԶԱՌ-ԲԼՈՏ — Client Entry
 * SANI GROUP
 * ============================================================================ */

import './styles.css';
import { UI } from './ui.js';
import { Online, setCallbacks } from './online.js';

/* ===== CALLBACKS ===== */
setCallbacks({
  showToast: (msg, type) => UI.showToast(msg, type),
  showScreen: (name) => UI.showScreen(name),
  getEngine: () => UI.engine,
  setEngine: (e) => { UI.engine = e; },
  getGameMode: () => UI.gameMode,
  setGameMode: (m) => { UI.gameMode = m; },
  setMyPlayerId: (id) => { UI.myPlayerId = id; },
  particles: UI.particles
});

/* ===== GLOBAL ===== */
window.BB = {
  UI,
  Online,
  PHASES: UI.PHASES,
  CONFIG: UI.CONFIG
};

/* ===== BOOTSTRAP ===== */
document.addEventListener('DOMContentLoaded', () => {
  UI.init();
  Online.init();
  window.showScreen = (n) => UI.showScreen(n);
  window.showToast = (m, t) => UI.showToast(m, t);
  window.BBParticles = UI.particles;
});

/* ===== ERRORS ===== */
window.addEventListener('error', (e) => console.error('[BB] Global:', e.error));
window.addEventListener('unhandledrejection', (e) => console.error('[BB] Promise:', e.reason));