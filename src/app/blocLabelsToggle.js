/* ══════════════════════════════════════════════════════════════
   WarEra+ — Toggle nomi alleanze
   ------------------------------------------------------------------
   Componente NUOVO. Stesso meccanismo già usato dal toggle esistente
   'Show Nation Names' (#checkLabels, in diplomacy/main.js): basta
   aggiornare lo stato e forzare un repaint della mappa, che ridisegna
   le etichette leggendo state.showBlocLabels (vedi labels.js).
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';

export function initBlocLabelsToggle() {
  const checkbox = document.getElementById('wp-checkBlocLabels');
  if (!checkbox) return;
  checkbox.checked = state.showBlocLabels;
  checkbox.addEventListener('change', () => {
    state.showBlocLabels = checkbox.checked;
    if (state.map) state.map.triggerRepaint();
  });
}
