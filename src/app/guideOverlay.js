/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Guida ("Come si usa")
   ------------------------------------------------------------------
   Stessa meccanica degli overlay Political / Eco / News / Unità
   Militari / Statistiche nazioni: full-screen sopra la mappa, aperto
   da "Approfondimenti → Come si usa". La vista (src/guide/main.js)
   arriva con un import() dinamico alla prima apertura — è testo
   statico, ma sono anche nove lingue: non deve stare nel bundle di boot.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

let overlayEl, backBtn, rootEl;

export function initGuideOverlay() {
  overlayEl = document.getElementById('wp-guide-overlay');
  backBtn = document.getElementById('wp-guide-back');
  rootEl = document.getElementById('wp-guide-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeGuideView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeGuideView();
  });
}

export async function openGuideView() {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  enterOverlay(overlayEl, 'guide');

  await withModuleLoading('guide', async () => {
    const mod = await loadModule(() => import('../guide/main.js'), 'guide');
    mod.initGuideView(rootEl);
  });

  trackEvent('guide-view-open');
}

export function closeGuideView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
}

export function isGuideViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
