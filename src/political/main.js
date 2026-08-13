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
   ══════════════════════════════════════════════════════════════ */

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
import { initI18n } from './i18n.js';
import { initBackgroundCanvas } from './backgroundCanvas.js';
import {
  showView, setStatus, hideSkeleton, showPartyView,
  loadCountries, exportCSV, openParliamentFullscreen, closeParliamentFullscreen,
  safeDestroy,
} from './ui.js';
import { startTicker } from './ticker.js';
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

let _mounted = false;
let _listenersWired = false;

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

        if (window.umami) {
          window.umami.track('election-load', {
            electionId: election._id,
            type: election.type,
            countryId: election.country || currentCountryId,
          });
        }
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
  setElectionHistory([]);
  setCurrentCongressElectionId(null);
  partyColorMap.clear();
  partyNamesMap.clear();
  document.getElementById('candidatesContainer').style.display = 'none';

  try {
    const data = await localFetch('/countries', {}, { useCache: false });
    setCurrentCountryData((data?.items || []).find(c => c._id === newCountryId) || null);
  } catch (_) { setCurrentCountryData(null); }

  setStatus('Loading…', 'loading');
  try {
    await loadPartiesForCountry(currentCountryId);
    await loadElectionsHistory();
    // Forza il refresh della timeline dopo cambio paese
    if (timelineChart) timelineChart.update();

    if (window.umami) window.umami.track('country-change', { country: currentCountryId });
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

  // La fetch di /countries (per currentCountryData) non blocca più
  // loadElectionsHistory: girano in parallelo, e se rientrano nello
  // stesso microtask finiscono nello stesso batch.
  const countryDataPromise = localFetch('/countries', {}, { useCache: false })
    .then(data => { setCurrentCountryData((data?.items || []).find(c => c._id === currentCountryId) || null); })
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
    initBackgroundCanvas();
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
