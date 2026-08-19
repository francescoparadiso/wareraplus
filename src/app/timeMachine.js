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
} from './timeMachineMap.js';
import { trackEvent } from '../shared/analytics.js';
import { t } from '../shared/i18n.js';

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

let _btn, _panel, _slider, _label, _dayLabel, _popup;
let _playBtn, _prevEventBtn, _nextEventBtn, _speedBtn, _shareBtn;
// Indicatore "sei nella time machine" (badge + orologio analogico + data) e
// classifica territorio ("hall of fame" + lista regioni per nazione).
let _indicator, _clockHour, _clockMin, _clockHM, _clockDate;
let _standings, _standingsList, _standingsBtn;
let _standingsVisible = !window.matchMedia('(max-width: 768px)').matches; // di default aperta su desktop, chiusa su mobile (poco spazio)

// Nettrix ha reso possibile lo storico della time machine (server di cache):
// una card di ringraziamento nell'indicatore linka al suo profilo.
const NETTRIX_URL = 'https://app.warera.io/user/69baf405edc9a346931b27c5';
let _active = false;
let _range = null;
let _debounceTimer = null;
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
  _hidePopup();
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

  _panel.querySelector('#wp-tm-close').addEventListener('click', _deactivate);
  _playBtn.addEventListener('click', _togglePlay);
  _prevEventBtn.addEventListener('click', () => _jumpToEvent(-1));
  _nextEventBtn.addEventListener('click', () => _jumpToEvent(1));
  _speedBtn.addEventListener('click', _cycleSpeed);
  _standingsBtn.addEventListener('click', _toggleStandings);
  _shareBtn.addEventListener('click', _shareScreenshot);

  _slider.addEventListener('input', () => {
    _stopPlay(); // trascinamento manuale = l'utente prende il controllo, ferma il playback
    const ts = Number(_slider.value);
    _label.textContent = _fmtDate(ts);
    _dayLabel.textContent = _fmtDay(ts);
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
  `;
  document.body.appendChild(_standings);
  _standingsList = _standings.querySelector('.wp-tm-st-list');
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
    _hidePopup();
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
  _updateClock(ts);
  _hidePopup();
  _syncUrl(ts);
  return await _fetchAndRender(ts);
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

function _onHistoricalClick(e) {
  if (!e.features?.length || !_lastRegions) return;
  const regionId = e.features[0].properties?.regionId;
  const countryId = regionId ? _lastRegions[regionId] : null;
  const nation = countryId ? state.nationMap.get(countryId) : null;
  const since = nation ? _ownedSince(regionId, Number(_slider.value)) : null;
  _showPopup(e.point, nation, since);
}

function _showPopup(point, nation, sinceTs) {
  if (!_popup) {
    _popup = document.createElement('div');
    _popup.id = 'wp-time-machine-popup';
    document.body.appendChild(_popup);
  }
  if (!nation) {
    _popup.innerHTML = `<span class="wp-tm-popup-name">${t('tm_no_nation')}</span>`;
  } else {
    const code = nation.code?.toLowerCase();
    const flagHtml = code ? `<img src="https://media.warera.io/images/flags/${code}.svg?v=16" alt="" class="wp-tm-popup-flag" />` : '';
    // "dal —" solo se _loadEvents() è già arrivato (sinceTs non-null) — vedi
    // _ownedSince: null significa "dato non ancora disponibile", non "sconosciuto".
    const sinceHtml = sinceTs != null
      ? `<span class="wp-tm-popup-since">${t('tm_since', { date: _fmtDate(sinceTs) })}</span>`
      : '';
    _popup.innerHTML = `
      <div class="wp-tm-popup-main">${flagHtml}<span class="wp-tm-popup-name">${escapeHtml(nation.name)}</span></div>
      ${sinceHtml}
    `;
  }
  // Il gap sopra il punto cliccato e il centraggio orizzontale li fa il
  // CSS (transform: translate(-50%, calc(-100% - 8px))) — qui solo il
  // punto esatto, in coordinate viewport (getContainer() è relativo al
  // canvas della mappa DEDICATA, non più quella principale).
  const mapContainer = getTimeMachineMap().getContainer().getBoundingClientRect();
  _popup.style.left = `${mapContainer.left + point.x}px`;
  _popup.style.top = `${mapContainer.top + point.y}px`;
  _popup.classList.add('visible');
}

function _hidePopup() {
  if (_popup) _popup.classList.remove('visible');
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
