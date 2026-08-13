/* ══════════════════════════════════════════════════════════════
   WarEra+ — Sincronizzazione tema con Political View
   ------------------------------------------------------------------
   Componente NUOVO, non tocca alcun file di Diplomacy o Political.

   Come funziona: Political View (public/political/) e lo shell
   WarEra+ sono serviti dalla STESSA origin (stesso dominio Vercel),
   quindi condividono lo stesso localStorage — anche dentro l'iframe.
   Political legge il tema da `localStorage.getItem('we_theme')`
   (public/political/config.js: initTheme()) al boot. Basta quindi
   scrivere in quella stessa chiave quando il tema cambia nello shell,
   e Political lo userà automaticamente al prossimo caricamento
   dell'iframe — zero modifiche al codice Political.

   Per l'aggiornamento LIVE (iframe già aperto quando l'utente cambia
   tema), chiamiamo direttamente `contentWindow.applyTheme(...)`, la
   funzione già esistente in public/political/config.js — accessibile
   perché same-origin, senza bisogno di postMessage.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';

const WE_THEME_KEY = 'we_theme'; // stessa chiave usata da Political

function _writeTheme(theme) {
  try { localStorage.setItem(WE_THEME_KEY, theme); } catch (_) {}
}

function _applyToIframeIfOpen(theme) {
  const frame = document.getElementById('wp-political-frame');
  if (!frame) return;
  try {
    const win = frame.contentWindow;
    if (win && typeof win.applyTheme === 'function') {
      win.applyTheme(theme);
    }
  } catch (_) {
    // iframe non ancora caricato o cross-origin per qualche motivo
    // imprevisto: non blocchiamo nulla, verrà comunque letto da
    // localStorage al prossimo load.
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
  // aperto prima di qualunque toggle tema).
  _writeTheme(state.theme === 'light' ? 'light' : 'dark');

  btn.addEventListener('click', () => {
    // state.theme è già stato aggiornato dal listener di Diplomacy
    // (main.js), registrato prima del nostro.
    const theme = state.theme === 'light' ? 'light' : 'dark';
    _writeTheme(theme);
    _applyToIframeIfOpen(theme);
  });
}

/** Chiamata quando si apre/ricarica l'overlay Political, per allineare
 *  subito il tema anche se l'iframe viene ricaricato da zero. */
export function syncThemeToFrame() {
  _writeTheme(state.theme === 'light' ? 'light' : 'dark');
}
