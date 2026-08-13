/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ridimensionamento pannello nazione
   ------------------------------------------------------------------
   Componente NUOVO. Trascinando la maniglia sul bordo sinistro del
   pannello se ne cambia la larghezza (min/max e persistenza in
   localStorage). La larghezza corrente viene esposta come variabile
   CSS --wp-panel-width sulla radice del documento, usata sia dal
   pannello stesso sia da shell.css per traslare i controlli in alto
   a destra (toggle Current/Original, tema, lingua) quando il pannello
   è aperto — vedi regola `body.wp-panel-open #wp-top-controls`.
   ══════════════════════════════════════════════════════════════ */

const MIN_WIDTH = 300;
const MAX_WIDTH_RATIO = 0.7; // non oltre il 70% della viewport
const STORAGE_KEY = 'wp_panel_width';
const DEFAULT_WIDTH = 380;

function _clamp(width) {
  const max = Math.min(window.innerWidth * MAX_WIDTH_RATIO, 900);
  return Math.max(MIN_WIDTH, Math.min(width, max));
}

function _applyWidth(width) {
  document.documentElement.style.setProperty('--wp-panel-width', `${width}px`);
}

function _loadSavedWidth() {
  try {
    const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (!isNaN(saved)) return _clamp(saved);
  } catch (_) {}
  return DEFAULT_WIDTH;
}

function _saveWidth(width) {
  try { localStorage.setItem(STORAGE_KEY, String(Math.round(width))); } catch (_) {}
}

let _currentWidth = DEFAULT_WIDTH;

export function initPanelResize() {
  const handle = document.getElementById('wp-panel-resize-handle');
  if (!handle) return;

  _currentWidth = _loadSavedWidth();
  _applyWidth(_currentWidth);

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const onPointerMove = (e) => {
    if (!dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    // Il pannello è ancorato al bordo destro: trascinare la maniglia
    // (sul bordo sinistro del pannello) verso sinistra allarga il
    // pannello, quindi la larghezza aumenta quando clientX diminuisce.
    const delta = startX - clientX;
    _currentWidth = _clamp(startWidth + delta);
    _applyWidth(_currentWidth);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('wp-resizing');
    _saveWidth(_currentWidth);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    // Il grafico parlamento (SVG) è dimensionato in base alla larghezza
    // reale del contenitore al momento del render: senza questo evento
    // resterebbe alla vecchia larghezza finché non si seleziona una
    // nazione diversa. Il ri-render avviene solo a fine trascinamento
    // (non durante, per evitare di ricalcolare il layout ad ogni pixel).
    window.dispatchEvent(new CustomEvent('wareraplus:panel-resized'));
  };

  const onPointerDown = (e) => {
    dragging = true;
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    startWidth = _currentWidth;
    document.body.classList.add('wp-resizing');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    e.preventDefault();
  };

  handle.addEventListener('pointerdown', onPointerDown);

  // Se la finestra si restringe (es. rotazione mobile), rientra nei
  // limiti invece di lasciare il pannello più largo della viewport.
  // Anche un semplice ridimensionamento della finestra (senza toccare
  // la maniglia) cambia la larghezza reale disponibile per il grafico
  // parlamento, quindi va ri-renderizzato anche qui (debounced, per non
  // ricalcolare ad ogni singolo pixel durante il resize della finestra).
  let resizeDebounce = null;
  window.addEventListener('resize', () => {
    const clamped = _clamp(_currentWidth);
    if (clamped !== _currentWidth) {
      _currentWidth = clamped;
      _applyWidth(_currentWidth);
    }
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('wareraplus:panel-resized'));
    }, 200);
  });
}

export function getPanelWidth() {
  return _currentWidth;
}
