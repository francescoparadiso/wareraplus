/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Battaglie (archivio + spese di guerra)
   ------------------------------------------------------------------
   Stessa meccanica degli altri overlay di "Approfondimenti" (vedi
   marketOverlay.js): la vista vera (src/battles/main.js) arriva con un
   import() dinamico alla PRIMA apertura, poi il DOM montato dentro
   #wp-battles-root viene riusato.

   Come Rendite (marketOverlay.js), alla chiusura c'è un timer da
   fermare: da quando l'archivio mostra anche le battaglie IN CORSO, la
   vista si riaggiorna da sola ogni quattro minuti. Dietro una mappa
   chiusa quel giro sarebbe consumo puro, quindi si spegne qui — la vista
   non sa da sola quando smette di essere guardata.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

let overlayEl, backBtn, rootEl;
// Modulo della vista, tenuto da parte alla prima apertura: serve alla
// chiusura per fermare il giro delle battaglie in corso. Un `import()`
// dentro closeBattlesView scaricherebbe il chunk anche a chi non ha mai
// aperto la vista, cioè il contrario del code-split.
let viewMod = null;

export function initBattlesOverlay() {
  overlayEl = document.getElementById('wp-battles-overlay');
  backBtn = document.getElementById('wp-battles-back');
  rootEl = document.getElementById('wp-battles-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeBattlesView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeBattlesView();
  });
}

export async function openBattlesView() {
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  // Dopo .open: a overlay nascosto il canvas misurerebbe 0x0.
  enterOverlay(overlayEl, 'battles');

  await withModuleLoading('battles', async () => {
    viewMod = await loadModule(() => import('../battles/main.js'), 'battles');
    await viewMod.initBattlesView(rootEl);
  });

  trackEvent('battles-overlay-open');
}

export function closeBattlesView() {
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
  viewMod?.stopBattlesAutoRefresh?.();
}

export function isBattlesViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
