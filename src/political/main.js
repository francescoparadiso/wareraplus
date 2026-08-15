/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: main.js come modulo ES / orchestratore
   (Fase 2, Stage 8)
   ------------------------------------------------------------------
   L'originale girava come bootstrap su DOMContentLoaded del documento
   iframe (mai più utile: il DOMContentLoaded della pagina SHELL è già
   passato quando Political si apre, il markup viene montato lazy).
   Diventa `initPoliticalView(countryId, options)`, chiamata da
   src/app/politicalOverlay.js (Stage 9) al posto di impostare
   `frameEl.src`.

   Responsabilità aggiuntive rispetto all'originale (che si limitava a
   wire gli event listener, dando per scontato che gli altri moduli
   fossero già globali per hoisting):
   - Mount del template DOM (domTemplate.js, Stage 5) alla PRIMA
     apertura — idempotente, non rimonta se già presente.
   - Wiring esplicito delle dipendenze cross-modulo iniettate nei Stage
     precedenti (setCongressDeps/setPresidentialDeps/setSenateDeps) —
     nell'originale erano identificatori nudi risolti a runtime.
   - Il countryId arriva come parametro esspicito invece che da
     `location.search` dell'iframe (vedi nota in config.js, Stage 2).
   - Cambio nazione: estratto in `_onCountryChange`, riusata sia dal
     listener nativo su #countrySelect sia da initPoliticalView quando
     l'utente riapre Political per una nazione diversa da quella già
     caricata (equivalente al vecchio `isNewCountry` di
     politicalOverlay.js che ricaricava l'iframe).
   - Import di src/styles/political.css: nell'originale il CSS era un
     <link> nell'HTML dell'iframe, caricato automaticamente col
     documento. Qui, essendo un modulo, il CSS va importato
     esplicitamente — importato QUI (non in domTemplate.js) perché
     main.js è l'unico entry point garantito eseguito prima che
     qualunque markup Political diventi visibile.
   ══════════════════════════════════════════════════════════════ */

import '../styles/political.css';
import { t } from './i18n.js';
import {
  pendingRequest, setPendingRequest,
  congressCountdownInterval, setCongressCountdownInterval,
  latestPresidentialElectionId, setCurrentIsLatestPresidential,
  currentCountryId, setCurrentCountryId,
  setCurrentCountryData,
  setElectionHistory, setCurrentCongressElectionId,
  partyColorMap, partyNamesMap,
  setCurrentPartyId, currentPartyId,
  currentCongressElectionId,
  lastElectedParties,
  seatsChart, membersChart, allPartiesChart, timelineChart, votesChart,
  currentIsLatestPresidential,
  initTheme, toggleTheme,
} from './config.js';
import { localFetch } from './api.js';
import { cacheClear } from '../shared/trpcClient.js';
import { getAllCountries } from '../shared/countries.js';
import { initI18n } from './i18n.js';
import { initBackgroundCanvas } from './backgroundCanvas.js';
import {
  showView, setStatus, hideSkeleton, showPartyView,
  loadCountries, exportCSV, openParliamentFullscreen, closeParliamentFullscreen,
  safeDestroy,
} from './ui.js';
import { startTicker, pauseTicker, resumeTicker } from './ticker.js';
import { getPoliticalTemplate } from './domTemplate.js';
import { initSenateView, SenateView } from './senate.js';
import {
  loadElectionsHistory, loadPartiesForCountry, renderAllPartiesChart,
  getGovernmentWithDetails, onExpectedVotersChange, onSimSeatsChange,
  setCongressDeps, loadCongressElection,
  lastAllParties as _congressLastAllParties,
} from './congress.js';
import {
  loadPresidentialElection, onPresSimInput, presCountdown, setPresCountdown,
  setPresidentialDeps, lastPresData,
} from './presidential.js';
import { loadPartiesForSelector, loadPartyDetails } from './party.js';
import { initPanelSystem } from './panels.js';
import { loadPartyColors } from './api.js';
import { trackEvent } from '../shared/analytics.js';

let _mounted = false;
let _listenersWired = false;
// WarEra+ perf: funzione di stop del canvas particellare (backgroundCanvas.js),
// catturata qui per poterlo fermare quando l'overlay si chiude — vedi
// pausePoliticalRendering/resumePoliticalRendering più sotto.
let _stopBackgroundCanvas = null;

/* ── LOAD ELECTION (entry point, dispatcher congress/presidential) ── */
export async function loadElection(id) {
  // Se non viene passato un id, usa quello selezionato nel dropdown
  let electionId = id;
  if (!electionId) {
    const select = document.getElementById('electionSelect');
    electionId = select ? select.value : '';
  }
  if (!electionId) { setStatus(t('no_election_selected'), 'error'); return; }

  if (pendingRequest) {
    clearTimeout(pendingRequest.timeout);
    if (pendingRequest.controller) pendingRequest.controller.abort();
  }

  const selectEl = document.getElementById('electionSelect');
  const btnEl = document.getElementById('loadBtn');
  selectEl.disabled = true; btnEl.disabled = true;

  // NB: il lavoro vero e proprio è debounced di 300ms dentro il setTimeout.
  // Avvolgiamo tutto in una Promise che si risolve solo a lavoro concluso
  // (successo, errore o early-return), così chi fa `await loadElection(id)`
  // (es. SenateView) ottiene davvero i dati aggiornati, invece di risolversi
  // subito e leggere lastElectedParties ancora vecchio.
  return new Promise(resolveOuter => {
    setPendingRequest({});
    const timeout = setTimeout(async () => {
      setPendingRequest(null);
      setStatus(t('loading_election'), 'loading');

      try {
        const controller = new AbortController();
        setPendingRequest({ controller });

        const election = await localFetch('/election', { id: electionId });

        if (congressCountdownInterval) { clearInterval(congressCountdownInterval); setCongressCountdownInterval(null); }
        if (presCountdown) { clearInterval(presCountdown); setPresCountdown(null); }

        if (!election || !election.candidates) {
          console.warn('No detail for this ID:', electionId);
          showView('congress');
          hideSkeleton();
          setStatus(t('election_not_found'), 'error');
          return;
        }

        const isLatestPresidential = (election.type === 'president' && election._id === latestPresidentialElectionId);
        setCurrentIsLatestPresidential(isLatestPresidential);

        if (election.type === 'president') await loadPresidentialElection(election, isLatestPresidential);
        else if (election.type === 'congress') await loadCongressElection(election);
        else throw new Error(`Unknown election type: ${election.type}`);

        setStatus(t('updated_data'), '');

        trackEvent('election-load', {
          electionId: election._id,
          type: election.type,
          countryId: election.country || currentCountryId,
        });
      } catch (err) {
        console.error(err);
        hideSkeleton();
        if (err.message.includes('429')) {
          setStatus(t('too_many_requests'), 'error');
        } else if (err.name !== 'AbortError') {
          setStatus(t('generic_error', { msg: err.message }), 'error');
        }
      } finally {
        selectEl.disabled = false; btnEl.disabled = false;
        resolveOuter();
      }
    }, 300);
    setPendingRequest({ timeout });
  });
}

/* ── CAMBIO NAZIONE — estratto in funzione riusabile (listener nativo +
   riapertura programmatica da initPoliticalView per nazione diversa) ── */
async function _onCountryChange(newCountryId) {
  localStorage.setItem('preferredCountryId', newCountryId);
  if (newCountryId === currentCountryId) return;

  setCurrentCountryId(newCountryId);

  // BUG FIX: quando questa funzione è invocata programmaticamente da
  // initPoliticalView() (riapertura per una nazione diversa da quella già
  // montata — es. "Espandi" dal pannello su una nuova nazione, senza mai
  // chiudere l'overlay), il <select> nativo cambia valore ma il widget
  // TomSelect che lo sostituisce visivamente (vedi loadCountries() in
  // ui.js) NON viene aggiornato: TomSelect gestisce la propria label
  // visualizzata internamente e non "ascolta" riassegnazioni dirette di
  // `select.value`. Risultato: la barra di ricerca restava bloccata sulla
  // nazione mostrata alla PRIMA apertura (es. "Italy"/qualunque paese)
  // anche se sotto i dati si aggiornavano correttamente per quella nuova.
  // `false` come secondo argomento (silent) evita che TomSelect rispari il
  // suo evento 'change' → l'unico listener su quell'evento è proprio
  // _onCountryChange (vedi _wireEventListeners), che uscirebbe comunque
  // subito al guard `newCountryId === currentCountryId` qui sopra, ma è
  // più pulito non innescare un giro a vuoto.
  const countrySelectEl = document.getElementById('countrySelect');
  if (countrySelectEl?.tomselect && countrySelectEl.tomselect.getValue() !== newCountryId) {
    countrySelectEl.tomselect.setValue(newCountryId, true);
  }

  setElectionHistory([]);
  setCurrentCongressElectionId(null);
  partyColorMap.clear();
  partyNamesMap.clear();
  document.getElementById('candidatesContainer').style.display = 'none';

  try {
    // Fase 2 follow-up: elenco condiviso con Diplomacy invece di una
    // fetch dedicata (era { useCache: false } per forzare freschezza —
    // non più necessario, i dati sono già quelli con cui la mappa gira).
    const countries = await getAllCountries();
    setCurrentCountryData(countries.find(c => c._id === newCountryId) || null);
  } catch (_) { setCurrentCountryData(null); }

  setStatus('Loading…', 'loading');
  try {
    await loadPartiesForCountry(currentCountryId);
    await loadElectionsHistory();
    // Forza il refresh della timeline dopo cambio paese
    if (timelineChart) timelineChart.update();

    trackEvent('country-change', { country: currentCountryId });
  } catch (err) {
    console.error('Error switching country:', err);
    setStatus('Error loading data', 'error');
  }

  if (document.getElementById('party-view').style.display !== 'none') {
    loadPartiesForSelector();
    setCurrentPartyId(null);
    localStorage.removeItem('preferredPartyId');
    document.getElementById('partySelect').tomselect?.setValue('');
    loadPartyDetails(null);
  }
}

/* ── MOUNT + WIRING (una sola volta) ── */
function _mountTemplate() {
  if (_mounted) return;
  const root = document.getElementById('wp-political-root');
  if (!root) {
    // #wp-political-root manca dal DOM: quasi sempre significa che la
    // pagina caricata è un index.html vecchio (da prima del cutover
    // Stage 9, quando l'overlay era ancora un <iframe>), servito dalla
    // cache del service worker (`registerType: 'autoUpdate'` aggiorna
    // il SW in background ma NON forza il reload di una tab già aperta
    // con l'HTML precedente in memoria) — non un errore di codice.
    // Un solo tentativo di reload automatico (guardia via sessionStorage
    // per non entrare in loop se il problema fosse un altro); se persiste
    // dopo il reload, serve uno svuotamento manuale della cache/PWA.
    let alreadyRetried = false;
    try { alreadyRetried = sessionStorage.getItem('we_political_root_retry') === '1'; } catch (_) {}
    if (!alreadyRetried) {
      try { sessionStorage.setItem('we_political_root_retry', '1'); } catch (_) {}
      console.warn('WarEra+: #wp-political-root non trovato — probabile pagina non aggiornata dopo un deploy. Ricarico una volta...');
      window.location.reload();
    } else {
      console.error('WarEra+: #wp-political-root ancora assente dopo un reload automatico. Svuota la cache del browser (o disinstalla/reinstalla la PWA) e riprova.');
    }
    throw new Error('#wp-political-root non trovato nel DOM');
  }
  try { sessionStorage.removeItem('we_political_root_retry'); } catch (_) {}
  root.innerHTML = getPoliticalTemplate();
  root.style.display = '';
  _mounted = true;
}

function _wireDeps() {
  setCongressDeps({ loadElection });
  setPresidentialDeps({ loadElection });
  SenateView.setSenateDeps({ loadElection, getGovernmentWithDetails, loadPartiesForCountry });
}

function _wireEventListeners() {
  if (_listenersWired) return;
  _listenersWired = true;

  document.getElementById('partyViewBtn')?.addEventListener('click', () => showPartyView({ loadPartiesForSelector, loadPartyDetails }));
  document.getElementById('themeToggle')?.addEventListener('click', () => toggleTheme({
    loadElection, renderAllPartiesChart, loadPresidentialElection, safeDestroy,
    lastAllParties: _liveLastAllParties(), lastPresData,
  }));

  /* Re-render charts when a collapsed panel is opened */
  document.querySelectorAll('details.panel').forEach(details => {
    details.addEventListener('toggle', function () {
      if (!this.open) return;
      [
        ['seatsChart', seatsChart],
        ['membersChart', membersChart],
        ['allPartiesChart', allPartiesChart],
        ['timelineChart', timelineChart],
        ['votesChart', votesChart],
      ].forEach(([id, chart]) => {
        if (this.querySelector(`#${id}`) && chart) chart.update();
      });
    });
  });

  /* Country change */
  document.getElementById('countrySelect').addEventListener('change', function () {
    _onCountryChange(this.value);
  });

  /* Election controls */
  document.getElementById('loadBtn').addEventListener('click', () => loadElection());
  document.getElementById('electionSelect').addEventListener('change', function () {
    if (this.value) loadElection(this.value);
  });

  /* Toolbar buttons */
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => exportCSV(lastElectedParties));
  document.getElementById('fullscreenBtn')?.addEventListener('click', openParliamentFullscreen);
  document.getElementById('overlayClose')?.addEventListener('click', closeParliamentFullscreen);
  document.getElementById('parliamentOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('parliamentOverlay')) closeParliamentFullscreen();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeParliamentFullscreen(); });

  /* Simulators */
  document.getElementById('simExpectedVotersInput')?.addEventListener('input', onExpectedVotersChange);
  document.getElementById('simSeatsInput')?.addEventListener('input', onSimSeatsChange);
  document.getElementById('presSimVoters')?.addEventListener('input', onPresSimInput);

  /* Back to elections */
  document.getElementById('backToElectionsBtn')?.addEventListener('click', () => {
    document.getElementById('party-view').style.display = 'none';
    document.getElementById('congress-view').style.display = '';
    if (currentCongressElectionId) loadElection(currentCongressElectionId);
  });

  /* Clear cache — namespace 'pol' (Stage 3): non tocca eventuale cache
     futura di Diplomacy sotto we_dip_*. */
  document.getElementById('clearCacheBtn')?.addEventListener('click', () => {
    cacheClear('pol');
    setStatus(t('cache_cleared'), '');
    setTimeout(() => setStatus('', ''), 2000);
  });

  /* Re-render whatever dynamic view is currently visible whenever la
     lingua INTERNA a Political cambia (namespace separato dallo shell,
     vedi i18n.js) — così contenuto già caricato si aggiorna subito. */
  document.addEventListener('langchange', () => {
    if (document.getElementById('senateOverlay')?.classList.contains('active')) {
      SenateView.render(lastElectedParties || []);
    }
    if (document.getElementById('party-view')?.style.display !== 'none' && currentPartyId) {
      loadPartyDetails(currentPartyId);
    }
    if (document.getElementById('congress-view')?.style.display !== 'none' && currentCongressElectionId) {
      loadElection(currentCongressElectionId);
    } else if (document.getElementById('president-view')?.style.display !== 'none' && lastPresData?.election) {
      loadPresidentialElection(lastPresData.election, currentIsLatestPresidential);
    }
  });
}

// toggleTheme (config.js) legge lastAllParties come parametro iniettato:
// binding live importato da congress.js in testa al file, letto al
// momento della chiamata (sempre aggiornato, non serve un getter dedicato).
function _liveLastAllParties() { return _congressLastAllParties; }

async function _bootData() {
  await loadPartyColors('/political/parties_6813b6d446e731854c7ac7a2.csv');
  loadCountries();

  // Fase 2 follow-up: elenco condiviso con Diplomacy (src/shared/countries.js)
  // — nel caso normale è già in memoria (state.nazioniGlobal, popolato al
  // boot di Diplomacy prima che l'utente possa aprire Political), quindi
  // questa non è più una vera fetch di rete: non serve più tenerla separata
  // da loadElectionsHistory() per "non bloccare", ma restano comunque in
  // parallelo per il caso raro di fallback a fetch reale (vedi countries.js).
  const countryDataPromise = getAllCountries()
    .then(countries => { setCurrentCountryData(countries.find(c => c._id === currentCountryId) || null); })
    .catch(() => { setCurrentCountryData(null); });

  await Promise.all([countryDataPromise, loadElectionsHistory()]);
  startTicker();
  initPanelSystem();
}

/**
 * Entry point chiamata da src/app/politicalOverlay.js (Stage 9) al posto
 * di impostare frameEl.src. Idempotente: monta/wire solo alla prima
 * chiamata; su chiamate successive con una nazione diversa da quella già
 * caricata, riusa `_onCountryChange` (equivalente al vecchio reload
 * dell'iframe su isNewCountry).
 */
export async function initPoliticalView(countryId, options = {}) {
  const isFirstMount = !_mounted;
  _mountTemplate();
  _wireDeps();
  _wireEventListeners();

  if (isFirstMount) {
    initI18n();
    initTheme();
    _stopBackgroundCanvas = initBackgroundCanvas();
    initSenateView();
    if (countryId) setCurrentCountryId(countryId);
    await _bootData();
  } else if (countryId && countryId !== currentCountryId) {
    await _onCountryChange(countryId);
  }

  if (options.openSenate) {
    SenateView.open();
  }
}

/**
 * WarEra+ perf: Political View resta montata (solo nascosta via CSS, mai
 * smontata) dopo la chiusura dell'overlay — così riaprirla è istantaneo,
 * senza rifare il boot. Il rovescio della medaglia: i suoi loop continui
 * (canvas particellare, ticker RAF) andrebbero avanti PER SEMPRE in
 * background da lì in poi se nessuno li ferma. Chiamate da
 * closePoliticalView()/openPoliticalView() in
 * src/app/politicalOverlay.js — nessun effetto se Political non è ancora
 * mai stata aperta (_mounted false, _stopBackgroundCanvas ancora null).
 */
export function pausePoliticalRendering() {
  if (_stopBackgroundCanvas) { _stopBackgroundCanvas(); _stopBackgroundCanvas = null; }
  pauseTicker();
}

export function resumePoliticalRendering() {
  if (!_mounted) return;
  if (!_stopBackgroundCanvas) _stopBackgroundCanvas = initBackgroundCanvas();
  resumeTicker();
}
