/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: sfondo animato canvas (Fase 2, Stage 5)
   ------------------------------------------------------------------
   Conversione dell'IIFE inline a fine <body> di public/political/index.html
   (canvas#bgCanvas, particelle connesse). Comportamento invariato,
   solo avviata esplicitamente da src/political/main.js dopo il mount
   del template (Stage 8) invece che auto-eseguita al parse dello
   script inline.

   Il motore vero è ora in src/shared/particlesBackground.js, condiviso
   con gli altri overlay di "Approfondimenti" (Eco, Unità Militari,
   News), ognuno con la propria tinta — qui l'oro storico di Political.
   Tutte le ottimizzazioni di CPU nate su questo canvas (glow
   prerenderizzato, ~30fps, stop mentre `document.hidden`) sono descritte
   in quel file; le due patologie che le hanno rese necessarie erano:

   1. `closePoliticalView()` (politicalOverlay.js) nascondeva l'overlay
      solo via CSS, senza mai chiamare la funzione di stop — il loop
      restava quindi acceso PER SEMPRE dopo la prima apertura di
      Political View, anche tornati sulla mappa. Fix in main.js
      (pausePoliticalRendering/resumePoliticalRendering).
   2. Ogni frame ricreava un `ctx.createRadialGradient(...)` NUOVO per
      OGNUNO dei 60 nodi (~3600 gradienti/sec) solo per il "glow".

   `initBackgroundCanvas()` ritorna la funzione di cleanup: ogni chiamata
   avvia un nuovo loop, quindi chi la richiama (riapertura della vista)
   deve fermare il precedente.
   ══════════════════════════════════════════════════════════════ */

import { startParticles } from '../shared/particlesBackground.js';

export function initBackgroundCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return () => {};
  return startParticles(canvas, {
    // Due tinte come le altre sezioni (vedi OVERLAY_TINTS in
    // src/app/overlayChrome.js): oro scuro → oro chiaro, gli stessi due
    // già usati dai gradienti di Political (--gold / --gold2).
    rgbDark: '197,150,74',
    rgbDark2: '232,201,122',
    rgbLight: '130,95,38',
    rgbLight2: '168,128,60',
    // Political ha il proprio interruttore di tema (data-theme sull'<html>,
    // vedi src/political/config.js: applyTheme) — non body.light-theme.
    isLight: () => document.documentElement.getAttribute('data-theme') === 'light',
  });
}
