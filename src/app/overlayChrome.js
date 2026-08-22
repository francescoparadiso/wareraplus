/* ══════════════════════════════════════════════════════════════
   WarEra+ — Chrome condiviso degli overlay di "Approfondimenti"
   ------------------------------------------------------------------
   Eco, Unità Militari, News e Statistiche alleanze hanno la stessa
   apertura/chiusura: sfondo
   a particelle nella tinta della sezione (src/shared/particlesBackground.js,
   lo stesso motore dello sfondo storico di Political) e pausa del lavoro
   di sfondo della mappa, che resta montata sotto l'overlay (mapIdle.js).
   Prima ognuno dei tre lo faceva a modo suo (cioè: non lo faceva), da
   cui la disomogeneità grafica che questo file elimina.

   Political NON passa da qui: ha il proprio canvas dentro il template
   della vista (#bgCanvas) ed è già agganciato a
   pausePoliticalRendering/resumePoliticalRendering — vedi
   politicalOverlay.js.

   Le tinte sono le stesse dichiarate come --wp-ov-accent in shell.css:
   se ne cambi una, cambiala in tutti e due i posti.
   ══════════════════════════════════════════════════════════════ */

import { startParticles } from '../shared/particlesBackground.js';
import { pauseMapBackgroundWork, resumeMapBackgroundWork } from './mapIdle.js';

/* Due tinte per sezione, non una: ogni nodo pesca la propria posizione
   sulla rampa fra le due (vedi particlesBackground.js), così il campo
   sfuma invece di essere monocromo. La PRIMA tinta è quella dichiarata
   come --wp-ov-accent in shell.css e usata dal chrome (filo della
   topbar, pallino del titolo, hover): se ne cambi una, cambiala in tutti
   e due i posti. La seconda vive solo qui. */
export const OVERLAY_TINTS = {
  // verde → verde acqua
  eco:      { rgbDark: '63,185,80',   rgbDark2: '57,208,216',
              rgbLight: '26,127,55',  rgbLight2: '17,138,144' },
  // rosso → arancio
  mu:       { rgbDark: '229,72,77',   rgbDark2: '240,136,62',
              rgbLight: '176,32,38',  rgbLight2: '181,96,25' },
  // blu → ciano
  news:     { rgbDark: '88,166,255',  rgbDark2: '57,208,216',
              rgbLight: '26,96,182',  rgbLight2: '17,138,144' },
  // viola → rosa
  alliance: { rgbDark: '163,113,247', rgbDark2: '247,120,186',
              rgbLight: '110,66,193', rgbLight2: '183,52,124' },
  // ambra → oro pallido (Guida: tinta propria, distinta dall'oro di Political)
  guide:    { rgbDark: '210,153,34',  rgbDark2: '240,136,62',
              rgbLight: '154,103,0',  rgbLight2: '181,96,25' },
  // ciano → verde acqua
  nations:  { rgbDark: '57,208,216',  rgbDark2: '63,185,80',
              rgbLight: '17,138,144', rgbLight2: '26,127,55' },
};

const _stoppers = new WeakMap();

/**
 * Da chiamare quando l'overlay diventa visibile (dopo aver aggiunto la
 * classe .open: il canvas si misura sul proprio box, che a overlay
 * nascosto sarebbe 0x0).
 * @param {HTMLElement} overlayEl
 * @param {keyof typeof OVERLAY_TINTS} tint
 */
export function enterOverlay(overlayEl, tint) {
  if (!overlayEl || _stoppers.has(overlayEl)) return;   // già aperto
  const canvas = overlayEl.querySelector('.wp-overlay-bg');
  const stop = canvas ? startParticles(canvas, OVERLAY_TINTS[tint] || {}) : () => {};
  _stoppers.set(overlayEl, stop);
  pauseMapBackgroundWork();
}

/** Simmetrica: ferma il loop delle particelle e fa ripartire la mappa. */
export function leaveOverlay(overlayEl) {
  if (!overlayEl) return;
  const stop = _stoppers.get(overlayEl);
  if (!stop) return;   // non era aperto: niente da fermare
  stop();
  _stoppers.delete(overlayEl);
  resumeMapBackgroundWork();
}
