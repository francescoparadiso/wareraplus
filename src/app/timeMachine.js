/* ══════════════════════════════════════════════════════════════
   WarEra+ — Time machine
   ------------------------------------------------------------------
   Bottone dedicato ("🕰️", accanto agli altri controlli fissi in alto) che
   apre uno slider in basso e mostra l'ownership STORICA delle regioni a un
   istante passato, ricostruita dal server di cache (vedi cacheClient.js:
   fetchRegionHistoryRangeViaCache / fetchRegionHistoryAtViaCache — tutto
   il lavoro di keyframe+replay lo fa il server, qui c'è solo una fetch per
   ogni posizione dello slider).

   Scope deliberatamente ridotto (decisione esplicita): mostra SOLO
   ownership regione + nome nazione + bandiera al click. Niente
   popolazione/ricchezza/sviluppo del momento storico — quei dati non sono
   mai stati salvati nel tempo, mostrarli sarebbe fuorviante (sembrerebbero
   valori storici ma sarebbero quelli di OGGI).

   RENDERING (riscritto — richiesto esplicitamente dall'utente dopo che il
   disegno restava troppo lento anche dopo diversi giri di ottimizzazione):
   prima ridisegnava DENTRO alla mappa Diplomacy principale (sostituendo
   temporaneamente le sue sorgenti regioni/confini, mutando state.labelsData
   e ripristinando tutto alla chiusura) — competeva ad ogni frame con la
   decina di layer sempre attivi lì (alleanze, blocchi, sfera d'influenza,
   marker/heatmap battaglie, rotte navali, badge doppi, danni settimanali,
   popolazione, pattern SVG...). Ora usa una SECONDA mappa MapLibre dedicata
   e alleggerita (src/app/timeMachineMap.js — 3 layer in tutto, mappa fissa
   non a scorrimento infinito), mostrata al posto della principale (che
   viene semplicemente nascosta, non toccata) mentre la time machine è
   aperta. Questo file resta responsabile di TUTTA la logica (fetch, stato,
   playback, eventi, tastiera, popup, share) — timeMachineMap.js sa solo
   "disegnare quello che gli viene passato".
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { escapeHtml, showToast } from '../diplomacy/utils.js';
import {
  fetchRegionHistoryRangeViaCache,
  fetchRegionHistoryAtViaCache,
  fetchRegionHistoryEventsViaCache,
} from '../diplomacy/cacheClient.js';
import { pauseShipAnimation as pauseShipAnimationDark, resumeShipAnimation as resumeShipAnimationDark } from '../diplomacy/oceanBackground.js';
import { pauseShipAnimation as pauseShipAnimationAntique, resumeShipAnimation as resumeShipAnimationAntique } from '../diplomacy/antiqueTheme.js';
import {
  activateTimeMachineMap,
  deactivateTimeMachineMap,
  renderTimeMachineFrame,
  captureFrame,
  getTimeMachineMap,
  TM_LYR_FILL,
  setTimeMachineFocus,
} from './timeMachineMap.js';
import { COLORS } from '../diplomacy/config.js';
import { BORDER_COLORS } from '../diplomacy/borderStyle.js';
import { loadAllianceHistory, alliancesAt } from './timeMachineAlliances.js';
import { trackEvent } from '../shared/analytics.js';
import { t } from '../shared/i18n.js';
// WarEra+ la giornata storica: patti, guerre, nemico giurato e battaglie
// aperte di QUEL giorno. Vedi il blocco in testa a timeMachineDay.js per
// il motivo per cui questi quattro campi non cadono piu' sotto il limite
// dichiarato qui sopra.
import { dayKey, fetchDay, cachedDay, fuoriPortata } from './timeMachineDay.js';

// Passo di uno "step" discreto (frecce tastiera) — un giorno di gioco.
const STEP_MS = 24 * 60 * 60 * 1000;
// PLAY_TICK_MS: cadenza NOMINALE del loop di playback, non la velocità
// (vedi _playLoop — la velocità è calcolata sul tempo reale trascorso, non
// su questo). 1x/2x/3x = 1/2/3 giorni di gioco al SECONDO reale.
const PLAY_TICK_MS = 150;
const PLAY_SPEEDS = [1, 2, 3]; // giorni/secondo — 4x rimosso su richiesta esplicita

// Il server semina la genesi (keyframe più vecchio) al 1 maggio 2025 — vedi
// GENESIS_TS in server/warera-cache-server.js. Non serve duplicare la
// costante qui: /region-history/range ritorna già `min` come quella data
// reale (non più una sentinella ts:0), quindi _fmtDate la formatta come
// una data qualunque, senza bisogno di un caso speciale.
function _fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// "Day 145/470" — giorno corrente dalla genesi su giorni totali coperti
// dallo storico. Giorno 1 = genesi (_range.min), non 0.
function _fmtDay(ts) {
  if (!_range) return '';
  const dayNum = Math.floor((ts - _range.min) / STEP_MS) + 1;
  const totalDays = Math.floor((_range.max - _range.min) / STEP_MS) + 1;
  return t('tm_day', { n: dayNum, total: totalDays });
}

// Data in formato compatto/filesystem-safe (YYYY-MM-DD_HHmm), per il nome
// del file PNG condiviso — _fmtDate usa slash/virgole non adatti a un nome
// file su tutti i sistemi.
function _fmtDateForFilename(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Data in formato <input type="date"> (YYYY-MM-DD) nel fuso LOCALE —
// toISOString() qui sarebbe sbagliato: converte in UTC e a seconda del fuso
// e dell'ora mostrata restituirebbe il giorno prima o quello dopo.
function _toDateInputValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// YYYY-MM-DD scelto dall'utente -> istante da mostrare. Si conserva l'ORA
// della posizione corrente (cambiare giorno non deve anche far saltare
// l'orologio a mezzanotte) e si resta dentro il range coperto dallo
// storico. Ritorna null se la data non è interpretabile.
function _dateInputValueToTs(value, currentTs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m || !_range) return null;
  const cur = new Date(Number.isFinite(currentTs) ? currentTs : _range.max);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), cur.getHours(), cur.getMinutes(), 0, 0);
  const ts = d.getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.min(Math.max(ts, _range.min), _range.max);
}

function _syncDateInput(ts) {
  if (!_dateInput) return;
  const v = _toDateInputValue(ts);
  if (_dateInput.value !== v) _dateInput.value = v;
}

let _btn, _panel, _slider, _label, _dayLabel, _dateInput;
let _playBtn, _prevEventBtn, _nextEventBtn, _speedBtn, _shareBtn;
// Indicatore "sei nella time machine" (badge + orologio analogico + data) e
// classifica territorio ("hall of fame" + lista regioni per nazione).
let _indicator, _clockHour, _clockMin, _clockHM, _clockDate;
let _standings, _standingsList, _standingsBtn, _dayBattlesEl;
let _standingsVisible = !window.matchMedia('(max-width: 768px)').matches; // di default aperta su desktop, chiusa su mobile (poco spazio)

// Nettrix ha reso possibile lo storico della time machine (server di cache):
// una card di ringraziamento nell'indicatore linka al suo profilo.
const NETTRIX_URL = 'https://app.warera.io/user/69baf405edc9a346931b27c5';
let _active = false;
let _range = null;
let _debounceTimer = null;
// Giornata storica: il giorno mostrato adesso, il suo timer e l'ultimo
let _dayTimer = null;
let _dayShown = null;
let _lastRegions = null; // { regionId: countryId } della posizione slider corrente, per il click
let _labelRegionId = null; // Map: indice in state.labelsData -> regionId "sotto" quella label (calcolato una volta, posizione fissa — sola lettura, non muta più state.labelsData)

// Playback (play/pausa + velocità 1x-3x, in giorni/secondo REALI)
let _playing = false;
let _playTimer = null;
let _playLastTickAt = null; // Date.now() dell'ultimo frame applicato — vedi _playLoop
let _speedIdx = 0; // indice in PLAY_SPEEDS

// Eventi (salto prossimo/precedente + "dal —" nel popup): UNA fetch sola
// per sessione (l'intero storico), non una per interazione — vedi
// cacheClient.js:fetchRegionHistoryEventsViaCache. Se fallisce, i bottoni
// prossimo/precedente restano disabilitati e il popup non mostra "dal —":
// degrado grazioso, il resto della time machine funziona comunque.
let _eventTsSorted = null; // number[] ordinato, per il salto prossimo/precedente
let _eventsByRegion = null; // Map<regionId, {ts,toCountry}[]> ordinato per ts, per "dal —"

export function initTimeMachine() {
  _btn = document.getElementById('wp-time-machine-btn');
  if (!_btn) return;
  _btn.addEventListener('click', () => (_active ? _deactivate() : _activate()));
}

// Apre la time machine già posizionata su un istante specifico invece che
// sull'ultimo (oggi) — usata dal deep-link ?tm=<epoch ms> in ingresso
// (vedi main.js:handleIncomingDeepLink, stesso principio del deep-link
// ?country= già esistente). Se la time machine è già aperta non fa nulla
// (evita di riattivarla due volte se il deep-link viene richiamato più
// volte per errore).
export function openTimeMachineAt(ts) {
  if (_active || !Number.isFinite(ts)) return;
  _activate(ts);
}

async function _activate(initialTs) {
  // Basta che i dati di base siano pronti (baseGeoJSON/topologia) — non
  // serve più che state.map specificamente esista già "aperta": la mappa
  // dedicata (timeMachineMap.js) si crea/mostra da sé qui sotto.
  if (!state.baseGeoJSON) return;
  try {
    _range = await fetchRegionHistoryRangeViaCache();
  } catch (err) {
    console.warn('WarEra+ time machine: storico non disponibile:', err.message);
    showToast(t('tm_unavailable_now'), 'warning');
    trackEvent('data-unavailable', { source: 'time-machine' });
    return; // niente panello se il server non ha ancora nessuno storico
  }

  _active = true;
  state.timeMachineActive = true;
  _btn.classList.add('wp-time-machine-btn-active');
  // PERF: il pallino nave è puramente decorativo (schema seedato sempre
  // uguale, non dipende da nessun dato) — pausarlo (resta visibile, solo
  // fermo) evita lavoro JS inutile mentre la sua mappa è nascosta. Solo
  // uno dei due temi ha un runner attivo, l'altra chiamata è un no-op.
  pauseShipAnimationDark();
  pauseShipAnimationAntique();

  await activateTimeMachineMap(); // crea/mostra la mappa dedicata, nasconde quella principale
  _buildPanelIfNeeded();
  _buildIndicatorIfNeeded();
  _buildStandingsIfNeeded();
  _panel.classList.add('open');
  _indicator.classList.add('open');
  _applyStandingsVisibility();
  document.addEventListener('keydown', _onKeydown);

  const startTs = Number.isFinite(initialTs)
    ? Math.min(Math.max(initialTs, _range.min), _range.max)
    : _range.max;
  _slider.min = String(_range.min);
  _slider.max = String(_range.max);
  _slider.value = String(startTs);
  // Il selettore data copre esattamente lo stesso intervallo dello slider.
  _dateInput.min = _toDateInputValue(_range.min);
  _dateInput.max = _toDateInputValue(_range.max);
  const ok = await _applyAt(startTs);
  if (!ok) {
    // Il range c'era (spesso nginx serve un file /range stale) ma la
    // ricostruzione del frame fallisce: non lasciamo una time machine aperta e
    // vuota senza spiegazione — _fetchAndRender ha già mostrato il toast, qui
    // chiudiamo tutto e torniamo alla mappa normale.
    _deactivate();
    return;
  }

  getTimeMachineMap().on('click', TM_LYR_FILL, _onHistoricalClick);
  _loadEvents(); // in background, non blocca l'apertura — vedi commento sopra _eventTsSorted
  trackEvent('time-machine-open', { deepLink: Number.isFinite(initialTs) });
}

function _deactivate() {
  _active = false;
  state.timeMachineActive = false;
  trackEvent('time-machine-close');
  _stopPlay();
  _btn.classList.remove('wp-time-machine-btn-active');
  if (_panel) _panel.classList.remove('open');
  if (_indicator) _indicator.classList.remove('open');
  if (_standings) _standings.classList.remove('open');
  _clearFocus();
  // La giornata storica: si spegne con la vista. La cache dei giorni in
  // timeMachineDay.js resta (riaprire la time machine sullo stesso giorno
  // non deve ripagare la richiesta), ma quello che e' a schermo no.
  clearTimeout(_dayTimer);
  _dayShown = null;
  if (_dayBattlesEl) _dayBattlesEl.innerHTML = '';
  document.removeEventListener('keydown', _onKeydown);
  resumeShipAnimationDark();
  resumeShipAnimationAntique();
  _clearUrl();

  const tmMap = getTimeMachineMap();
  if (tmMap) tmMap.off('click', TM_LYR_FILL, _onHistoricalClick);
  deactivateTimeMachineMap(); // nasconde la mappa dedicata, mostra quella principale (mai toccata, nessun ripristino da fare)

  // BUG FIX (segnalato dall'utente): dopo aver chiuso la time machine lo
  // "scroll" (drag/pan della mappa) restava bloccato su mobile. Causa più
  // probabile: #wp-time-machine-panel resta nel DOM (spostato fuori
  // schermo via transform, mai display:none) con lo slider ancora
  // focalizzabile — su iOS in particolare, un elemento position:fixed
  // fuori viewport che riceve un gesto di trascinamento può innescare un
  // overscroll/rubber-band della pagina che poi non si "sblocca" da solo
  // (bug noto della combinazione position:fixed + transform + drag su
  // touch). togliere il focus e forzare un reset dell'overscroll qui è la
  // difesa più economica indipendentemente dalla causa esatta — vedi anche
  // touch-action/overscroll-behavior aggiunti in shell.css sullo slider e
  // pointer-events:none sul pannello quando chiuso (così non intercetta
  // più eventi nemmeno se un browser lo considerasse ancora "in viewport").
  if (document.activeElement instanceof HTMLElement && _panel?.contains(document.activeElement)) {
    document.activeElement.blur();
  }
}

function _buildPanelIfNeeded() {
  if (_panel) return;

  _panel = document.createElement('div');
  _panel.id = 'wp-time-machine-panel';
  _panel.innerHTML = `
    <div class="wp-tm-row wp-tm-controls">
      <button id="wp-tm-close" data-i18n-title="tm_close" data-i18n-aria="tm_close" title="${t('tm_close')}" aria-label="${t('tm_close')}">✕</button>
      <button id="wp-tm-prev-event" data-i18n-title="tm_prev_event" data-i18n-aria="tm_prev_event" title="${t('tm_prev_event')}" aria-label="${t('tm_prev_event')}" disabled>⏮</button>
      <button id="wp-tm-play" data-i18n-title="tm_play" data-i18n-aria="tm_play" title="${t('tm_play')}" aria-label="${t('tm_play')}">▶</button>
      <button id="wp-tm-next-event" data-i18n-title="tm_next_event" data-i18n-aria="tm_next_event" title="${t('tm_next_event')}" aria-label="${t('tm_next_event')}" disabled>⏭</button>
      <button id="wp-tm-speed" data-i18n-title="tm_speed_title" data-i18n-aria="tm_speed_title" title="${t('tm_speed_title')}" aria-label="${t('tm_speed_title')}">1x</button>
      <!-- WarEra+ (richiesto): scelta diretta della data. Con ~490 giorni
           di storico su una traccia larga poche centinaia di pixel, lo
           slider non permette di "beccare" un giorno preciso; questo lo
           affianca (non lo sostituisce) e su telefono apre il selettore
           di data nativo. min/max sono impostati in _activate dal range
           reale dello storico. -->
      <input id="wp-tm-date" type="date" data-i18n-title="tm_pick_date" data-i18n-aria="tm_pick_date" title="${t('tm_pick_date')}" aria-label="${t('tm_pick_date')}" />
      <button id="wp-tm-standings-toggle" data-i18n-title="tm_standings" data-i18n-aria="tm_standings" title="${t('tm_standings')}" aria-label="${t('tm_standings')}">🏆</button>
      <button id="wp-tm-share" data-i18n-title="tm_share" data-i18n-aria="tm_share" title="${t('tm_share')}" aria-label="${t('tm_share')}">📤</button>
    </div>
    <div class="wp-tm-row wp-tm-slider-row">
      <input id="wp-tm-slider" type="range" min="0" max="1000" value="1000" />
      <div class="wp-tm-info">
        <span id="wp-tm-day">${t('tm_day', { n: '—', total: '—' })}</span>
        <span id="wp-tm-label">—</span>
      </div>
    </div>
  `;
  document.body.appendChild(_panel);

  _slider = _panel.querySelector('#wp-tm-slider');
  _label = _panel.querySelector('#wp-tm-label');
  _dayLabel = _panel.querySelector('#wp-tm-day');
  _playBtn = _panel.querySelector('#wp-tm-play');
  _prevEventBtn = _panel.querySelector('#wp-tm-prev-event');
  _nextEventBtn = _panel.querySelector('#wp-tm-next-event');
  _speedBtn = _panel.querySelector('#wp-tm-speed');
  _shareBtn = _panel.querySelector('#wp-tm-share');
  _standingsBtn = _panel.querySelector('#wp-tm-standings-toggle');
  _dateInput = _panel.querySelector('#wp-tm-date');

  _panel.querySelector('#wp-tm-close').addEventListener('click', _deactivate);
  _playBtn.addEventListener('click', _togglePlay);
  _prevEventBtn.addEventListener('click', () => _jumpToEvent(-1));
  _nextEventBtn.addEventListener('click', () => _jumpToEvent(1));
  _speedBtn.addEventListener('click', _cycleSpeed);
  _standingsBtn.addEventListener('click', _toggleStandings);
  _shareBtn.addEventListener('click', _shareScreenshot);

  // Scelta diretta della data: si comporta come un salto manuale (ferma il
  // playback) e riusa _applyAt, quindi slider, etichette e URL condivisibile
  // restano allineati come per qualunque altro spostamento.
  _dateInput.addEventListener('change', () => {
    if (!_range || !_dateInput.value) return;
    const ts = _dateInputValueToTs(_dateInput.value, Number(_slider.value));
    if (ts === null) { _syncDateInput(Number(_slider.value)); return; }
    _stopPlay();
    clearTimeout(_debounceTimer);
    _slider.value = String(ts);
    _applyAt(ts);
    trackEvent('time-machine-pick-date');
  });

  _slider.addEventListener('input', () => {
    _stopPlay(); // trascinamento manuale = l'utente prende il controllo, ferma il playback
    const ts = Number(_slider.value);
    _label.textContent = _fmtDate(ts);
    _dayLabel.textContent = _fmtDay(ts);
    _syncDateInput(ts);
    // Debounce: la fetch server-side (ricostruzione keyframe+replay) non ha
    // senso rifarla per OGNI pixel trascinato — solo quando l'utente si ferma.
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => _applyAt(ts), 180);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Indicatore "sei nella time machine": badge lampeggiante + orologio
// analogico le cui lancette si muovono all'ora dell'ISTANTE mostrato (non
// l'ora reale) + data. Card di ringraziamento a Nettrix (server storico) in
// fondo. Creato una volta, mostrato/nascosto in _activate/_deactivate.
// ─────────────────────────────────────────────────────────────────────────
function _buildIndicatorIfNeeded() {
  if (_indicator) return;
  _indicator = document.createElement('div');
  _indicator.id = 'wp-tm-indicator';
  _indicator.innerHTML = `
    <div class="wp-tm-ind-head"><span class="wp-tm-ind-dot"></span><span data-i18n="tm_indicator_label">${t('tm_indicator_label')}</span></div>
    <div class="wp-tm-ind-body">
      <svg class="wp-tm-clock" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" class="wp-tm-clock-face"/>
        <g class="wp-tm-clock-ticks">
          <line x1="50" y1="6" x2="50" y2="13"/><line x1="50" y1="94" x2="50" y2="87"/>
          <line x1="6" y1="50" x2="13" y2="50"/><line x1="94" y1="50" x2="87" y2="50"/>
        </g>
        <line x1="50" y1="50" x2="50" y2="29" class="wp-tm-hand-hour"/>
        <line x1="50" y1="50" x2="50" y2="19" class="wp-tm-hand-min"/>
        <circle cx="50" cy="50" r="3" class="wp-tm-clock-pin"/>
      </svg>
      <div class="wp-tm-ind-time">
        <div class="wp-tm-ind-hm">--:--</div>
        <div class="wp-tm-ind-date">—</div>
      </div>
    </div>
    <a class="wp-tm-credit" href="${NETTRIX_URL}" target="_blank" rel="noopener">
      <span data-i18n="tm_credit_prefix">${t('tm_credit_prefix')}</span> <strong>Nettrix</strong> ↗
    </a>
  `;
  document.body.appendChild(_indicator);
  _clockHour = _indicator.querySelector('.wp-tm-hand-hour');
  _clockMin = _indicator.querySelector('.wp-tm-hand-min');
  _clockHM = _indicator.querySelector('.wp-tm-ind-hm');
  _clockDate = _indicator.querySelector('.wp-tm-ind-date');
}

// ─────────────────────────────────────────────────────────────────────────
// Orologio analogico — rotazione SEMPRE nel verso del tempo
//
// BUG FIX (segnalato due volte dall'utente: "le lancette saltano invece di
// girare in senso orario", poi "continuano a saltare, vorrei desse l'idea
// del correre del tempo"). Due cause distinte, entrambe risolte qui:
//
// 1. Angolo riportato in [0,360). La transizione CSS interpola i due valori
//    NUMERICAMENTE: da 354° a 0° (minuto 59 -> 00) anima all'indietro di
//    354° invece che avanti di 6°. Risolto tenendo un angolo CONTINUO,
//    accumulato, che può superare i 360° (rotate() accetta 725° senza
//    problemi).
// 2. Percorso più breve (±180°). Era il rimedio del primo giro, ma resta
//    "a scatti": un avanzamento di 50 minuti di gioco è più breve percorso
//    ALL'INDIETRO (-60°), quindi la lancetta tornava comunque indietro pur
//    andando avanti nel tempo. Ora il verso della rotazione lo decide il
//    SEGNO dell'avanzamento temporale, non la distanza angolare: tempo che
//    avanza = lancette sempre orarie, tempo che torna indietro (slider
//    trascinato a sinistra) = sempre antiorarie.
//
// "Idea del correre del tempo" sui salti: per un balzo di ore/giorni non
// basta la posizione finale — si aggiungono GIRI INTERI extra proporzionali
// al tempo saltato (fino a un tetto, altrimenti un salto di un anno
// vorrebbe 8760 giri) e si allunga la durata della transizione, così la
// lancetta si vede vorticare prima di fermarsi. Durante il playback
// continuo, invece, gli aggiornamenti arrivano ogni ~150ms: lì i giri extra
// sono soppressi (CLOCK_DENSE_MS) — la lancetta gira già da sé ad ogni
// frame, aggiungerne altri la trasformerebbe in una macchia e la
// accumulerebbe sempre più in ritardo sulla posizione reale.
// ─────────────────────────────────────────────────────────────────────────
const CLOCK_DENSE_MS = 260;        // sotto questa distanza REALE fra due update = playback continuo, non un salto
const CLOCK_MAX_EXTRA_MIN = 2;     // giri interi extra massimi, lancetta dei minuti
const CLOCK_MAX_EXTRA_HOUR = 1;    // idem, lancetta delle ore (12h a giro, ne bastano meno)

let _clockHourAng = 0, _clockMinAng = 0;
let _clockLastTs = null;       // istante di GIOCO dell'ultimo frame mostrato
let _clockLastUpdateAt = 0;    // Date.now() REALE dell'ultimo aggiornamento

// Nuovo angolo continuo per una lancetta: raggiunge `targetDeg` (posizione
// 0-360 sul quadrante) muovendosi SOLO nel verso `dir`, più `extraTurns`
// giri interi nello stesso verso.
function _handAngle(curAng, targetDeg, dir, extraTurns) {
  // Quanto manca al bersaglio andando in avanti: sempre in [0,360).
  const fwd = (((targetDeg - curAng) % 360) + 360) % 360;
  // Andando indietro: lo stesso punto, ma raggiunto in senso antiorario.
  const base = dir >= 0 ? fwd : (fwd === 0 ? 0 : fwd - 360);
  return curAng + base + extraTurns * 360 * (dir >= 0 ? 1 : -1);
}

function _updateClock(ts) {
  if (!_clockHour) return;
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  const targetMin = m * 6;                     // 360/60
  const targetHour = (h % 12) * 30 + m * 0.5;  // 360/12 + drift al minuto

  const now = Date.now();
  const dense = (now - _clockLastUpdateAt) < CLOCK_DENSE_MS;
  const deltaMs = _clockLastTs == null ? 0 : ts - _clockLastTs;
  const dir = deltaMs < 0 ? -1 : 1;
  const jumpedMs = Math.abs(deltaMs);
  _clockLastTs = ts;
  _clockLastUpdateAt = now;

  // Giri "pieni" che quel salto vale davvero per ciascuna lancetta (un giro
  // = 1h per i minuti, 12h per le ore), tagliati al tetto.
  const extraMin = dense ? 0 : Math.min(Math.floor(jumpedMs / 3600000), CLOCK_MAX_EXTRA_MIN);
  const extraHour = dense ? 0 : Math.min(Math.floor(jumpedMs / (12 * 3600000)), CLOCK_MAX_EXTRA_HOUR);

  const nextMin = _handAngle(_clockMinAng, targetMin, dir, extraMin);
  const nextHour = _handAngle(_clockHourAng, targetHour, dir, extraHour);

  // Durata proporzionale a quanto c'è da percorrere (ma limitata): un
  // aggiustamento di pochi gradi resta immediato, un vortice di due giri si
  // prende il tempo di farsi vedere. In playback resta corta e fissa, per
  // non accumulare ritardo sul tick successivo.
  const spin = Math.max(Math.abs(nextMin - _clockMinAng), Math.abs(nextHour - _clockHourAng));
  const durSec = dense ? 0.15 : Math.min(0.25 + (spin / 360) * 0.32, 1.2);
  _clockMin.style.transitionDuration = `${durSec}s`;
  _clockHour.style.transitionDuration = `${durSec}s`;

  _clockMinAng = nextMin;
  _clockHourAng = nextHour;
  _clockMin.setAttribute('transform', `rotate(${_clockMinAng} 50 50)`);
  _clockHour.setAttribute('transform', `rotate(${_clockHourAng} 50 50)`);
  _clockHM.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  _clockDate.textContent = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────
// Classifica territorio ("hall of fame" + lista regioni): nazioni ordinate
// per numero di regioni possedute NELL'ISTANTE mostrato. Podio top-3 in
// cima, poi la lista completa. Si aggiorna ad ogni frame applicato (vedi
// _fetchAndRender) — dati già in memoria (_lastRegions + state.nationMap),
// nessuna fetch. Toggle 🏆 nella barra controlli (di default aperta su
// desktop, chiusa su mobile).
// ─────────────────────────────────────────────────────────────────────────
function _buildStandingsIfNeeded() {
  if (_standings) return;
  _standings = document.createElement('div');
  _standings.id = 'wp-tm-standings';
  _standings.innerHTML = `
    <div class="wp-tm-st-title">🏆 <span data-i18n="tm_hall_of_fame">${t('tm_hall_of_fame')}</span></div>
    <div class="wp-tm-st-list"></div>
    <div class="wp-tm-day-battles"></div>
  `;
  document.body.appendChild(_standings);
  _standingsList = _standings.querySelector('.wp-tm-st-list');
  _dayBattlesEl = _standings.querySelector('.wp-tm-day-battles');
}

function _flagImg(nation) {
  const code = nation?.code?.toLowerCase();
  return code ? `<img class="wp-tm-st-flag" src="https://media.warera.io/images/flags/${code}.svg?v=16" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>` : '<span class="wp-tm-st-flag"></span>';
}

function _updateStandings(regionsMap) {
  if (!_standings || !_standingsList || !regionsMap) return;
  const counts = new Map();
  for (const rid in regionsMap) {
    const cid = regionsMap[rid];
    if (cid) counts.set(cid, (counts.get(cid) || 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([cid, n]) => ({ cid, n, nation: state.nationMap.get(cid) }))
    .sort((a, b) => b.n - a.n);
  if (!rows.length) { _standingsList.innerHTML = '<div class="wp-tm-st-empty">—</div>'; return; }
  const max = rows[0].n || 1;
  const medal = ['🥇', '🥈', '🥉'];

  const podium = rows.slice(0, 3).map((r, i) => `
    <div class="wp-tm-st-podium-item wp-tm-st-p${i + 1}">
      <div class="wp-tm-st-medal">${medal[i]}</div>
      ${_flagImg(r.nation)}
      <div class="wp-tm-st-pname">${escapeHtml(r.nation?.name || '—')}</div>
      <div class="wp-tm-st-pcount">${r.n}</div>
    </div>`).join('');

  const list = rows.map((r, i) => `
    <div class="wp-tm-st-row">
      <span class="wp-tm-st-rank">${i + 1}</span>
      <span class="wp-tm-st-dot" style="background:${state.nationBaseColorMap.get(r.cid) || '#888'}"></span>
      ${_flagImg(r.nation)}
      <span class="wp-tm-st-name">${escapeHtml(r.nation?.name || String(r.cid))}</span>
      <span class="wp-tm-st-bar"><span class="wp-tm-st-fill" style="width:${(r.n / max * 100).toFixed(1)}%;background:${state.nationBaseColorMap.get(r.cid) || '#58a6ff'}"></span></span>
      <span class="wp-tm-st-count">${r.n}</span>
    </div>`).join('');

  _standingsList.innerHTML = `<div class="wp-tm-st-podium">${podium}</div>${list}`;
}

/* Le battaglie APERTE quel giorno, sotto la classifica del territorio.
   Non e' l'archivio battaglie (quello ha danno, taglie e contratti, e sta
   in Approfondimenti): qui c'e' "chi stava combattendo chi", che e' la
   domanda che viene guardando la mappa di un giorno passato.

   Le due meta' della serie portano colonne diverse — i giorni importati
   hanno i colpi, i nostri scatti il danno — quindi si mostra quello che la
   riga ha davvero, e il resto non si scrive. */
const DAY_BATTLES_TOP = 8;

function _updateDayBattles(giorno) {
  if (!_dayBattlesEl) return;
  const dati = cachedDay(giorno);

  // Mai chiesto o server che non ce l'ha: nessuna sezione. Un blocco
  // vuoto direbbe "quel giorno non si combatteva".
  if (dati === undefined || dati === null || !dati.battles) { _dayBattlesEl.innerHTML = ''; return; }

  const titolo = `<div class="wp-tm-st-title wp-tm-db-title">⚔️ <span>${escapeHtml(t('tm_day_battles'))}</span></div>`;

  if (fuoriPortata(dati, giorno, 'battles')) {
    _dayBattlesEl.innerHTML = `${titolo}<div class="wp-tm-st-empty">${escapeHtml(t('tm_day_out_of_range'))}</div>`;
    return;
  }
  if (!dati.battles.length) {
    _dayBattlesEl.innerHTML = `${titolo}<div class="wp-tm-st-empty">${escapeHtml(t('tm_day_no_battles'))}</div>`;
    return;
  }

  const bandiera = (code) => (code
    ? `<img class="wp-tm-st-flag" src="https://media.warera.io/images/flags/${escapeHtml(code)}.svg?v=16" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
    : '<span class="wp-tm-st-flag"></span>');

  // Per colpi quando ci sono (giorni importati), per danno totale quando
  // invece c'e' quello (scatti nostri): due ordinamenti per due meta', ma
  // la domanda e' la stessa — quale battaglia contava di piu'.
  const peso = (b) => b.hits ?? ((b.attackerDamage || 0) + (b.defenderDamage || 0));
  const ordinate = [...dati.battles].sort((a, b) => peso(b) - peso(a));
  const mostrate = ordinate.slice(0, DAY_BATTLES_TOP);

  const righe = mostrate.map(b => {
    const numero = b.hits != null
      ? `<span class="wp-tm-db-num">${_fmtCompatto(b.hits)} <span class="wp-tm-db-unit">${escapeHtml(t('tm_day_hits'))}</span></span>`
      : (peso(b) > 0 ? `<span class="wp-tm-db-num">${_fmtCompatto(peso(b))} <span class="wp-tm-db-unit">${escapeHtml(t('tm_day_damage'))}</span></span>` : '');
    return `
      <div class="wp-tm-db-row">
        <span class="wp-tm-db-side">${bandiera(b.attackerCode)}<span class="wp-tm-db-name">${escapeHtml(b.attackerName || '—')}</span></span>
        <span class="wp-tm-db-vs">→</span>
        <span class="wp-tm-db-side">${bandiera(b.defenderCode)}<span class="wp-tm-db-name">${escapeHtml(b.defenderName || '—')}</span></span>
        ${numero}
      </div>`;
  }).join('');

  const resto = ordinate.length > mostrate.length
    ? `<div class="wp-tm-st-empty">+${ordinate.length - mostrate.length}</div>`
    : '';
  _dayBattlesEl.innerHTML = `${titolo}<div class="wp-tm-db-count">${ordinate.length}</div>${righe}${resto}`;
}

/** Migliaia e milioni accorciati: i colpi di una battaglia grossa sono
 *  cinque cifre, e qui la colonna e' stretta. */
function _fmtCompatto(v) {
  const n = Number(v) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

function _applyStandingsVisibility() {
  if (_standings) _standings.classList.toggle('open', _standingsVisible);
  if (_standingsBtn) _standingsBtn.classList.toggle('wp-tm-btn-active', _standingsVisible);
}
function _toggleStandings() {
  _standingsVisible = !_standingsVisible;
  _applyStandingsVisibility();
  trackEvent('time-machine-standings-toggle', { visible: _standingsVisible });
}

// ─────────────────────────────────────────────────────────────────────────
// Playback (play/pausa + velocità 1x-3x, in giorni/secondo reali).
//
// L'avanzamento NON è un passo fisso per tick, ma è calcolato sul TEMPO
// REALE trascorso dall'ultimo frame applicato (`elapsedMs`) — `giorni
// avanzati = secondi reali trascorsi × velocità`. Così la velocità
// dichiarata (1x = 1 giorno/sec, 2x = 2, 3x = 3) è rispettata IN MEDIA a
// prescindere da quanto ci mette il rendering di ogni singolo passo: un
// frame lento produce solo un salto più grande al giro dopo, non un
// rallentamento della velocità dichiarata. Il loop si ripianifica da sé
// con setTimeout SOLO dopo che il frame precedente si è risolto (mai più
// di una fetch in volo), e _fetchAndRender scarta le risposte "superate"
// (vedi _applyToken) — così anche se una fetch è più lenta del previsto
// non si accumulano rendering fuori ordine né si vede il playback
// "continuare da solo" dopo aver premuto pausa.
// ─────────────────────────────────────────────────────────────────────────
function _togglePlay() {
  if (_playing) _stopPlay();
  else _startPlay();
}

function _startPlay() {
  if (!_range || _playing) return;
  _playing = true;
  _playBtn.textContent = '⏸';
  _playBtn.title = t('tm_pause');
  _playBtn.setAttribute('aria-label', t('tm_pause'));
  _playBtn.dataset.i18nTitle = 'tm_pause';
  _playBtn.dataset.i18nAria = 'tm_pause';
  // Se siamo già alla fine, ripartire da capo è più utile che restare fermi.
  if (Number(_slider.value) >= _range.max) _slider.value = String(_range.min);
  // Azzerato: il primissimo tick non deve "recuperare" il tempo passato da
  // PRIMA di premere play (userebbe un intervallo enorme se non fosse null).
  _playLastTickAt = null;
  _playLoop();
}

function _stopPlay() {
  if (_playTimer) clearTimeout(_playTimer);
  _playTimer = null;
  if (!_playing) return;
  _playing = false;
  if (_playBtn) {
    _playBtn.textContent = '▶';
    _playBtn.title = t('tm_play');
    _playBtn.setAttribute('aria-label', t('tm_play'));
    _playBtn.dataset.i18nTitle = 'tm_play';
    _playBtn.dataset.i18nAria = 'tm_play';
  }
}

async function _playLoop() {
  if (!_playing) return;
  const now = Date.now();
  const elapsedMs = _playLastTickAt ? (now - _playLastTickAt) : PLAY_TICK_MS;
  _playLastTickAt = now;

  const cur = Number(_slider.value);
  const advanceMs = (elapsedMs / 1000) * PLAY_SPEEDS[_speedIdx] * STEP_MS;
  const next = cur + advanceMs;
  const atEnd = next >= _range.max;
  const target = atEnd ? _range.max : next;

  const rendered = await _fetchAndRender(target);
  // Slider/label/giorno si spostano SOLO se e quando il rendering è
  // realmente arrivato: la posizione visibile avanza alla vera velocità
  // del rendering, mai prima. Se la fetch fallisce/viene superata
  // (rendered:false), non si avanza — il prossimo tick riparte dalla
  // stessa posizione invece di saltarla.
  if (rendered) {
    _slider.value = String(target);
    _label.textContent = _fmtDate(target);
    _dayLabel.textContent = _fmtDay(target);
    _updateClock(target);
    _syncUrl(target);
  }
  if (atEnd) { _stopPlay(); return; }
  if (!_playing) return; // l'utente può aver premuto pausa MENTRE aspettavamo la fetch
  _playTimer = setTimeout(_playLoop, PLAY_TICK_MS);
}

function _cycleSpeed() {
  _speedIdx = (_speedIdx + 1) % PLAY_SPEEDS.length;
  _speedBtn.textContent = `${PLAY_SPEEDS[_speedIdx]}x`;
}

// ─────────────────────────────────────────────────────────────────────────
// Frecce tastiera (±1 giorno) e barra spaziatrice (play/pausa) — solo
// mentre la time machine è attiva (listener aggiunto/rimosso in
// _activate/_deactivate) e solo se il focus non è su un campo di testo
// altrove nell'app (es. "Cerca nazione…"), per non rubargli i tasti. La
// mappa dedicata è creata con `keyboard:false` (timeMachineMap.js), quindi
// non c'è più un gestore tastiera concorrente che pana la mappa sotto i
// piedi di queste frecce.
// ─────────────────────────────────────────────────────────────────────────
function _onKeydown(e) {
  const ae = document.activeElement;
  if (ae && ae.tagName === 'INPUT' && ae.type === 'text') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); _stopPlay(); _stepBy(-STEP_MS); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); _stopPlay(); _stepBy(STEP_MS); }
  else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); _togglePlay(); }
  else if (e.key === 'Escape' && _focusId) { e.preventDefault(); _clearFocus(); }
}

function _stepBy(deltaMs) {
  if (!_range) return;
  clearTimeout(_debounceTimer); // niente apply "vecchio" in debounce che sovrascrive questo più recente
  const next = Math.min(Math.max(Number(_slider.value) + deltaMs, _range.min), _range.max);
  _slider.value = String(next);
  _applyAt(next);
}

// ─────────────────────────────────────────────────────────────────────────
// Eventi: caricati UNA volta per sessione (vedi commento su _eventTsSorted
// in testa al file), abilitano prossimo/precedente e il "dal —" nel popup.
// ─────────────────────────────────────────────────────────────────────────
async function _loadEvents() {
  try {
    const events = (await fetchRegionHistoryEventsViaCache(_range.min, _range.max))
      .slice()
      .sort((a, b) => a.ts - b.ts);
    _eventTsSorted = events.map(e => e.ts);
    _eventsByRegion = new Map();
    for (const e of events) {
      if (!_eventsByRegion.has(e.regionId)) _eventsByRegion.set(e.regionId, []);
      _eventsByRegion.get(e.regionId).push(e);
    }
    if (_prevEventBtn) _prevEventBtn.disabled = false;
    if (_nextEventBtn) _nextEventBtn.disabled = false;
  } catch (err) {
    console.warn('WarEra+ time machine: eventi non disponibili (salto evento/"dal —" disattivati):', err.message);
  }
}

function _jumpToEvent(dir) {
  if (!_eventTsSorted?.length) return;
  _stopPlay();
  clearTimeout(_debounceTimer);
  const cur = Number(_slider.value);
  let target;
  if (dir > 0) {
    target = _eventTsSorted.find(ts => ts > cur);
  } else {
    for (let i = _eventTsSorted.length - 1; i >= 0; i--) {
      if (_eventTsSorted[i] < cur) { target = _eventTsSorted[i]; break; }
    }
  }
  if (target === undefined) return; // già al primo/ultimo evento noto
  _slider.value = String(target);
  _applyAt(target);
  trackEvent('time-machine-jump-event', { direction: dir > 0 ? 'next' : 'prev' });
}

// Nazione che deteneva `regionId` più di recente, a `ts` o prima — null se
// _eventsByRegion non è (ancora) disponibile, `_range.min` se non risulta
// nessun trasferimento noto per quella regione (la possiede dalla genesi).
function _ownedSince(regionId, ts) {
  if (!regionId || !_eventsByRegion || !_range) return null;
  const evs = _eventsByRegion.get(regionId);
  if (!evs?.length) return _range.min;
  let since = _range.min;
  for (const e of evs) {
    if (e.ts > ts) break;
    since = e.ts;
  }
  return since;
}

// ─────────────────────────────────────────────────────────────────────────
// Deep-link condivisibile (?tm=<epoch ms>) — sincronizzato ad ogni
// posizione applicata, rimosso alla chiusura (vedi _deactivate). replaceState
// (non pushState): muovere lo slider non deve riempire la cronologia del
// browser di una entry per pixel trascinato.
// ─────────────────────────────────────────────────────────────────────────
function _syncUrl(ts) {
  const url = new URL(window.location.href);
  url.searchParams.set('tm', String(Math.round(ts)));
  history.replaceState(null, '', url);
}

function _clearUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('tm')) return;
  url.searchParams.delete('tm');
  history.replaceState(null, '', url);
}

// _applyToken: ogni chiamata a _fetchAndRender si prende un numero
// incrementale, e scarta il proprio risultato se nel frattempo ne è
// partita una più recente (arrivata prima o dopo non importa: quello che
// conta è "sono ancora l'ultima richiesta partita?").
let _applyToken = 0;

// Nucleo: fetch + rendering sulla mappa dedicata, SENZA toccare
// slider/label/URL — il chiamante decide QUANDO riflettere la nuova
// posizione nell'interfaccia (vedi _applyAt sotto per l'uso interattivo,
// _playLoop per l'autoplay). Ritorna true se il rendering è stato
// applicato, false se scartato (superato o fetch fallita).
async function _fetchAndRender(ts) {
  const token = ++_applyToken;
  try {
    const { regions } = await fetchRegionHistoryAtViaCache(ts);
    if (token !== _applyToken) return false; // superata da una richiesta più recente, scartata
    _lastRegions = regions;
    renderTimeMachineFrame(regions, _buildLabelEntries(regions));
    _updateStandings(regions);
    _updateFocus(ts);
    return true;
  } catch (err) {
    console.warn('WarEra+ time machine: ricostruzione fallita:', err.message);
    _notifyHistoryError();
    return false;
  }
}

// BUG FIX (segnalato dall'utente: col server di cache giù la time machine
// resta "de facto inutilizzabile" e NON esce alcun errore). Lo storico
// regioni è calcolato solo dal server di cache (nessun fallback diretto
// possibile, vedi cacheClient.js): quando risponde a metà (es. nginx serve un
// /range stale ma /at fallisce) la mappa restava vuota senza segnale. Qui un
// toast visibile, throttlato per non spammare durante il playback/scrub.
let _lastErrorToastAt = 0;
function _notifyHistoryError() {
  const now = Date.now();
  if (now - _lastErrorToastAt < 8000) return;
  _lastErrorToastAt = now;
  showToast(t('tm_server_offline'), 'warning');
}

// Uso interattivo (trascinamento/frecce/salto evento/deep-link): riflette
// SUBITO la nuova posizione nell'interfaccia (slider/label/URL) — per un
// singolo movimento lo scarto rispetto al rendering (che arriva un attimo
// dopo, via fetch) è impercettibile, esattamente come uno slider normale.
async function _applyAt(ts) {
  _label.textContent = _fmtDate(ts);
  _dayLabel.textContent = _fmtDay(ts);
  _syncDateInput(ts);
  _updateClock(ts);
  _syncUrl(ts);
  _scheduleDay(ts);
  return await _fetchAndRender(ts);
}

// ─────────────────────────────────────────────────────────────────────────
// La giornata storica (patti, guerre, nemico giurato, battaglie aperte).
//
// UNA fetch per giorno FERMATO, mai una per fotogramma: durante un playback
// lo slider attraversa centocinquanta giorni, e il pannello che questi dati
// riempiono nessuno lo legge mentre scorre. Quindi niente durante il play, e
// mezzo secondo di quiete dopo un trascinamento.
// ─────────────────────────────────────────────────────────────────────────
const DAY_DEBOUNCE_MS = 500;

function _scheduleDay(ts) {
  const giorno = dayKey(ts);
  if (giorno === _dayShown && cachedDay(giorno) !== undefined) { _renderDay(giorno); return; }
  clearTimeout(_dayTimer);
  if (_playing) return;
  _dayTimer = setTimeout(() => {
    if (!_active) return;
    _dayShown = giorno;
    // Quello che c'e' gia' si disegna subito; il resto quando arriva, e
    // solo se nel frattempo l'utente non si e' spostato altrove.
    _renderDay(giorno);
    fetchDay(giorno).then(() => { if (_active && _dayShown === giorno) _renderDay(giorno); });
  }, DAY_DEBOUNCE_MS);
}

function _renderDay(giorno) {
  _updateDayBattles(giorno);
  // Nazione selezionata: si riempie da se' quando i dati arrivano, senza
  // chiedere all'utente di ricliccare.
  if (_focusId && dayKey(Number(_slider.value)) === giorno) _updateFocus(Number(_slider.value));
}

// ─────────────────────────────────────────────────────────────────────────
// Etichette: dove cade ciascuna (regionId sotto al punto fisso della
// label) si calcola UNA SOLA VOLTA per sessione (posizione fissa, non
// cambia mai) — poi ad ogni mossa dello slider basta un lookup O(1) per
// sapere quale nazione mostrare in quel punto. A differenza della vecchia
// versione, questa NON muta più state.labelsData (che appartiene alla
// mappa principale, mai toccata ora): produce un array indipendente che
// timeMachineMap.js si limita a disegnare sul proprio canvas dedicato —
// niente più backup/ripristino alla chiusura.
// ─────────────────────────────────────────────────────────────────────────
function _pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function _pointInPolygon(pt, rings) {
  // rings[0] = contorno esterno, i successivi = buchi (regola even-odd: un
  // punto dentro un buco esce fuori dalla forma).
  let inside = false;
  for (const ring of rings) if (_pointInRing(pt, ring)) inside = !inside;
  return inside;
}
function _pointInFeature(pt, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return _pointInPolygon(pt, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(poly => _pointInPolygon(pt, poly));
  return false;
}

function _ensureLabelRegionMap() {
  if (_labelRegionId || !state.labelsData?.length || !state.baseGeoJSON?.features) return;
  _labelRegionId = new Map();

  // Raggruppa le regioni per countryId ATTUALE una sola volta — ogni label
  // si trova per costruzione dentro il territorio OGGI del proprio paese,
  // quindi basta testare contro le (poche) regioni di QUEL paese invece che
  // contro tutte le migliaia di regioni del mondo.
  const regionsByCountry = new Map();
  state.baseGeoJSON.features.forEach(f => {
    const cId = f.properties?.countryId;
    if (!cId) return;
    if (!regionsByCountry.has(cId)) regionsByCountry.set(cId, []);
    regionsByCountry.get(cId).push(f);
  });

  state.labelsData.forEach((label, idx) => {
    const cId = label.properties?.countryId;
    const pt = label.coordinates;
    if (!cId || !pt) return;
    const candidates = regionsByCountry.get(cId) || [];
    const hit = candidates.find(f => _pointInFeature(pt, f.geometry));
    if (hit?.properties?.regionId) _labelRegionId.set(idx, hit.properties.regionId);
  });
}

// BUG FIX (segnalato dall'utente: "nella time machine i nomi delle nazioni
// risultano più scuri rispetto alla mappa base"). Qui si usava
// state.nationBaseColorMap come colore del TESTO, ma quello è il colore di
// RIEMPIMENTO del poligono: è pensato per stare sotto a un'etichetta, non
// per essere l'etichetta. La mappa base infatti disegna i nomi con
// `label.properties.textColor` (vedi labels.js:drawLabels), che è una
// versione schiarita dello stesso colore. Misurato su 188 label:
// luminanza media 190 per textColor contro 43 per il colore base — 4,4
// volte più scuro, esattamente lo scarto che si vedeva.
//
// Il textColor però appartiene alla nazione che possiede quel punto OGGI:
// per un istante storico in cui la regione era di qualcun altro serve il
// textColor di QUELLA nazione. Si costruisce quindi una volta sola una
// mappa countryId -> textColor leggendola dalle label esistenti (ogni
// nazione ne ha almeno una), e per le poche nazioni che non compaiono in
// nessuna label si schiarisce il colore base fino alla stessa luminanza
// che la mappa base usa per il testo.
const LABEL_TARGET_LUM = 190; // luminanza media misurata sui textColor della mappa base
let _textColorByCountry = null;

function _lightenForText(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum >= LABEL_TARGET_LUM) return hex;
  // Mix verso il bianco: mantiene la tinta (quindi la nazione resta
  // riconoscibile) e alza solo la luminosità fino al bersaglio.
  const k = (LABEL_TARGET_LUM - lum) / (255 - lum);
  r = Math.round(r + (255 - r) * k);
  g = Math.round(g + (255 - g) * k);
  b = Math.round(b + (255 - b) * k);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function _ensureTextColorMap() {
  if (_textColorByCountry) return;
  _textColorByCountry = new Map();
  for (const label of state.labelsData || []) {
    const id = label.properties?.countryId;
    const color = label.properties?.textColor;
    if (id && color && !_textColorByCountry.has(id)) _textColorByCountry.set(id, color);
  }
}

// Ritorna [{ coordinates, countryName, textColor }] per il frame corrente
// — sola lettura di state.labelsData, nessuna mutazione.
function _buildLabelEntries(regionsMap) {
  _ensureLabelRegionMap();
  _ensureTextColorMap();
  if (!_labelRegionId || !state.labelsData?.length) return [];

  return state.labelsData.map((label, idx) => {
    const regionId = _labelRegionId.get(idx);
    const fallbackCountryId = label.properties.countryId;
    const historicalCountryId = regionId && Object.prototype.hasOwnProperty.call(regionsMap, regionId)
      ? regionsMap[regionId]
      : fallbackCountryId; // punto non ricadeva in nessuna regione nota (raro): resta il dato live
    const nation = state.nationMap.get(historicalCountryId);
    const textColor = _textColorByCountry.get(historicalCountryId)
      || _lightenForText(state.nationBaseColorMap.get(historicalCountryId))
      || label.properties.textColor;
    return {
      coordinates: label.coordinates,
      countryName: nation?.name || label.properties.countryName,
      textColor,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// WarEra+ — La nazione selezionata (richiesta dell'utente: «cliccando sulla
// nazione mi dia i dati che ho in quel giorno, e la diplomazia relativa, in
// modo che posso vedere la diplomazia cambiare mentre il tempo va avanti»).
//
// Prima era un popup attaccato al punto cliccato, che si chiudeva a ogni
// mossa dello slider: andava bene per UN giorno fermo, non per guardare una
// nazione attraverso il tempo. Ora un click SELEZIONA: una scheda fissa in
// basso a sinistra segue la nazione giorno dopo giorno (playback compreso),
// e la mappa si ricolora sulla sua diplomazia di quel giorno — la vedi
// cambiare mentre il tempo scorre. Click sul mare, ✕ o Esc la deselezionano.
//
// Costo: la giornata storica (/day-history, 7-15 KB gzip) si chiede anche
// durante il play, ma SOLO con una nazione selezionata, con tre giorni di
// anticipo, e senza che il playback aspetti mai la rete. Senza selezione
// resta la regola di prima: una fetch per giorno fermato.
//
// Finché il giorno nuovo non è arrivato la mappa tiene i colori del giorno
// prima invece di spegnersi: un lampo grigio a ogni giorno si leggerebbe
// come "ha perso tutti gli alleati".
// ─────────────────────────────────────────────────────────────────────────
let _focusEl = null;
let _focusId = null;      // countryId selezionato
let _focusRegion = null;  // regione cliccata, per la riga "sua dal —"
const DAY_MS = 24 * 60 * 60 * 1000;
const PREFETCH_DAYS = 3;

function _onHistoricalClick(e) {
  if (!e.features?.length || !_lastRegions) return;
  const regionId = e.features[0].properties?.regionId;
  const countryId = regionId ? _lastRegions[regionId] : null;
  if (!countryId || !state.nationMap.get(countryId)) { _clearFocus(); return; }
  _setFocus(countryId, regionId);
}

function _setFocus(countryId, regionId = null) {
  _focusId = countryId;
  _focusRegion = regionId;
  trackEvent('time-machine-focus');
  _updateFocus(Number(_slider.value));
  // Le alleanze arrivano con una fetch per sessione (vedi
  // timeMachineAlliances.js): alla prima selezione, e poi si ridisegna.
  loadAllianceHistory().then(ok => { if (ok && _focusId) _updateFocus(Number(_slider.value)); });
}

function _clearFocus() {
  _focusId = null;
  _focusRegion = null;
  if (_focusEl) _focusEl.classList.remove('visible');
  document.body.classList.remove('wp-tm-has-focus');
  setTimeMachineFocus(null);
}

/** Chiamata a ogni fotogramma applicato (_fetchAndRender) e quando arriva
 *  un giorno: aggiorna scheda e colori per l'istante `ts`. */
function _updateFocus(ts) {
  if (!_focusId || !_active) return;
  const giorno = dayKey(ts);
  const dati = cachedDay(giorno);
  if (dati === undefined) {
    fetchDay(giorno).then(() => {
      if (_focusId && dayKey(Number(_slider.value)) === giorno) _updateFocus(Number(_slider.value));
    });
  }
  if (_playing) {
    for (let k = 1; k <= PREFETCH_DAYS; k++) {
      const g = dayKey(ts + k * DAY_MS);
      if (cachedDay(g) === undefined) fetchDay(g);
    }
  }

  const fuori = dati && fuoriPortata(dati, giorno);
  const d = !fuori ? dati?.diplomacy?.get(_focusId) : null;
  // Le alleanze hanno il loro registro, completo dal lancio del gioco:
  // valgono anche prima dell'archivio della diplomazia (13 aprile 2026).
  const al = alliancesAt(_focusId, ts);
  const alleati = al?.tipo === 'blocco' ? (al.membri || []) : (al?.alleati || []);
  const coloreAlleati = al?.tipo === 'blocco' ? BORDER_COLORS.ALLIANCE : COLORS.ALLY_DIRECT;
  const base = { self: _focusId, allies: alleati, alliesColor: coloreAlleati };
  if (d) setTimeMachineFocus({ ...base, wars: d.wars, pacts: d.pacts, sworn: d.sworn });
  else if (dati !== undefined) setTimeMachineFocus(base);
  // dati === undefined: si tengono i colori del giorno prima (vedi testa).

  _renderFocus(ts, giorno, dati, d, fuori, al);
}

/** Bandiera + nome, cliccabile: seleziona quella nazione. */
function _chip(countryId) {
  const n = state.nationMap.get(countryId);
  const code = n?.code?.toLowerCase();
  const flag = code ? `<img src="https://media.warera.io/images/flags/${code}.svg?v=16" alt="" />` : '';
  return `<button type="button" class="wp-tm-focus-chip" data-cid="${escapeHtml(countryId)}">${flag}${escapeHtml(_nomeDi(countryId))}</button>`;
}

function _gruppo(label, ids, colore, vuoto = '') {
  if (!ids?.length && !vuoto) return '';
  const corpo = ids?.length
    ? `<div class="wp-tm-focus-chips">${ids.map(_chip).join('')}</div>`
    : `<div class="wp-tm-focus-dim">${escapeHtml(vuoto)}</div>`;
  return `<div class="wp-tm-focus-group">
      <div class="wp-tm-focus-lab"><span class="wp-tm-focus-dot" style="background:${colore}"></span>${escapeHtml(label)}${ids?.length ? ` · ${ids.length}` : ''}</div>
      ${corpo}
    </div>`;
}

function _renderFocus(ts, giorno, dati, d, fuori, al) {
  if (!_focusEl) {
    _focusEl = document.createElement('div');
    _focusEl.id = 'wp-tm-focus';
    _focusEl.addEventListener('click', (ev) => {
      if (ev.target.closest('.wp-tm-focus-close')) { _clearFocus(); return; }
      const chip = ev.target.closest('.wp-tm-focus-chip');
      if (chip?.dataset.cid) _setFocus(chip.dataset.cid);
    });
    document.body.appendChild(_focusEl);
  }
  const nation = state.nationMap.get(_focusId);
  const code = nation?.code?.toLowerCase();
  const flag = code ? `<img class="wp-tm-popup-flag" src="https://media.warera.io/images/flags/${code}.svg?v=16" alt="" />` : '';

  // Quante regioni aveva IN QUEL MOMENTO: dall'ownership del fotogramma.
  let regioni = 0;
  for (const cid of Object.values(_lastRegions || {})) if (cid === _focusId) regioni += 1;

  // "Sua dal —" solo se la regione cliccata e' ancora sua in questo istante.
  let sinceHtml = '';
  if (_focusRegion && _lastRegions?.[_focusRegion] === _focusId) {
    const since = _ownedSince(_focusRegion, ts);
    const nomeReg = state.regionData?.[_focusRegion]?.name;
    if (since != null) sinceHtml = `<div class="wp-tm-focus-dim">${nomeReg ? `${escapeHtml(nomeReg)} · ` : ''}${escapeHtml(t('tm_since', { date: _fmtDate(since) }))}</div>`;
  }

  const stats = [`<span><strong>${regioni}</strong> ${escapeHtml(t('tm_focus_regions'))}</span>`];
  if (d?.wealth != null) stats.push(`<span><strong>${_fmtCompatto(d.wealth)}</strong> ${escapeHtml(t('tm_focus_treasury'))}</span>`);

  // L'alleanza, nella forma del sistema in vigore quel giorno. Senza dati
  // (server vecchio, o prima del lancio del gioco) la sezione non c'e'.
  let allHtml = '';
  if (al?.tipo === 'blocco') {
    if (!al.id) allHtml = _gruppo(t('tm_focus_alliance'), [], BORDER_COLORS.ALLIANCE, t('tm_focus_no_alliance'));
    else {
      const allora = al.allora ? ` <span class="wp-tm-focus-dim">${escapeHtml(t('tm_focus_then', { name: al.allora }))}</span>` : '';
      allHtml = `<div class="wp-tm-focus-group">
          <div class="wp-tm-focus-lab"><span class="wp-tm-focus-dot" style="background:${BORDER_COLORS.ALLIANCE}"></span>${escapeHtml(t('tm_focus_alliance'))} · ${al.membri.length + 1}</div>
          <div class="wp-tm-focus-allname"><strong>${escapeHtml(al.nome || '—')}</strong>${allora}</div>
          ${al.membri.length ? `<div class="wp-tm-focus-chips">${al.membri.map(_chip).join('')}</div>` : ''}
        </div>`;
    }
  } else if (al?.tipo === 'bilaterale') {
    allHtml = _gruppo(t('tm_focus_allies'), al.alleati, COLORS.ALLY_DIRECT, t('tm_focus_no_allies'));
  }

  let dipl;
  if (fuori) dipl = `<div class="wp-tm-focus-dim">${escapeHtml(t('tm_day_out_of_range'))}</div>`;
  else if (dati === undefined) dipl = '<div class="wp-tm-focus-dim">…</div>';
  else if (!d) dipl = '';
  else {
    dipl = _gruppo(t('tm_day_wars'), d.wars, COLORS.WAR_DIRECT, t('tm_day_no_wars'))
      + _gruppo(t('tm_day_sworn'), d.sworn ? [d.sworn] : [], COLORS.SWORN_ENEMY)
      + _gruppo(t('tm_day_pacts'), d.pacts, COLORS.DEFENSIVE_PACT);
  }

  // Le battaglie aperte quel giorno in cui c'era lei, da una parte o dall'altra.
  let battHtml = '';
  if (code && dati?.battles && !fuoriPortata(dati, giorno, 'battles')) {
    const sue = dati.battles.filter(b => b.attackerCode === code || b.defenderCode === code);
    const righe = sue.slice(0, 6).map(b => {
      const attacca = b.attackerCode === code;
      const altro = attacca ? b.defenderName : b.attackerName;
      return `<div class="wp-tm-focus-batt">${attacca ? '⚔' : '🛡'} ${escapeHtml(altro || '—')}</div>`;
    }).join('');
    const resto = sue.length > 6 ? `<div class="wp-tm-focus-dim">+${sue.length - 6}</div>` : '';
    battHtml = `<div class="wp-tm-focus-group">
        <div class="wp-tm-focus-lab">${escapeHtml(t('tm_day_battles'))}${sue.length ? ` · ${sue.length}` : ''}</div>
        ${sue.length ? righe + resto : `<div class="wp-tm-focus-dim">${escapeHtml(t('tm_day_no_battles'))}</div>`}
      </div>`;
  }

  _focusEl.innerHTML = `
    <div class="wp-tm-focus-head">
      ${flag}<span class="wp-tm-popup-name">${escapeHtml(nation?.name || _focusId)}</span>
      <button type="button" class="wp-tm-focus-close" aria-label="${escapeHtml(t('tm_focus_close'))}" title="${escapeHtml(t('tm_focus_close'))}">✕</button>
    </div>
    <div class="wp-tm-focus-day">${escapeHtml(_fmtDate(ts))}</div>
    ${sinceHtml}
    <div class="wp-tm-focus-stats">${stats.join('')}</div>
    ${allHtml}
    ${dipl}
    ${battHtml}
    <div class="wp-tm-focus-hint">${escapeHtml(t('tm_focus_hint'))}</div>`;
  _focusEl.classList.add('visible');
  // Su telefono la classifica, se aperta, si accorcia per finire sopra la
  // scheda invece di esserne coperta (vedi shell.css).
  document.body.classList.add('wp-tm-has-focus');
}

/** Il nome di una nazione da un id, per le liste del popup. Se non la
 *  conosciamo resta l'id: e' brutto ma e' vero. */
function _nomeDi(countryId) {
  return state.nationMap.get(countryId)?.name || String(countryId);
}


// ─────────────────────────────────────────────────────────────────────────
// Share (📤): esporta "quel momento" come PNG — la cattura vera e propria
// (mappa + etichette, workaround preserveDrawingBuffer) vive in
// timeMachineMap.js, che possiede i due canvas; qui solo la UX di
// condivisione/download.
// ─────────────────────────────────────────────────────────────────────────
async function _shareScreenshot() {
  const canvas = await captureFrame();
  if (!canvas) { showToast(t('tm_screenshot_failed'), 'warning'); return; }

  canvas.toBlob(async (blob) => {
    if (!blob) { showToast(t('tm_screenshot_failed'), 'warning'); return; }
    const ts = Number(_slider.value);
    const filename = `warera-time-machine-${_fmtDateForFilename(ts)}.png`;
    const file = new File([blob], filename, { type: 'image/png' });
    trackEvent('time-machine-share', { method: (navigator.canShare && navigator.canShare({ files: [file] })) ? 'share-sheet' : 'download' });

    // Web Share API (mobile e alcuni desktop): apre il pannello di
    // condivisione nativo del sistema — quello che l'utente ha chiesto
    // ("un tasto share"). Se non disponibile o l'utente annulla, ricade su
    // un download diretto: la PNG resta comunque ottenuta.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'WarEra+ Time Machine', text: _fmtDate(ts) });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return; // utente ha annullato la condivisione, non è un errore
        // altro errore (raro): ricadi sul download sotto
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
