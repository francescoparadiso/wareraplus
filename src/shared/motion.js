/* ══════════════════════════════════════════════════════════════
   WarEra+ — Interruttore unico delle animazioni (Impostazioni)
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-11): un interruttore che ferma TUTTE le
   animazioni, lasciando frecce e colori.

   Perché serve: le animazioni della mappa NON guardano più
   `prefers-reduced-motion` (Windows con gli "Effetti di animazione"
   spenti lo dichiara a ogni sito, e l'utente non vedeva le comete delle
   migrazioni — vedi migrationFlows.js). Senza questo interruttore chi le
   animazioni non le vuole, per gusto, batteria o un PC lento, non aveva
   modo di spegnerle.

   Cosa spegne: comete (migrazioni), trattini e onde (battaglie, time
   machine), monete (finanziamenti), impulsi (sfere), battito (danni),
   onde dei ping, lampi delle conquiste, navi delle rotte oceaniche e
   sfondi a particelle delle sezioni. Restano archi, frecce, colori e le
   etichette dei ping (ferme). NON spegne il replay della battaglia: è una
   riproduzione che si avvia a mano, non un ornamento.

   Come: chi anima chiede animationsOn() prima di partire e a ogni
   fotogramma; il cambio passa per l'evento `wareraplus:motionchange` e
   per la classe `wp-no-motion` sul <body> (le animazioni CSS). La scelta
   sta in localStorage (`we_animations`), è di chi guarda.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';

const KEY = 'we_animations';
let _on = true;
try { _on = localStorage.getItem(KEY) !== 'off'; } catch { /* storage bloccato: accese */ }

export function animationsOn() {
  return _on;
}

export function setAnimationsOn(on) {
  _on = Boolean(on);
  try { localStorage.setItem(KEY, _on ? 'on' : 'off'); } catch { /* idem */ }
  document.body?.classList.toggle('wp-no-motion', !_on);
  window.dispatchEvent(new CustomEvent('wareraplus:motionchange', { detail: { on: _on } }));
}

/** Collega l'interruttore delle Impostazioni (index.html: #wp-checkAnimations,
 *  rispecchiato dalle due barre menù come gli altri switch). */
export function initMotion() {
  document.body?.classList.toggle('wp-no-motion', !_on);
  const cb = document.getElementById('wp-checkAnimations');
  if (!cb) return;
  cb.checked = _on;
  cb.addEventListener('change', () => setAnimationsOn(cb.checked));
  // Al cambio la mappa si ridisegna: ogni sovrapposizione animata (frecce,
  // battito, fili…) si risincronizza in renderMap e parte o si ferma.
  window.addEventListener('wareraplus:motionchange', () => {
    import('../diplomacy/map.js').then(m => m.renderMap()).catch(() => {});
    Promise.all([import('../diplomacy/oceanBackground.js'), import('../diplomacy/antiqueTheme.js')])
      .then(([dark, light]) => {
        // Le navi ripartono solo se la mappa principale si vede: con la time
        // machine aperta le ha già fermate lei, e le rimette lei.
        if (_on && !state.timeMachineActive) { dark.resumeShipAnimation(); light.resumeShipAnimation(); }
        else if (!_on) { dark.pauseShipAnimation(); light.pauseShipAnimation(); }
      }).catch(() => {});
  });
}
