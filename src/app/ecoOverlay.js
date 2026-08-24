/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Ottimizzatore industriale
   ------------------------------------------------------------------
   Stessa meccanica dell'overlay Political (src/app/politicalOverlay.js):
   un overlay full-screen sopra la mappa, aperto da "Approfondimenti →
   Ottimizzatore industriale". La vista vera (src/eco/main.js) si carica via
   import() dinamico alla PRIMA apertura, così il suo chunk (+ il layer eco)
   non pesa sul boot dell'app. Idempotente: riaperture successive riusano il
   DOM già montato dentro #wp-eco-root.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

let overlayEl, backBtn, rootEl;

export function initEcoOverlay() {
  overlayEl = document.getElementById('wp-eco-overlay');
  backBtn = document.getElementById('wp-eco-back');
  rootEl = document.getElementById('wp-eco-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeEcoView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeEcoView();
  });
}

export async function openEcoView() {
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  // Sfondo a particelle nella tinta della sezione + pausa del lavoro
  // di sfondo della mappa, che resta montata sotto l'overlay.
  // Dopo .open: a overlay nascosto il canvas misurerebbe 0x0.
  enterOverlay(overlayEl, 'eco');

  await withModuleLoading('eco', async () => {
    const { initEcoView } = await loadModule(() => import('../eco/main.js'), 'eco');
    initEcoView(rootEl);
  });

  trackEvent('eco-open');
}

export function closeEcoView() {
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
}

export function isEcoViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
