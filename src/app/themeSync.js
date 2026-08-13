/* ══════════════════════════════════════════════════════════════
   WarEra+ — Sincronizzazione tema con Political View (Fase 2, Stage 9)
   ------------------------------------------------------------------
   Fino a questo stage, l'aggiornamento LIVE del tema (iframe già
   aperto quando l'utente cambia tema) chiamava
   `frameEl.contentWindow.applyTheme(...)` — funzionava solo perché
   `applyTheme` in public/political/config.js era una function
   declaration (quindi proprietà di `window` per hoisting) e same-origin.

   Ora che Political gira in-page (Stage 5-8), non c'è più un
   `contentWindow` da attraversare: `applyTheme` è una vera funzione
   esportata da src/political/config.js, chiamabile con un `import()`
   dinamico diretto — nessun try/catch per "iframe non ancora caricato
   o cross-origin", quel caso non esiste più.

   Il boot iniziale resta identico: Political (src/political/config.js:
   initTheme(), chiamata da main.js:initPoliticalView() al primo mount,
   Stage 8) legge `localStorage.getItem('we_theme')` da sola — questo
   file continua a scrivere quella stessa chiave condivisa, quindi
   funziona senza alcuna azione esplicita di "sync prima dell'apertura"
   (la vecchia `syncThemeToFrame`, rimossa: non serve più un passo
   dedicato pre-apertura, la chiave è già scritta dal click precedente
   sul bottone tema).
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';

const WE_THEME_KEY = 'we_theme'; // stessa chiave usata da Political

function _writeTheme(theme) {
  try { localStorage.setItem(WE_THEME_KEY, theme); } catch (_) {}
}

/**
 * Aggiorna il tema di Political SOLO se è già stata montata almeno una
 * volta in questa sessione (altrimenti importare src/political/config.js
 * qui scaricherebbe una parte del bundle Political solo per un toggle
 * tema, prima ancora che l'utente abbia mai aperto quella vista —
 * vanificando il code-splitting via import() dinamico di
 * politicalOverlay.js). Se Political non è mai stata aperta, la chiave
 * localStorage scritta sopra basta: initTheme() la leggerà correttamente
 * al primo mount, quando che sia.
 */
async function _applyToPoliticalIfMounted(theme) {
  const root = document.getElementById('wp-political-root');
  if (!root || !root.children.length) return;
  try {
    const { applyTheme } = await import('../political/config.js');
    applyTheme(theme);
  } catch (_) {
    // Non dovrebbe accadere (stesso documento, nessun confine iframe),
    // ma non blocchiamo il resto dell'app se capita.
  }
}

/**
 * Aggancia un listener AGGIUNTIVO sul bottone tema esistente
 * (#theme-toggle-btn, già gestito da diplomacy/main.js). Il nostro
 * listener viene registrato dopo (import order in src/main.js), quindi
 * quando scatta legge già lo `state.theme` aggiornato dal listener
 * originale di Diplomacy — nessuna modifica a quel file.
 */
export function initThemeSync() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;

  // Sincronizza subito lo stato iniziale (utile se Political viene
  // aperta prima di qualunque toggle tema).
  _writeTheme(state.theme === 'light' ? 'light' : 'dark');

  btn.addEventListener('click', () => {
    // state.theme è già stato aggiornato dal listener di Diplomacy
    // (main.js), registrato prima del nostro.
    const theme = state.theme === 'light' ? 'light' : 'dark';
    _writeTheme(theme);
    _applyToPoliticalIfMounted(theme);
  });
}
