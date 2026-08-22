/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Statistiche nazioni
   ------------------------------------------------------------------
   Stessa meccanica degli overlay Political / Eco / News / Unità Militari:
   full-screen sopra la mappa, aperto da "Approfondimenti → Statistiche
   nazioni". La vista vera (src/nations/main.js) si carica via import()
   dinamico alla PRIMA apertura, così il suo chunk non pesa sul boot.
   Riaperture successive riusano il DOM montato dentro #wp-nations-root.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

let overlayEl, backBtn, rootEl;

export function initNationsOverlay() {
  overlayEl = document.getElementById('wp-nations-overlay');
  backBtn = document.getElementById('wp-nations-back');
  rootEl = document.getElementById('wp-nations-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeNationsView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeNationsView();
  });
}

/** Con `countryId` apre direttamente la scheda di quella nazione. */
export async function openNationsView(countryId) {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  // Sfondo a particelle nella tinta della sezione + pausa del lavoro di
  // sfondo della mappa, che resta montata sotto l'overlay.
  enterOverlay(overlayEl, 'nations');

  const mod = await import('../nations/main.js');
  if (countryId) mod.openNationDetail(countryId);
  await mod.initNationsView(rootEl);

  trackEvent('nations-view-open', { deepLink: !!countryId });
}

export function closeNationsView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
}

export function isNationsViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
