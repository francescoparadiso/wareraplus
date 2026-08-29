/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Rendite di produzione
   ------------------------------------------------------------------
   Stessa meccanica degli altri overlay di "Approfondimenti" (vedi
   ecoOverlay.js): la vista vera (src/market/main.js) arriva con un
   import() dinamico alla PRIMA apertura, poi il DOM montato dentro
   #wp-market-root viene riusato.

   UNA DIFFERENZA che vale la pena conoscere: questa vista tiene un
   timer (rinfresca i prezzi ogni 5 minuti mentre è aperta), quindi la
   chiusura non può limitarsi a nascondere l'overlay — deve fermarlo.
   Il riferimento alla funzione di stop si tiene qui dopo il primo
   import, così `closeMarketView()` non deve reimportare il modulo.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

let overlayEl, backBtn, rootEl;
let stopAutoRefresh = null;

export function initMarketOverlay() {
  overlayEl = document.getElementById('wp-market-overlay');
  backBtn = document.getElementById('wp-market-back');
  rootEl = document.getElementById('wp-market-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeMarketView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeMarketView();
  });
}

export async function openMarketView() {
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  // Dopo .open: a overlay nascosto il canvas misurerebbe 0x0.
  enterOverlay(overlayEl, 'market');

  await withModuleLoading('market', async () => {
    const mod = await loadModule(() => import('../market/main.js'), 'market');
    stopAutoRefresh = mod.stopMarketAutoRefresh;
    await mod.initMarketView(rootEl);
  });

  trackEvent('market-overlay-open');
}

export function closeMarketView() {
  // Prima si ferma il rinfresco, poi si chiude: al contrario resterebbe
  // un timer acceso dietro un overlay invisibile.
  if (stopAutoRefresh) stopAutoRefresh();
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
}

export function isMarketViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
