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
// WarEra+ dev: solo sul deploy live. Su un preview (branch `dev`) le
// prove finirebbero mescolate ai visitatori veri — vedi
// src/shared/deployEnv.js.
import { IS_LIVE, initDeployBadge } from './shared/deployEnv.js';
import { inject } from '@vercel/analytics';
// WarEra+ sfondo: neanche dentro lo sfondo di Wallpaper Engine, che si
// ricarica a ogni avvio del PC (vedi src/shared/wallpaper.js).
import { IS_WALLPAPER } from './shared/wallpaper.js';
if (IS_LIVE && !IS_WALLPAPER) inject();

// Umami: era un tag statico in index.html, ora si carica da qui (e solo
// in live) per lo stesso motivo.
import { initAnalytics } from './shared/analytics.js';
initAnalytics();

import { initCountryPanel, selectNationInPanel, selectBlocInPanel, selectSphereInPanel, hasViewOverviewMode, isViewOverviewOpen, isSphereOverviewOpen } from './panel/countryPanel.js';
import { initPoliticalOverlay, openPoliticalView } from './app/politicalOverlay.js';
import { initEconomyOverlay, openEconomyView } from './app/economyOverlay.js';
import { initNewsOverlay, openNewsView } from './app/newsOverlay.js';
import { initMuOverlay, openMuView } from './app/muOverlay.js';
import { initNationsOverlay, openNationsView } from './app/nationsOverlay.js';
import { initPlayersOverlay, openPlayersView } from './app/playersOverlay.js';
import { initBattlesOverlay, openBattlesView } from './app/battlesOverlay.js';
import { initGuideOverlay, openGuideView } from './app/guideOverlay.js';
import { initPrivateOverlay, openPrivateView } from './app/privateOverlay.js';
import { takeReloadIntent } from './shared/lazyModule.js';
// WarEra+: il tasto Indietro chiude la cosa aperta invece di uscire dal
// tool. Il listener va messo subito, prima di qualunque deep-link.
import { initBackNav, startUrlSync, updateBackParams } from './app/backNav.js';
initBackNav({ enabled: !IS_WALLPAPER });
import { initThemeSync } from './app/themeSync.js';
import { initLangSync } from './app/langSync.js';
import { initBattleToggle } from './app/battleToggle.js';
import { initBlocLabelsToggle } from './app/blocLabelsToggle.js';
import { initDesktopMenuBar } from './app/desktopMenuBar.js';
import { initMobileMenuBar } from './app/mobileMenuBar.js';
import { startNewsTicker } from './app/newsTicker.js';
import { initTimeMachine, openTimeMachineAt } from './app/timeMachine.js';
import { initAuthorPill } from './app/authorPill.js';
import { initVisitorCounter } from './app/visitorCounter.js';
// WarEra+ sfondo Wallpaper Engine: chiave API e listener delle proprietà
// partono subito (la chiave deve arrivare prima delle prime chiamate), il
// resto a mappa pronta. Vedi src/app/wallpaperMode.js.
import { initWallpaperEarly, startWallpaperMode } from './app/wallpaperMode.js';
if (IS_WALLPAPER) initWallpaperEarly();
// WarEra+: interruttore unico delle animazioni (Impostazioni)
import { initMotion } from './shared/motion.js';
// WarEra+: numeri che contano e grafici che si disegnano (un osservatore solo)
import { initReveal } from './shared/reveal.js';
import { applyTranslations, initLangButton } from './shared/i18n.js';
import { updateDynamicLegend } from './diplomacy/ui.js';
import { state } from './diplomacy/state.js';

/* ══════════════════════════════════════════════════════════════
   Link condivisibili in ingresso
   ------------------------------------------------------------------
   Rilegge l'indirizzo che src/app/backNav.js scrive mentre si naviga e
   riapre le stesse cose, nello stesso ordine della pila: vista mappa →
   selezione del pannello (nazione / alleanza / sfera) → battaglia →
   sezione con la sua scheda. ?country= e ?tm= sono i due link storici e
   restano identici (girano negli articoli).
   ⚠️ Dentro lo sfondo di Wallpaper Engine valgono SOLO quei due: lo sfondo
   usa l'URL per le sue proprietà (`view`, `focus`…, wallpaperMode.js).
   Alla fine startUrlSync(): da lì in poi l'URL segue la navigazione.
   ══════════════════════════════════════════════════════════════ */
const nextTick = () => new Promise(r => setTimeout(r, 0));

/** Cambiare vista apre il suo riepilogo nel pannello con un import()
 *  asincrono (map.js:setColoringMode): una selezione fatta prima ci
 *  finirebbe sotto. Si aspetta che il riepilogo ci sia (max ~1 s). */
async function switchMapView(mode) {
  document.getElementById(`mode-${mode}`)?.click();
  const hasOverview = mode === 'sphereOfInfluence' || hasViewOverviewMode(mode);
  // Limite in tempo VERO, non in giri: in una scheda aperta in background
  // (Ctrl+clic da Discord) il browser stira ogni setTimeout fino a 1 s o
  // più, e 40 giri da 25 ms diventerebbero minuti.
  const deadline = Date.now() + 1000;
  while (hasOverview && !isViewOverviewOpen() && !isSphereOverviewOpen() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 25));
  }
  await nextTick();
}

async function handleIncomingDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const full = !IS_WALLPAPER;
  const section = full ? params.get('section') : null;
  const countryId = params.get('country');

  // 1) Vista mappa: dallo stesso bottone che userebbe l'utente (entra
  //    nelle viste che hanno un enter*, aggiorna cursori e menù). Prima di
  //    tutto: cambiare vista riapre/richiude il pannello di riepilogo, in
  //    modo asincrono — da qui il nextTick prima di toccare il pannello.
  const map = full ? params.get('map') : null;
  // Le viste che mettono a fuoco una nazione DENTRO la vista invece di
  // aprirne il pannello (Migrazioni, Finanziamenti) e Distanze: finestra e
  // partenza si impostano PRIMA di entrare (il primo caricamento le usa
  // già), il fuoco DOPO, con lo stesso clic che farebbe l'utente.
  const focus = full ? params.get('focus') : null;
  const days = full && params.has('days') ? Number(params.get('days')) : null;
  let focusView = null;
  let travelView = null;
  if (map === 'migration') {
    focusView = await import('./diplomacy/migrationFlows.js');
    if (focusView.MIGRATION_DAYS.includes(days)) focusView.mig().days = days;
  } else if (map === 'funding') {
    focusView = await import('./diplomacy/fundingFlows.js');
    if (focusView.FUNDING_DAYS.includes(days)) focusView.fund().days = days;
  } else if (map === 'travel' && params.get('region')) {
    travelView = await import('./diplomacy/travelDistance.js');
    travelView.setTravelOrigin(params.get('region'));
  }
  if (map && map !== 'diplomacy') await switchMapView(map);
  // La partenza EFFETTIVA (se quella del link non esiste, la vista ripiega
  // su casa o capitale): la vista la scrive da sé solo dopo un clic.
  if (travelView) updateBackParams('mapview', { region: travelView.getTravelOrigin() || undefined });
  if (focus && state.nationMap?.has(focus)) {
    if (map === 'migration') focusView.onMigrationCountryClick(focus);
    else if (map === 'funding') focusView.onFundingCountryClick(focus);
  }

  // 2) Selezione del pannello. Con ?section=political la nazione è quella
  //    di Political, che copre tutto: il pannello sotto non si apre.
  const allianceId = full ? params.get('alliance') : null;
  const sphereId = full ? params.get('sphere') : null;
  if (allianceId) {
    if (state.coloringMode !== 'blocs') await switchMapView('blocs');
    state.selectedBlocId = allianceId;
    const { renderMap } = await import('./diplomacy/map.js');
    renderMap();
    const bloc = state.externalBlocsInfo?.find(b => b.id === allianceId);
    if (bloc && bloc.labelLng != null && state.map) state.map.flyTo({ center: [bloc.labelLng, bloc.labelLat], zoom: Math.max(state.map.getZoom(), 3) });
    selectBlocInPanel(allianceId);
  } else if (sphereId) {
    if (state.coloringMode !== 'sphereOfInfluence') await switchMapView('sphereOfInfluence');
    selectSphereInPanel(sphereId);
  } else if (countryId && section !== 'political') {
    selectNationInPanel(countryId);

    // Centra la mappa sulla nazione, riusando gli stessi dati (label
    // coordinates) che 'cercaNazione()' usa internamente in map.js —
    // letti qui direttamente da state, senza toccare map.js.
    const label = state.labelsData.find(l => l.properties?.countryId === countryId);
    if (label && state.map) {
      state.map.flyTo({ center: label.coordinates, zoom: Math.max(state.map.getZoom(), 3) });
    }
  }

  // 3) Battaglia in corso sulla mappa (senza sezione: con ?section=battles
  //    lo stesso id è la scheda dell'archivio). Non si aspetta: i marker
  //    arrivano col loro giro, e quando la battaglia si apre l'URL la
  //    riprende da sé.
  const battleId = full ? params.get('battle') : null;
  if (battleId && section !== 'battles') {
    import('./diplomacy/battleMarkers.js').then(m => m.openBattleById(battleId)).catch(() => {});
  }

  // 4) Sezione, con la sua scheda.
  const open = {
    political: () => openPoliticalView(countryId || undefined,
      (countryId && state.nationMap?.get(countryId)?.name) || '',
      { openSenate: params.get('senate') === '1' }),
    economy: async () => {
      const item = params.get('item');
      if (item) (await import('./economy/prices.js')).openPriceItem(item);
      return openEconomyView({ tab: item ? 'prices' : (params.get('tab') || undefined) });
    },
    news: () => openNewsView(),
    mu: () => openMuView(params.get('mu') || undefined,
      { tab: params.get('tab'), a: params.get('mua'), b: params.get('mub') }),
    nations: () => openNationsView(params.get('nation') || undefined),
    players: () => openPlayersView(params.get('player') || undefined),
    battles: () => openBattlesView(params.get('battle') || undefined),
    guide: () => openGuideView(),
    private: () => openPrivateView(),
    alliances: () => document.getElementById('bloc-stats-btn')?.click(),
  }[section];
  if (open) {
    try { await Promise.race([open(), nextTick()]); }
    catch (err) { console.warn('[deep-link] sezione non aperta:', section, err); }
  }

  // ?tm=<epoch ms> — deep-link condivisibile della time machine (vedi
  // src/app/timeMachine.js:_syncUrl/_clearUrl per dove viene scritto).
  const tm = params.get('tm');
  if (tm) {
    const ts = Number(tm);
    if (Number.isFinite(ts)) openTimeMachineAt(ts);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initMotion();
  initReveal();
  initPoliticalOverlay();
  initEconomyOverlay();
  initNewsOverlay();
  initMuOverlay();
  initNationsOverlay();
  initPlayersOverlay();
  initBattlesOverlay();
  initGuideOverlay();
  initPrivateOverlay();
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
  // Mobile PRIMA di desktop: cattura la home pristine dei nodi condivisi
  // (#wp-top-controls, sezioni NAP) prima che il desktop li riloci. Vedi
  // nota "nodi CONDIVISI" in src/app/mobileMenuBar.js.
  initMobileMenuBar();
  initDesktopMenuBar();
  startNewsTicker();
  initTimeMachine();
  initAuthorPill();
  // WarEra+ dev: la pill visite scrive su un contatore PUBBLICO (/visits
  // sul server di cache, che non sa da quale deploy arrivi la richiesta).
  // Fuori dal live non si tocca; al suo posto il cartellino DEV.
  // Lo sfondo resta acceso tutto il giorno: il suo battito farebbe di ogni
  // desktop un "online adesso" perenne. Lì le pill si vedono in sola
  // lettura e il battito va nel conto a parte degli sfondi accesi (e solo
  // sul live: vedi la testata di visitorCounter.js).
  if (IS_WALLPAPER) initVisitorCounter({ wallpaper: true });
  else if (IS_LIVE) initVisitorCounter();
  initDeployBadge();
  if (IS_WALLPAPER) startWallpaperMode();
  // Prima si legge il link, POI l'URL comincia a seguire la navigazione
  // (vedi la testata di app/backNav.js).
  handleIncomingDeepLink()
    .catch(err => console.warn('[deep-link]', err))
    .finally(startUrlSync);
  restoreAfterChunkReload();
}, { once: true });

/* ══════════════════════════════════════════════════════════════
   Ripresa dopo una ricarica automatica
   ------------------------------------------------------------------
   Quando un `import()` di sezione fallisce due volte — tipicamente
   perche' e' uscito un deploy nuovo mentre la scheda era aperta e i nomi
   dei chunk sono cambiati — src/shared/lazyModule.js ricarica la pagina
   per prendere l'index.html aggiornato. Senza questo pezzo l'utente si
   ritroverebbe sulla mappa, chiedendosi perche' il clic non ha fatto
   niente: qui si riapre la sezione che aveva chiesto.

   `takeReloadIntent()` consuma il valore: vale una ricarica sola.
   ══════════════════════════════════════════════════════════════ */
function restoreAfterChunkReload() {
  const intent = takeReloadIntent();
  if (!intent) return;

  const open = {
    'bloc-stats': () => document.getElementById('bloc-stats-btn')?.click(),
    political: () => openPoliticalView(),
    economy: () => openEconomyView(),
    news: () => openNewsView(),
    mu: () => openMuView(),
    nations: () => openNationsView(),
    players: () => openPlayersView(),
    // Mancavano: chi apriva Battaglie, Guida o Area riservata subito dopo
    // un deploy si ritrovava sulla mappa, come se il tool fosse ripartito
    // da zero. 'mu-wealth' riapre la vista unita', che e' dove sta.
    battles: () => openBattlesView(),
    guide: () => openGuideView(),
    private: () => openPrivateView(),
    'mu-wealth': () => openMuView(),
  }[intent];

  if (open) open();
}
