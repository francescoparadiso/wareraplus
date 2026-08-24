/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Unità Militari
   ------------------------------------------------------------------
   Stessa meccanica degli overlay Political / Eco / News
   (politicalOverlay.js, ecoOverlay.js, newsOverlay.js): full-screen
   sopra la mappa, aperto da "Approfondimenti → Unità Militari". La vista
   vera (src/mu/main.js) si carica via import() dinamico alla PRIMA
   apertura, così il suo chunk non pesa sul boot. Riaperture successive
   riusano il DOM montato dentro #wp-mu-root e non riscaricano la
   directory (sta in memoria in src/mu/api.js).
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

let overlayEl, backBtn, rootEl;

export function initMuOverlay() {
  overlayEl = document.getElementById('wp-mu-overlay');
  backBtn = document.getElementById('wp-mu-back-btn');
  rootEl = document.getElementById('wp-mu-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeMuView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeMuView();
  });
}

/** Apre la vista. Con `muId` salta direttamente alla scheda di
 *  quell'unità (preferiti, ricerca globale della barra menù). */
export async function openMuView(muId) {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  // Sfondo a particelle nella tinta della sezione + pausa del lavoro
  // di sfondo della mappa, che resta montata sotto l'overlay.
  // Dopo .open: a overlay nascosto il canvas misurerebbe 0x0.
  enterOverlay(overlayEl, 'mu');

  // Schermata di attesa su chunk + directory (shared/loadingScreen.js):
  // la prima apertura scarica ~550 KB di elenco unità, non è istantanea.
  await withModuleLoading('mu', async () => {
    const mod = await loadModule(() => import('../mu/main.js'), 'mu');
    if (muId) mod.openMuDetail(muId);
    await mod.initMuView(rootEl);
  });

  trackEvent('mu-open', { deepLink: !!muId });
}

export function closeMuView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
}

export function isMuViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
