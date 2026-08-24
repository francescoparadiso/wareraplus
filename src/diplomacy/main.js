import 'maplibre-gl/dist/maplibre-gl.css';
import { state } from './state.js';
import { hashColor, showLoading, hideLoading, trpcBatch, MAX_BATCH } from './utils.js';
import { showToast, updateDynamicLegend } from './ui.js';
import { initMap, renderMap, setupMapLayers, cercaNazione, resetDiplomazia, setMapSource, setColoringMode } from './map.js';
//import { loadExternalBlocs } from './blocs.js';
import { loadExternalNaps, aggiungiNap } from './naps.js';
import { loadSphereOfInfluence } from './sphereOfInfluence.js';
import { syncUIToState, toggleNapSection, updateExternalNapsUI } from './ui.js';
import { buildOriginalLabels, loadFlagImage } from './labels.js';
import { API_BASE_URL } from './config.js';
import { updateBattleMarkers } from './battleMarkers.js';
import { loadRegions } from './regions.js';
import { fetchCountriesViaCache, fetchMapDataViaCache, fetchAlliancesViaCache, fetchDiplomacyViaCache } from './cacheClient.js';
import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
let battleMarkersTimer = null;

// ── WarEra+ perf: pausa del polling marker battaglia ─────────────────
// Chiamate da src/app/mapIdle.js quando un overlay full-screen copre la
// mappa: aggiornare marker che nessuno sta guardando è solo traffico di
// rete e repaint sprecati. Additive, nessun effetto sul comportamento
// esistente finché nessuno le chiama.
let _battleMarkersPaused = false;

export function pauseBattleMarkersPolling() {
  if (!battleMarkersTimer) return;   // Diplomacy non ancora avviata
  clearInterval(battleMarkersTimer);
  battleMarkersTimer = null;
  _battleMarkersPaused = true;
}

export function resumeBattleMarkersPolling() {
  if (!_battleMarkersPaused || battleMarkersTimer) return;
  _battleMarkersPaused = false;
  // Giro immediato: i marker sono fermi ai dati di quando l'overlay si è
  // aperto, aspettare altri 30s renderebbe visibile il buco.
  updateBattleMarkers();
  battleMarkersTimer = setInterval(updateBattleMarkers, 30000);
}

// ==================== CARICAMENTO DATI ====================
// WarEra+: prova prima il server di cache (un solo poller condiviso da
// tutti gli utenti, vedi cacheClient.js), ricade sulla chiamata diretta se
// il server non risponde o i dati sono troppo vecchi — MAI un punto di
// fallimento unico, l'app deve continuare a funzionare come prima di
// questo modulo anche a VPS spento.
async function _fetchCountriesAndMap() {
  try {
    const [nazioni, mapDataGlobal] = await Promise.all([fetchCountriesViaCache(), fetchMapDataViaCache()]);
    return { nazioni, mapDataGlobal };
  } catch (err) {
    console.warn('[cache] countries/map non disponibili, fallback diretto:', err.message);
    const [resN, resM] = await Promise.all([
      fetch(`${API_BASE_URL}/trpc/country.getAllCountries`),
      fetch(`${API_BASE_URL}/trpc/map.getMapData`),
    ]);
    if (!resN.ok || !resM.ok) throw new Error('Failed to fetch data');
    const nationsData = await resN.json();
    const mapData = await resM.json();
    return { nazioni: nationsData.result.data, mapDataGlobal: mapData.result.data };
  }
}

async function refreshData() {
  try {
    showLoading();
    const { nazioni, mapDataGlobal } = await _fetchCountriesAndMap();

    state.nazioniGlobal = nazioni;
    state.mapDataGlobal = mapDataGlobal;

    state.nationMap.clear();
    state.nationByCode.clear();
    state.nazioniGlobal.forEach(n => {
      state.nationMap.set(n._id, n);
      if (n.code) state.nationByCode.set(n.code.toUpperCase(), n);
    });

    // ----- CARICAMENTO ALLEANZE CON GET BATCH -----
    const uniqueAllianceIds = [...new Set(
      state.nazioniGlobal
        .map(nation => nation.allianceId)
        .filter(id => id != null)
    )];

    let alliances = [];
    if (uniqueAllianceIds.length > 0) {
      try {
        alliances = await fetchAlliancesViaCache(uniqueAllianceIds);
      } catch (err) {
        console.warn('[cache] alleanze non disponibili, fallback diretto:', err.message);
        // trpcBatch chunka automaticamente oltre MAX_BATCH (50) e gestisce 429/errori
        const calls = uniqueAllianceIds.map(id => ['alliance.getById', { allianceId: id }]);
        const results = await trpcBatch(calls);
        alliances = results.filter(Boolean);
      }
    }

    state.alliancesList = alliances;
    state.allianceColorMap.clear();
    state.nationAlliancesMap.clear();
    // NOTA: processAlliancesData viene chiamato PIÙ AVANTI, dopo setupMapLayers(),
    // perché ha bisogno di state.labelsData già popolato per calcolare le
    // coordinate delle label dei blocchi (altrimenti i nomi dei blocchi non
    // vengono disegnati in modalità "blocs").
    // ----- FINE CARICAMENTO ALLEANZE -----

    // ----- CARICAMENTO DIPLOMAZIA (sworn enemy + defensive pacts) -----
    const countryIds = state.nazioniGlobal.map(n => n._id);
    state.diplomacyData.clear();
    try {
      try {
        state.diplomacyData = await fetchDiplomacyViaCache(countryIds);
      } catch (err) {
        console.warn('[cache] diplomazia non disponibile, fallback diretto:', err.message);
        // trpcBatch chunka automaticamente a MAX_BATCH (50) elementi per POST
        // e gestisce 429/errori per singolo item senza abortire l'intero giro.
        for (let i = 0; i < countryIds.length; i += MAX_BATCH) {
          const chunk = countryIds.slice(i, i + MAX_BATCH);
          const calls = chunk.map(id => ['countryDiplomacy.getByCountry', { countryId: id }]);
          const diplomacyResults = await trpcBatch(calls);
          diplomacyResults.forEach((data, idx) => {
            const nationId = chunk[idx];
            if (!data) return;
            state.diplomacyData.set(nationId, {
              swornEnemy: data.swornEnemy?.enemy || null,
              defensivePacts: (data.defensivePacts || []).map(p => p.partner),
            });
          });
        }
      }
    } catch (diplErr) {
      console.error('Errore caricamento diplomazia:', diplErr);
    }
    // ----- FINE CARICAMENTO DIPLOMAZIA -----

    // Datalist autocomplete
    const datalist = document.getElementById('nazioniList');
    datalist.innerHTML = '';
    [...state.nazioniGlobal]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(n => datalist.appendChild(new Option(n.name)));

    await setupMapLayers();
    await loadRegions();

    // Color map base
    state.nationBaseColorMap.clear();
    state.labelsData.forEach(label => {
      if (label.properties?.countryId) state.nationBaseColorMap.set(label.properties.countryId, label.properties.strokeColor);
    });
    state.nazioniGlobal.forEach(n => {
      if (!state.nationBaseColorMap.has(n._id)) state.nationBaseColorMap.set(n._id, n.color || hashColor(n._id));
    });

    buildOriginalLabels();
    state.originalLabelsData.forEach(l => {
      const c = l.properties?.countryCode?.toLowerCase();
      if (c) loadFlagImage(c);
    });

    // ----- ORA che state.labelsData è popolato, calcoliamo i dati delle alleanze -----
    // (blocColorMap, multiBlocMap, externalBlocsInfo con labelLng/labelLat corretti)
    const allianceModule = await import('./alliances.js');
    allianceModule.processAlliancesData(alliances);
    // ----------------------------------------------------------------------------

    // loadExternalNaps era importata ma mai chiamata: la lista NAP esterni
    // restava vuota e il ramo isExternalNap in getColorForCountry era morto.
    // WarEra+ perf: NON awaited. I due CSV stanno su raw.githubusercontent.com
    // che può essere lento/429 (limite per-IP) e bloccava l'apertura dell'app
    // per secondi (peggiorato dal retry a backoff). Ora partono in background:
    // la mappa è subito interattiva e le due funzioni ridisegnano da sole
    // (updateExternalNapsUI/renderMap) quando i dati arrivano. updateExternalNapsUI()
    // qui sotto fa il primo render (lista vuota) finché il fetch non completa.
    loadExternalNaps();
    updateExternalNapsUI();
    syncUIToState();
    loadSphereOfInfluence();

    // ==================== BATTLE MARKERS ====================
    await updateBattleMarkers();
    // Timer unico (prima ce n'erano due sovrapposti: 60s + 30s -> richieste
    // doppie e 429). Viene azzerato se refreshData viene rieseguita.
    if (battleMarkersTimer) clearInterval(battleMarkersTimer);
    battleMarkersTimer = setInterval(updateBattleMarkers, 30000);

    showToast('Strategic data loaded', 'success');

    // ── WarEra+ hook (unica riga aggiunta al codice Diplomacy originale) ──
    // Notifica che state.nazioniGlobal / state.nationMap / state.diplomacyData
    // sono popolati e la mappa è pronta per i click. Non altera alcun
    // comportamento esistente: è solo un evento in più che nessun modulo
    // originale ascolta.
    window.dispatchEvent(new CustomEvent('wareraplus:diplomacy-ready'));
  } catch (e) {
    console.error(e);
    showToast('Failed to load game data', 'error');
    trackEvent('data-unavailable', { source: 'boot' });
  } finally {
    hideLoading();
  }
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {

document.getElementById('theme-toggle-btn').addEventListener('click', function () {
  const newTheme = state.theme === 'light' ? 'dark' : 'light';
  state.theme = newTheme;
  trackEvent('theme-toggle', { theme: newTheme });
  document.body.classList.toggle('light-theme', newTheme === 'light');

  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = newTheme === 'light' ? '☀️' : '🌙';

  import('./map.js').then(module => {
    if (typeof module.applyTheme === 'function') module.applyTheme();
    if (typeof module.renderMap === 'function') module.renderMap();
    import('./ui.js').then(ui => ui.updateDynamicLegend());
  });

  import('./battleMarkers.js').then(m => {
    m.clearMarkers();
    setTimeout(() => m.updateBattleMarkers(), 50);
  });
});

  document.getElementById('cercaInput').addEventListener('keypress', e => { if (e.key === 'Enter') cercaNazione(); });
  document.getElementById('searchBtn').addEventListener('click', cercaNazione);
  document.getElementById('resetBtn').addEventListener('click', () => {
    trackEvent('reset-diplomacy');
    resetDiplomazia();
  });

  document.getElementById('napInput').addEventListener('keypress', e => { if (e.key === 'Enter') aggiungiNap(); });
  document.getElementById('addNapBtn').addEventListener('click', aggiungiNap);

  document.getElementById('toggle-borders').addEventListener('change', function () {
    trackEvent('map-source-toggle', { original: this.checked });
    setMapSource(this.checked);
  });

// main.js - sostituisci la sezione dei listener dei pulsanti

// Pulsanti prima riga
document.getElementById('mode-diplomacy').addEventListener('click', () => {
  // Nascondi lo slider della seconda riga
  const sliderBottom = document.getElementById('mode-slider-bottom');
  if (sliderBottom) sliderBottom.style.opacity = '0.3';
  trackEvent('view-mode-change', { mode: 'diplomacy' });
  setColoringMode('diplomacy');
});

document.getElementById('mode-blocs').addEventListener('click', () => {
  const sliderBottom = document.getElementById('mode-slider-bottom');
  if (sliderBottom) sliderBottom.style.opacity = '0.3';
  trackEvent('view-mode-change', { mode: 'blocs' });
  setColoringMode('blocs');
});

document.getElementById('mode-sphereOfInfluence')?.addEventListener('click', () => {
  const sliderBottom = document.getElementById('mode-slider-bottom');
  if (sliderBottom) sliderBottom.style.opacity = '0.3';
  trackEvent('view-mode-change', { mode: 'sphereOfInfluence' });
  setColoringMode('sphereOfInfluence');
});

// Pulsanti seconda riga
document.getElementById('mode-weeklyDamage').addEventListener('click', () => {
  const sliderTop = document.getElementById('mode-slider');
  if (sliderTop) sliderTop.style.opacity = '0.3';
  trackEvent('view-mode-change', { mode: 'weeklyDamage' });
  setColoringMode('weeklyDamage');
});

document.getElementById('mode-population').addEventListener('click', () => {
  const sliderTop = document.getElementById('mode-slider');
  if (sliderTop) sliderTop.style.opacity = '0.3';
  trackEvent('view-mode-change', { mode: 'population' });
  setColoringMode('population');
});

// ══ Terza riga (WarEra+): heatmap storiche ════════════════════════════
// I dati non stanno in memoria come popolazione/danni (che arrivano con
// country.getAllCountries): si caricano alla PRIMA attivazione della vista
// e restano in state per la sessione. La modalita' si attiva subito, con la
// mappa neutra e la legenda che dice "sto caricando", invece di lasciare il
// bottone premuto senza risposta finche' la fetch non torna.
// Il pannello riassuntivo di queste tre viste (src/panel/viewOverview.js)
// si apre PRIMA che la loro fetch sia tornata — mostra "sto caricando" e va
// ridisegnato quando il dato atterra, come gia' si fa con la mappa.
function _refreshOverview(mode) {
  import('../panel/countryPanel.js').then(m => m.refreshViewOverviewPanel(mode));
}

function _dimOtherSliders() {
  const sliderTop = document.getElementById('mode-slider');
  const sliderBottom = document.getElementById('mode-slider-bottom');
  if (sliderTop) sliderTop.style.opacity = '0.3';
  if (sliderBottom) sliderBottom.style.opacity = '0.3';
}

document.getElementById('mode-contested')?.addEventListener('click', async () => {
  _dimOtherSliders();
  trackEvent('view-mode-change', { mode: 'contested' });
  setColoringMode('contested');
  if (state.contestedCounts) return;
  try {
    const { fetchContestedRegionsViaCache } = await import('./cacheClient.js');
    state.contestedCounts = await fetchContestedRegionsViaCache();
    if (state.coloringMode === 'contested') { renderMap(); _refreshOverview('contested'); }
  } catch (err) {
    console.warn('[contested] dati non disponibili:', err.message);
  }
});

document.getElementById('mode-warIntensity')?.addEventListener('click', async () => {
  _dimOtherSliders();
  trackEvent('view-mode-change', { mode: 'warIntensity' });
  setColoringMode('warIntensity');
  if (state.warIntensityData) return;
  try {
    const { fetchWarIntensityViaCache } = await import('./cacheClient.js');
    state.warIntensityData = await fetchWarIntensityViaCache();
    state.warIntensityError = null;
    if (state.coloringMode === 'warIntensity') { renderMap(); _refreshOverview('warIntensity'); }
  } catch (err) {
    // Unica delle tre senza alcun ripiego lato client: il totale storico
    // per regione esiste solo sul server di cache (battaglie del bootstrap).
    console.warn('[warIntensity] dati non disponibili:', err.message);
    // Il messaggio diceva SEMPRE "cache server not updated", cioè la
    // diagnosi sbagliata in due casi su tre: l'endpoint c'è da tempo, e
    // quello che di solito fallisce è la RAGGIUNGIBILITÀ del server —
    // un HTTP 404 (endpoint davvero assente) e un timeout/interruttore
    // aperto (VPS lento o giù, vedi il circuit breaker in cacheClient.js)
    // producevano la stessa frase, mandando a caccia del bug sbagliato.
    // Ora dicono cose diverse, e il caso transitorio invita a riprovare
    // invece di far credere che manchi un deploy.
    const missing = /HTTP 404/.test(err.message || '');
    state.warIntensityError = missing
      ? 'Historical battle data not available yet (cache server not updated).'
      : 'Cache server unreachable right now — reopen this view to retry.';
    if (state.coloringMode === 'warIntensity') { renderMap(); _refreshOverview('warIntensity'); }
  }
});

document.getElementById('mode-playstyle')?.addEventListener('click', async () => {
  _dimOtherSliders();
  trackEvent('view-mode-change', { mode: 'playstyle' });
  setColoringMode('playstyle');
  if (state.nationPlaystyle) return;
  try {
    // Stesso endpoint gia' usato dal pannello nazione e da Statistiche
    // alleanze: se una delle due l'ha gia' chiesto in questa sessione la
    // risposta e' gia' in memoria dentro src/mu/api.js, zero fetch.
    const { fetchPlaystyleByCountry } = await import('../mu/api.js');
    state.nationPlaystyle = await fetchPlaystyleByCountry();
    if (state.coloringMode === 'playstyle') { renderMap(); _refreshOverview('playstyle'); }
  } catch (err) {
    console.warn('[playstyle] dati non disponibili:', err.message);
  }
});
  document.getElementById('checkLabels').addEventListener('change', () => { if (state.map) state.map.triggerRepaint(); });
  document.getElementById('checkExcludeExternalNaps').addEventListener('change', function () {
    trackEvent('toggle-exclude-external-naps', { checked: this.checked });
    import('./map.js').then(m => m.renderMap());
  });

  document.getElementById('manualNapToggle').addEventListener('click', () => toggleNapSection('manual-nap-section'));
  document.getElementById('externalNapToggle').addEventListener('click', () => toggleNapSection('external-nap-section'));

  document.getElementById('legendToggleBtn').addEventListener('click', () => {
    const legend = document.getElementById('dynamic-legend');
    legend.classList.toggle('hidden');
    trackEvent('legend-toggle', { open: !legend.classList.contains('hidden') });
  });

  document.getElementById('zoomInBtn')?.addEventListener('click', () => { state.map?.zoomIn(); trackEvent('zoom-button', { direction: 'in' }); });
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => { state.map?.zoomOut(); trackEvent('zoom-button', { direction: 'out' }); });

  const hamburgerBtn = document.getElementById('hamburger-btn');
  const hamburgerMenu = document.getElementById('hamburger-menu');
  hamburgerBtn.addEventListener('click', e => {
    e.stopPropagation();
    hamburgerMenu.classList.toggle('visible');
  });
  document.addEventListener('click', e => {
    if (!hamburgerBtn.contains(e.target) && !hamburgerMenu.contains(e.target)) {
      hamburgerMenu.classList.remove('visible');
    }
  });

  document.getElementById('bloc-stats-btn').addEventListener('click', () => {
    document.getElementById('map').style.display = 'none';
    document.getElementById('bloc-stats-page').style.display = 'block';
    trackEvent('bloc-stats-open');
    // ── WarEra+ (additivo): sfondo a particelle viola della sezione e
    // pausa del lavoro di sfondo della mappa, come per gli altri overlay
    // di "Approfondimenti". Import dinamico + catch: se il modulo manca,
    // la pagina si apre esattamente come prima.
    import('../app/overlayChrome.js')
      .then(m => m.enterOverlay(document.getElementById('bloc-stats-page'), 'alliance'))
      .catch(() => {});
    // WarEra+ (additivo): il chunk di blocStats puo' non arrivare — deploy
    // nuovo su Vercel mentre la scheda era aperta, i nomi dei chunk
    // cambiano e il vecchio non esiste piu'. Prima l'errore veniva
    // ingoiato dalla promise e la pagina restava vuota (solo lo sfondo a
    // particelle). loadModule riprova e, se serve, ricarica una volta
    // sola; qui si gestisce anche il caso "nemmeno la ricarica basta" e
    // qualunque errore del rendering, con un messaggio invece del vuoto.
    loadModule(() => import('./blocStats.js'), 'bloc-stats')
      .then(m => {
        const stats = m.computeBlocStats();
        m.renderBlocStats(stats);
      })
      .catch(err => {
        console.error('[bloc-stats] apertura fallita:', err);
        showBlocStatsError();
      });
  });

  /** Messaggio con ritenta/ricarica al posto della pagina vuota. */
  function showBlocStatsError() {
    const host = document.getElementById('bloc-stats-content');
    if (!host) return;
    host.innerHTML = `
      <div style="max-width:520px;margin:60px auto;padding:22px;border:1px solid #30363d;border-radius:12px;background:#161b22;text-align:center;">
        <p style="margin:0 0 14px;color:#e6edf3;font-size:14px;">
          Impossibile caricare le statistiche delle alleanze.
        </p>
        <p style="margin:0 0 18px;color:#8b949e;font-size:12.5px;">
          Di solito succede quando l'app e' stata aggiornata mentre questa scheda era aperta.
        </p>
        <button id="bs-reload-btn" style="background:#0062ff;border:none;color:#fff;padding:9px 18px;border-radius:8px;cursor:pointer;font-weight:600;">
          Ricarica
        </button>
      </div>`;
    host.querySelector('#bs-reload-btn')?.addEventListener('click', () => location.reload());
  }

  document.getElementById('bloc-stats-close').addEventListener('click', () => {
    document.getElementById('bloc-stats-page').style.display = 'none';
    document.getElementById('map').style.display = 'block';
    trackEvent('bloc-stats-close');
    // Simmetrica all'apertura: ferma le particelle e fa ripartire la mappa.
    import('../app/overlayChrome.js')
      .then(m => m.leaveOverlay(document.getElementById('bloc-stats-page')))
      .catch(() => {});
  });
// Toggle Active Battles
document.getElementById('checkActiveBattles').addEventListener('change', function() {
  import('./battleMarkers.js').then(m => {
    m.toggleBattleMarkers(this.checked);
  });
});
  // ==================== TASTO ESC PER USCITA HEATMAP ====================
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.coloringMode === 'battleHeatmap') {
      // hideBattleTooltip() gestisce anche uscita heatmap + ripristino
      // marker (vedi battleMarkers.js): prima Escape usciva dall'heatmap
      // ma lasciava il tooltip battaglia aperto.
      import('./battleMarkers.js').then(m => m.hideBattleTooltip());
    }
  });
}

// ==================== INIT ====================
async function init() {
  initMap();
// main.js - dopo initMap(), aggiungi:

// Inizializza gli slider
const sliderTop = document.getElementById('mode-slider');
const sliderBottom = document.getElementById('mode-slider-bottom');

if (sliderTop) {
  sliderTop.style.left = '3px';
  sliderTop.style.opacity = '1';
}

if (sliderBottom) {
  sliderBottom.style.left = '3px';
  sliderBottom.style.opacity = '0.3'; // Nascondi inizialmente la seconda riga
  state._lastBottomMode = 'weeklyDamage'; // Default
}
  setupEventListeners();
  state.map.on('load', refreshData);
}

init();