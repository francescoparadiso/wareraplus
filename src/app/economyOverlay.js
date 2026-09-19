/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Economia
   ------------------------------------------------------------------
   Prende il posto di DUE overlay che c'erano prima, `ecoOverlay.js`
   (Ottimizzatore industriale) e `marketOverlay.js` (Rendite di
   produzione): erano due voci di menù per tre domande che si fanno
   una dietro l'altra. Il perché sta in testa a `src/economy/main.js`.

   Stessa meccanica degli altri overlay di "Approfondimenti": la vista
   vera arriva con un `import()` dinamico alla prima apertura, poi il
   DOM montato dentro `#wp-economy-root` viene riusato.

   ⚠️ Come le Rendite di prima, questa sezione tiene dei TIMER (i prezzi
   si rinfrescano ogni cinque minuti mentre è aperta), quindi la
   chiusura non può limitarsi a nascondere l'overlay: `stopEconomyView()`
   li ferma TUTTI, anche quelli delle schede lasciate indietro. Il
   riferimento si tiene qui dopo il primo import, così la chiusura non
   deve reimportare il modulo.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

let overlayEl, backBtn, rootEl;
let stopAll = null;

export function initEconomyOverlay() {
  overlayEl = document.getElementById('wp-economy-overlay');
  backBtn = document.getElementById('wp-economy-back');
  rootEl = document.getElementById('wp-economy-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeEconomyView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeEconomyView();
  });
}

/**
 * @param {{ tab?: 'prices'|'yields'|'optimizer' }} opts la scheda da
 *   aprire. Le voci di menù la passano, così "Ottimizzatore industriale"
 *   continua a portare dove portava prima invece di far cercare la
 *   linguetta giusta a chi conosceva la vecchia voce.
 */
export async function openEconomyView({ tab } = {}) {
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  // Dopo .open: a overlay nascosto il canvas misurerebbe 0x0.
  enterOverlay(overlayEl, 'eco');

  await withModuleLoading('eco', async () => {
    const mod = await loadModule(() => import('../economy/main.js'), 'economy');
    stopAll = mod.stopEconomyView;
    await mod.initEconomyView(rootEl, { tab });
  });

  trackEvent('economy-open');
}

export function closeEconomyView() {
  // Prima si fermano i giri, poi si chiude: al contrario resterebbero
  // timer accesi dietro un overlay invisibile.
  if (stopAll) stopAll();
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
}

export function isEconomyViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
