/* ══════════════════════════════════════════════════════════════
   WarEra+ — Time machine
   ------------------------------------------------------------------
   Componente NUOVO: bottone dedicato ("🕰️", accanto agli altri controlli
   fissi in alto) che apre uno slider in basso e ricolora la mappa con
   l'ownership STORICA delle regioni a un istante passato, ricostruita dal
   server di cache (vedi cacheClient.js: fetchRegionHistoryRangeViaCache /
   fetchRegionHistoryAtViaCache — tutto il lavoro di keyframe+replay lo fa
   il server, qui c'è solo una fetch per ogni posizione dello slider).

   Scope deliberatamente ridotto (decisione esplicita): mostra SOLO
   ownership regione + nome nazione + bandiera al click. Niente
   popolazione/ricchezza/sviluppo del momento storico — quei dati non sono
   mai stati salvati nel tempo, mostrarli sarebbe fuorviante (sembrerebbero
   valori storici ma sarebbero quelli di OGGI).

   Approccio di rendering: stesso principio della bozza mai integrata
   (timeMachineUI.js) — NON tocchiamo state.baseGeoJSON, lo sostituiamo solo
   come DATO pubblicato sulla sorgente mappa (stesso layer di map.js), e lo
   ripristiniamo alla chiusura. La colorazione mentre la time machine è
   attiva è un'espressione fill-color dedicata (un colore stabile per
   nazione, state.nationBaseColorMap — nessuna relazione diplomatica: non ha
   senso mostrare "guerra/alleanza di OGGI" sovrapposta a un'epoca passata),
   applicata direttamente sul layer FUORI dal ciclo normale di renderMap()
   — alla chiusura richiamiamo renderMap() che ripristina qualunque
   modalità colore fosse attiva prima, senza che questo modulo debba
   saperne nulla.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { LAYER_IDS, THEMES } from '../diplomacy/config.js';
import { renderMap } from '../diplomacy/map.js';
import { escapeHtml, showToast } from '../diplomacy/utils.js';
import { invalidateLabelCache } from '../diplomacy/labels.js';
import {
  fetchRegionHistoryRangeViaCache,
  fetchRegionHistoryAtViaCache,
  fetchRegionHistoryEventsViaCache,
} from '../diplomacy/cacheClient.js';
import * as topojson from 'topojson-client';

const { SRC_REGIONS, SRC_BORDERS, LYR_FILL } = LAYER_IDS;

// Passo di uno "step" discreto (frecce tastiera, salto play/pausa) — un
// giorno di gioco. La velocità di riproduzione (1x-4x) moltiplica questo
// stesso passo invece di accorciare l'intervallo del timer: così il numero
// di fetch al server durante il playback non dipende dalla velocità scelta.
const STEP_MS = 24 * 60 * 60 * 1000;
const PLAY_TICK_MS = 150;
const PLAY_SPEEDS = [1, 2, 3, 4];

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

let _btn, _panel, _slider, _label, _popup;
let _playBtn, _prevEventBtn, _nextEventBtn, _speedBtn;
let _active = false;
let _range = null;
let _debounceTimer = null;
let _lastRegions = null; // { regionId: countryId } della posizione slider corrente, per il click
let _labelRegionId = null; // Map: indice in state.labelsData -> regionId "sotto" quella label (calcolato una volta, posizione fissa)
let _labelOriginal = null; // Array: { countryId, countryName, textColor, countryCode } originali, per il ripristino

// Playback (play/pausa + velocità 1x-4x)
let _playing = false;
let _playTimer = null;
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

// Se le battaglie attive sono visibili, le spegne — stesso checkbox/evento
// di src/app/battleToggle.js (unica fonte di verità), simulato qui invece
// di duplicare la logica. Marker di battaglie "live" sovrapposti a una
// mappa che mostra un'epoca passata non avrebbe senso.
function _disableBattlesIfShown() {
  const checkbox = document.getElementById('checkActiveBattles');
  if (checkbox?.checked) {
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
  }
}

async function _activate(initialTs) {
  if (!state.map || !state.baseGeoJSON) return;
  try {
    _range = await fetchRegionHistoryRangeViaCache();
  } catch (err) {
    console.warn('WarEra+ time machine: storico non disponibile:', err.message);
    showToast('Time machine non disponibile al momento', 'warning');
    return; // niente panello se il server non ha ancora nessuno storico
  }

  _active = true;
  state.timeMachineActive = true;
  _btn.classList.add('wp-time-machine-btn-active');
  _disableBattlesIfShown();
  _buildPanelIfNeeded();
  _panel.classList.add('open');
  document.addEventListener('keydown', _onKeydown);

  const startTs = Number.isFinite(initialTs)
    ? Math.min(Math.max(initialTs, _range.min), _range.max)
    : _range.max;
  _slider.min = String(_range.min);
  _slider.max = String(_range.max);
  _slider.value = String(startTs);
  await _applyAt(startTs);

  state.map.on('click', LYR_FILL, _onHistoricalClick);
  _loadEvents(); // in background, non blocca l'apertura — vedi commento sopra _eventTsSorted
}

function _deactivate() {
  _active = false;
  state.timeMachineActive = false;
  _stopPlay();
  _btn.classList.remove('wp-time-machine-btn-active');
  if (_panel) _panel.classList.remove('open');
  _hidePopup();
  document.removeEventListener('keydown', _onKeydown);
  _clearUrl();

  const src = state.map?.getSource(SRC_REGIONS);
  if (src && state.baseGeoJSON) src.setData(state.baseGeoJSON);
  _applyBorders(null); // ripristina i confini live (stessa mesh calcolata da setupMapLayers)
  _restoreLabels();
  renderMap(); // ripristina qualunque modalità colore fosse attiva prima — questo modulo non deve saperne nulla

  if (state.map) state.map.off('click', LYR_FILL, _onHistoricalClick);

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
      <button id="wp-tm-close" title="Chiudi" aria-label="Chiudi time machine">✕</button>
      <button id="wp-tm-prev-event" title="Evento precedente" aria-label="Evento precedente" disabled>⏮</button>
      <button id="wp-tm-play" title="Play" aria-label="Play">▶</button>
      <button id="wp-tm-next-event" title="Evento successivo" aria-label="Evento successivo" disabled>⏭</button>
      <button id="wp-tm-speed" title="Velocità riproduzione" aria-label="Velocità riproduzione">1x</button>
    </div>
    <div class="wp-tm-row wp-tm-slider-row">
      <input id="wp-tm-slider" type="range" min="0" max="1000" value="1000" />
      <span id="wp-tm-label">—</span>
    </div>
  `;
  document.body.appendChild(_panel);

  _slider = _panel.querySelector('#wp-tm-slider');
  _label = _panel.querySelector('#wp-tm-label');
  _playBtn = _panel.querySelector('#wp-tm-play');
  _prevEventBtn = _panel.querySelector('#wp-tm-prev-event');
  _nextEventBtn = _panel.querySelector('#wp-tm-next-event');
  _speedBtn = _panel.querySelector('#wp-tm-speed');

  _panel.querySelector('#wp-tm-close').addEventListener('click', _deactivate);
  _playBtn.addEventListener('click', _togglePlay);
  _prevEventBtn.addEventListener('click', () => _jumpToEvent(-1));
  _nextEventBtn.addEventListener('click', () => _jumpToEvent(1));
  _speedBtn.addEventListener('click', _cycleSpeed);

  _slider.addEventListener('input', () => {
    _stopPlay(); // trascinamento manuale = l'utente prende il controllo, ferma il playback
    const ts = Number(_slider.value);
    _label.textContent = _fmtDate(ts);
    // Debounce: la fetch server-side (ricostruzione keyframe+replay) non ha
    // senso rifarla per OGNI pixel trascinato — solo quando l'utente si ferma.
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => _applyAt(ts), 180);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Playback (play/pausa + velocità 1x-4x) — avanza il timestamp da solo a
// intervalli fissi (PLAY_TICK_MS); la velocità moltiplica il PASSO per
// tick, non la frequenza del timer, così il numero di fetch al server
// resta costante indipendentemente dalla velocità scelta.
// ─────────────────────────────────────────────────────────────────────────
function _togglePlay() {
  if (_playing) _stopPlay();
  else _startPlay();
}

function _startPlay() {
  if (!_range || _playing) return;
  _playing = true;
  _playBtn.textContent = '⏸';
  _playBtn.title = 'Pausa';
  // Se siamo già alla fine, ripartire da capo è più utile che restare fermi.
  if (Number(_slider.value) >= _range.max) {
    _slider.value = String(_range.min);
    _applyAt(_range.min);
  }
  _playTimer = setInterval(_playTick, PLAY_TICK_MS);
}

function _stopPlay() {
  if (_playTimer) clearInterval(_playTimer);
  _playTimer = null;
  if (!_playing) return;
  _playing = false;
  if (_playBtn) { _playBtn.textContent = '▶'; _playBtn.title = 'Play'; }
}

function _playTick() {
  const cur = Number(_slider.value);
  const next = cur + STEP_MS * PLAY_SPEEDS[_speedIdx];
  if (next >= _range.max) {
    _slider.value = String(_range.max);
    _applyAt(_range.max);
    _stopPlay();
    return;
  }
  _slider.value = String(next);
  _applyAt(next);
}

function _cycleSpeed() {
  _speedIdx = (_speedIdx + 1) % PLAY_SPEEDS.length;
  _speedBtn.textContent = `${PLAY_SPEEDS[_speedIdx]}x`;
}

// ─────────────────────────────────────────────────────────────────────────
// Frecce tastiera (±1 giorno) e barra spaziatrice (play/pausa) — solo
// mentre la time machine è attiva (listener aggiunto/rimosso in
// _activate/_deactivate) e solo se il focus non è su un campo di testo
// altrove nell'app (es. "Cerca nazione…"), per non rubargli i tasti.
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

async function _applyAt(ts) {
  _label.textContent = _fmtDate(ts);
  _hidePopup();
  _syncUrl(ts);
  try {
    const { regions } = await fetchRegionHistoryAtViaCache(ts);
    _lastRegions = regions;
    _renderHistorical(regions);
  } catch (err) {
    console.warn('WarEra+ time machine: ricostruzione fallita:', err.message);
  }
}

// Sostituisce SOLO countryId per feature (properties.regionId è il campo
// giusto per abbinare — verificato dal vivo contro map.getMapData: la bozza
// precedente mai integrata usava `properties._id` per errore, che non
// esiste). Non tocca state.baseGeoJSON: costruisce un oggetto nuovo,
// ripristinabile in _deactivate() con un semplice setData(state.baseGeoJSON).
function _renderHistorical(regionsMap) {
  if (!state.map || !state.baseGeoJSON) return;
  const historicalGeoJSON = {
    ...state.baseGeoJSON,
    features: state.baseGeoJSON.features.map(f => {
      const regionId = f.properties?.regionId;
      const historicalCountryId = regionId && Object.prototype.hasOwnProperty.call(regionsMap, regionId)
        ? regionsMap[regionId]
        : f.properties?.countryId; // regione non presente nello storico (raro): fallback al dato live
      return { ...f, properties: { ...f.properties, countryId: historicalCountryId } };
    }),
  };
  const src = state.map.getSource(SRC_REGIONS);
  if (src) src.setData(historicalGeoJSON);
  _applyBorders(regionsMap);
  _applyLabels(regionsMap);

  // Colore stabile per nazione — vedi commento in testa al file sul perché
  // non riusiamo le modalità colore esistenti (diplomazia/blocchi/ecc. non
  // hanno senso proiettate su un'epoca passata).
  const theme = THEMES[state.theme];
  const expr = ['match', ['get', 'countryId']];
  for (const [id, color] of state.nationBaseColorMap.entries()) expr.push(id, color);
  expr.push(theme.DEFAULT_LAND);
  if (state.map.getLayer(LYR_FILL)) state.map.setPaintProperty(LYR_FILL, 'fill-color', expr);
}

// BUG FIX: i confini bianchi (SRC_BORDERS, layer LYR_BORDER) sono una mesh
// calcolata UNA VOLTA SOLA in setupMapLayers() a partire dalla topologia
// grezza (state.mapDataGlobal.map) — non leggono affatto da SRC_REGIONS,
// quindi cambiare i dati di quest'ultima (sopra) non li tocca minimamente:
// i confini restavano quelli di OGGI anche guardando un'epoca passata.
// Ricalcola qui la stessa mesh (identica logica di setupMapLayers in
// map.js: due arch appartengono allo stesso confine se i lati hanno
// countryId diverso) ma usando l'ownership STORICA per regionId invece di
// properties.countryId live — `regionsMap: null` (chiamata da _deactivate)
// ricade su properties.countryId puro, cioè esattamente la mesh live
// originale, per il ripristino alla chiusura.
function _applyBorders(regionsMap) {
  const topoData = state.mapDataGlobal?.map;
  if (!state.map || !topoData) return;
  const src = state.map.getSource(SRC_BORDERS);
  if (!src) return;

  const ownerOf = (props) => {
    const historical = regionsMap && props.regionId && Object.prototype.hasOwnProperty.call(regionsMap, props.regionId)
      ? regionsMap[props.regionId]
      : undefined;
    return historical !== undefined ? historical : props.countryId;
  };

  const bordersMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && ownerOf(a.properties) !== ownerOf(b.properties));
  const coastMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a === b);
  const regionsMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && ownerOf(a.properties) === ownerOf(b.properties));

  src.setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'border' }, geometry: bordersMesh },
      { type: 'Feature', properties: { kind: 'coast' }, geometry: coastMesh },
      { type: 'Feature', properties: { kind: 'region' }, geometry: regionsMesh },
    ],
  });
}

// BUG FIX: le etichette coi nomi nazione (canvas separato, vedi
// labels.js:drawLabels) leggono state.labelsData — un array FISSO
// "una label per nazione, posizione fissa dentro il suo territorio
// attuale" (da topoData.objects.countryLabels), mai toccato da
// _renderHistorical sopra: restavano sempre col nome/colore di OGGI anche
// quando il riempimento sotto mostrava un'epoca passata. Qui si trova, UNA
// SOLA VOLTA (posizione fissa, non cambia mai durante la sessione), in
// quale REGIONE ricade il punto di ciascuna etichetta — poi a ogni mossa
// dello slider basta un lookup O(1) su quella regione nello storico per
// sapere quale nazione mostrare in quel punto.
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

function _applyLabels(regionsMap) {
  _ensureLabelRegionMap();
  if (!_labelRegionId || !state.labelsData?.length) return;

  if (!_labelOriginal) {
    // Catturati una sola volta per sessione (le label non cambiano finché
    // non c'è un refresh completo dei dati, che questa app non fa dopo il
    // boot) — il ripristino in _deactivate usa sempre questi.
    _labelOriginal = state.labelsData.map(l => ({
      countryId: l.properties.countryId,
      countryName: l.properties.countryName,
      countryCode: l.properties.countryCode,
      textColor: l.properties.textColor,
    }));
  }

  state.labelsData.forEach((label, idx) => {
    const regionId = _labelRegionId.get(idx);
    const orig = _labelOriginal[idx];
    const historicalCountryId = regionId && Object.prototype.hasOwnProperty.call(regionsMap, regionId)
      ? regionsMap[regionId]
      : orig.countryId; // punto non ricadeva in nessuna regione nota (raro): resta il dato live
    const nation = state.nationMap.get(historicalCountryId);
    label.properties.countryId = historicalCountryId;
    label.properties.countryName = nation?.name || orig.countryName;
    label.properties.countryCode = nation?.code || orig.countryCode;
    label.properties.textColor = state.nationBaseColorMap.get(historicalCountryId) || orig.textColor;
  });
  invalidateLabelCache();
}

function _restoreLabels() {
  if (!_labelOriginal || !state.labelsData?.length) return;
  state.labelsData.forEach((label, idx) => {
    const orig = _labelOriginal[idx];
    if (!orig) return;
    Object.assign(label.properties, orig);
  });
  invalidateLabelCache();
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
    _popup.innerHTML = `<span class="wp-tm-popup-name">— nessuna nazione —</span>`;
  } else {
    const code = nation.code?.toLowerCase();
    const flagHtml = code ? `<img src="https://media.warera.io/images/flags/${code}.svg?v=16" alt="" class="wp-tm-popup-flag" />` : '';
    // "dal —" solo se _loadEvents() è già arrivato (sincEts non-null) — vedi
    // _ownedSince: null significa "dato non ancora disponibile", non "sconosciuto".
    const sinceHtml = sinceTs != null
      ? `<span class="wp-tm-popup-since">dal ${_fmtDate(sinceTs)}</span>`
      : '';
    _popup.innerHTML = `
      <div class="wp-tm-popup-main">${flagHtml}<span class="wp-tm-popup-name">${escapeHtml(nation.name)}</span></div>
      ${sinceHtml}
    `;
  }
  // Il gap sopra il punto cliccato e il centraggio orizzontale li fa il
  // CSS (transform: translate(-50%, calc(-100% - 8px))) — qui solo il
  // punto esatto, in coordinate viewport (getContainer() è relativo al
  // canvas, va sommato all'offset del canvas nella pagina).
  const mapContainer = state.map.getContainer().getBoundingClientRect();
  _popup.style.left = `${mapContainer.left + point.x}px`;
  _popup.style.top = `${mapContainer.top + point.y}px`;
  _popup.classList.add('visible');
}

function _hidePopup() {
  if (_popup) _popup.classList.remove('visible');
}
