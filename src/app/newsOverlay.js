/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay News
   ------------------------------------------------------------------
   Stessa meccanica degli overlay Political ed Eco (politicalOverlay.js /
   ecoOverlay.js): full-screen sopra la mappa, aperto da
   "Approfondimenti → News". La vista vera (src/app/newsView.js) si carica
   via import() dinamico alla PRIMA apertura, così non pesa sul boot.
   Riaperture successive riusano il DOM già montato dentro #wp-news-root,
   ma ricaricano i contenuti (initNewsView è idempotente e ridisegna).
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

let overlayEl, backBtn, rootEl;

export function initNewsOverlay() {
  overlayEl = document.getElementById('wp-news-overlay');
  backBtn = document.getElementById('wp-news-back');
  rootEl = document.getElementById('wp-news-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeNewsView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeNewsView();
  });
}

export async function openNewsView() {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  // Sfondo a particelle nella tinta della sezione + pausa del lavoro
  // di sfondo della mappa, che resta montata sotto l'overlay.
  // Dopo .open: a overlay nascosto il canvas misurerebbe 0x0.
  enterOverlay(overlayEl, 'news');

  const { initNewsView } = await loadModule(() => import('./newsView.js'), 'news');
  await initNewsView(rootEl);

  trackEvent('news-open');
}

export function closeNewsView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
}

export function isNewsViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
