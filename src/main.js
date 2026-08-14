/* ══════════════════════════════════════════════════════════════
   WarEra+ — entry point
   ------------------------------------------------------------------
   1) Importa il main.js di Diplomacy View: si auto-avvia (init())
      esattamente come nel tool originale — nessuna modifica al
      comportamento, solo un import diverso da come veniva caricato
      prima (script tag → modulo ES).
   2) Inizializza i componenti NUOVI di WarEra+ (pannello nazione,
      overlay Political View, i18n, sync tema), agganciandosi
      all'evento 'wareraplus:diplomacy-ready' aggiunto in
      diplomacy/main.js.
   3) Gestisce il deep-link ?country=<id> in ingresso all'app: apre
      il pannello nazione (e centra la mappa) al primo caricamento.
   ══════════════════════════════════════════════════════════════ */

import './diplomacy/main.js';

// Vercel Web Analytics — conteggio visite/pageview lato Vercel, nessun
// backend/config nostro. `inject()` è la versione framework-agnostic del
// pacchetto (l'onboarding di Vercel mostra di default lo snippet
// @vercel/analytics/next per Next.js, non applicabile qui: questo progetto
// è Vite puro — vedi https://vercel.com/docs/analytics/quickstart).
import { inject } from '@vercel/analytics';
inject();

import { initCountryPanel, selectNationInPanel } from './panel/countryPanel.js';
import { initPoliticalOverlay } from './app/politicalOverlay.js';
import { initThemeSync } from './app/themeSync.js';
import { initLangSync } from './app/langSync.js';
import { initBattleToggle } from './app/battleToggle.js';
import { initBlocLabelsToggle } from './app/blocLabelsToggle.js';
import { startNewsTicker } from './app/newsTicker.js';
import { initTimeMachine } from './app/timeMachine.js';
import { applyTranslations, initLangButton } from './shared/i18n.js';
import { updateDynamicLegend } from './diplomacy/ui.js';
import { state } from './diplomacy/state.js';

function handleIncomingDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const countryId = params.get('country');
  if (!countryId) return;

  selectNationInPanel(countryId);

  // Centra la mappa sulla nazione, riusando gli stessi dati (label
  // coordinates) che 'cercaNazione()' usa internamente in map.js —
  // letti qui direttamente da state, senza toccare map.js.
  const label = state.labelsData.find(l => l.properties?.countryId === countryId);
  if (label && state.map) {
    state.map.flyTo({ center: label.coordinates, zoom: Math.max(state.map.getZoom(), 3) });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initPoliticalOverlay();
  applyTranslations();
  initLangButton();
});

// Ri-applica le traduzioni e ridisegna la legenda dinamica (che ora usa
// t()) ogni volta che la lingua cambia.
window.addEventListener('wareraplus:langchange', () => {
  applyTranslations();
  if (state.map) updateDynamicLegend();
});

window.addEventListener('wareraplus:diplomacy-ready', () => {
  initCountryPanel();
  initThemeSync();
  initLangSync();
  initBattleToggle();
  initBlocLabelsToggle();
  startNewsTicker();
  initTimeMachine();
  handleIncomingDeepLink();
}, { once: true });
