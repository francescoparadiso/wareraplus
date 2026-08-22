/* ══════════════════════════════════════════════════════════════
   WarEra+ — Sospensione del lavoro di sfondo della mappa
   ------------------------------------------------------------------
   Gli overlay a schermo intero (Political, e in futuro gli altri) sono
   `position: fixed; inset: 0` SOPRA la mappa: la mappa non è mai
   `display:none`, quindi tutto il suo lavoro periodico continua a
   girare invisibile sotto l'overlay. Due voci contano davvero:

   1. Il pallino "nave" delle rotte oceaniche (oceanRoutes.js: makeRunner)
      chiama `source.setData(...)` ogni 1500ms, e OGNI setData forza un
      repaint WebGL di MapLibre, che a sua volta trascina `drawLabels`
      (labels.js, agganciata a `map.on('render')`). Puramente decorativo:
      fermarlo mentre nessuno guarda la mappa non perde nulla — è lo
      stesso ragionamento (e le stesse funzioni) già usato da
      src/app/timeMachine.js quando nasconde la mappa principale.
   2. Il polling dei marker battaglia ogni 30s (diplomacy/main.js):
      richieste di rete i cui risultati nessuno sta vedendo. Alla ripresa
      si fa subito un giro di aggiornamento, così i marker non restano
      fermi ai dati di quando l'overlay è stato aperto.

   Gemello concettuale di pausePoliticalRendering/resumePoliticalRendering
   in src/political/main.js — lì si ferma il canvas particellare quando
   l'overlay si chiude, qui si ferma la mappa quando l'overlay si apre.

   Contatore invece di un booleano: se più overlay si sovrappongono, la
   mappa riparte solo quando l'ULTIMO si chiude.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { pauseShipAnimation as pauseShipsDark, resumeShipAnimation as resumeShipsDark } from '../diplomacy/oceanBackground.js';
import { pauseShipAnimation as pauseShipsAntique, resumeShipAnimation as resumeShipsAntique } from '../diplomacy/antiqueTheme.js';
import { pauseBattleMarkersPolling, resumeBattleMarkersPolling } from '../diplomacy/main.js';
import { drawLabels, resizeLabelCanvas } from '../diplomacy/labels.js';

let _depth = 0;

/** Da chiamare quando un overlay full-screen copre la mappa. */
export function pauseMapBackgroundWork() {
  _depth++;
  if (_depth > 1) return;
  // Solo uno dei due temi ha un runner attivo: l'altra chiamata è un no-op.
  pauseShipsDark();
  pauseShipsAntique();
  pauseBattleMarkersPolling();
}

/** Da chiamare quando l'overlay si chiude e la mappa torna visibile. */
export function resumeMapBackgroundWork() {
  if (_depth === 0) return;   // resume senza pause: niente da ripristinare
  _depth--;
  if (_depth > 0) return;
  // La time machine tiene la mappa principale nascosta dietro la sua e ha
  // già fermato i pallini nave per conto suo: riavviarli qui li lascerebbe
  // accesi sotto una mappa che nessuno vede, e la sua _deactivate() non
  // saprebbe di doverli rifermare.
  if (!state.timeMachineActive) {
    resumeShipsDark();
    resumeShipsAntique();
  }
  resumeBattleMarkersPolling();

  // BUG FIX (mobile): stessa causa del ridisegno su 'idle'/'visibilitychange'
  // in labels.js — i nomi di nazioni e alleanze stanno su un canvas 2D a
  // parte, ridisegnato solo quando la mappa fa 'render'. Sotto un overlay
  // aperto a lungo non parte nessun render (i pallini nave sono in pausa
  // proprio qui sopra) e il compositore, su telefono, butta via il buffer
  // del canvas: alla chiusura dell'overlay la mappa ricompare senza nomi,
  // finché non si fa pan/zoom. Un resize + ridisegno alla ripresa lo
  // rimette a posto; il resize serve anche perché il viewport può essere
  // cambiato sotto l'overlay (rotazione, barra URL del browser mobile).
  if (state.map && !state.timeMachineActive) {
    resizeLabelCanvas();
    state.map.triggerRepaint();
    drawLabels();
  }
}
