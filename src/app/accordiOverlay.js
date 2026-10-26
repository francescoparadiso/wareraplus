/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Accordi (patti di non belligeranza)
   ------------------------------------------------------------------
   Stessa meccanica degli altri overlay di "Approfondimenti" (vedi
   battlesOverlay.js): la vista vera (src/accordi/main.js) arriva con un
   import() dinamico alla PRIMA apertura, poi il DOM montato dentro
   #wp-accordi-root viene riusato.

   Gli accordi in vigore stanno sulla mappa anche senza aprire questa
   vista: quelli li porta src/diplomacy/accordiNaps.js, caricato al boot.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';
import { pushBack, dropBack } from './backNav.js';

let overlayEl, backBtn, rootEl;

export function initAccordiOverlay() {
  overlayEl = document.getElementById('wp-accordi-overlay');
  backBtn = document.getElementById('wp-accordi-back');
  rootEl = document.getElementById('wp-accordi-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeAccordiView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeAccordiView();
  });
}

export async function openAccordiView() {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  enterOverlay(overlayEl, 'accordi');
  // Indietro del browser/telefono = closeAccordiView (vedi backNav.js).
  pushBack('accordi', closeAccordiView, isAccordiViewOpen, { section: 'accordi' });

  await withModuleLoading('accordi', async () => {
    const mod = await loadModule(() => import('../accordi/main.js'), 'accordi');
    await mod.initAccordiView(rootEl);
  });

  trackEvent('accordi-overlay-open');
}

export function closeAccordiView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
  dropBack('accordi');
}

export function isAccordiViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
