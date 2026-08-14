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
import { fetchRegionHistoryRangeViaCache, fetchRegionHistoryAtViaCache } from '../diplomacy/cacheClient.js';
import * as topojson from 'topojson-client';

const { SRC_REGIONS, SRC_BORDERS, LYR_FILL } = LAYER_IDS;

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
let _active = false;
let _range = null;
let _debounceTimer = null;
let _lastRegions = null; // { regionId: countryId } della posizione slider corrente, per il click
let _labelRegionId = null; // Map: indice in state.labelsData -> regionId "sotto" quella label (calcolato una volta, posizione fissa)
let _labelOriginal = null; // Array: { countryId, countryName, textColor, countryCode } originali, per il ripristino

export function initTimeMachine() {
  _btn = document.getElementById('wp-time-machine-btn');
  if (!_btn) return;
  _btn.addEventListener('click', () => (_active ? _deactivate() : _activate()));
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

async function _activate() {
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

  _slider.min = String(_range.min);
  _slider.max = String(_range.max);
  _slider.value = String(_range.max);
  await _applyAt(_range.max);

  state.map.on('click', LYR_FILL, _onHistoricalClick);
}

function _deactivate() {
  _active = false;
  state.timeMachineActive = false;
  _btn.classList.remove('wp-time-machine-btn-active');
  if (_panel) _panel.classList.remove('open');
  _hidePopup();

  const src = state.map?.getSource(SRC_REGIONS);
  if (src && state.baseGeoJSON) src.setData(state.baseGeoJSON);
  _applyBorders(null); // ripristina i confini live (stessa mesh calcolata da setupMapLayers)
  _restoreLabels();
  renderMap(); // ripristina qualunque modalità colore fosse attiva prima — questo modulo non deve saperne nulla

  if (state.map) state.map.off('click', LYR_FILL, _onHistoricalClick);
}

function _buildPanelIfNeeded() {
  if (_panel) return;

  _panel = document.createElement('div');
  _panel.id = 'wp-time-machine-panel';
  _panel.innerHTML = `
    <button id="wp-tm-close" title="Chiudi" aria-label="Chiudi time machine">✕</button>
    <input id="wp-tm-slider" type="range" min="0" max="1000" value="1000" />
    <span id="wp-tm-label">—</span>
  `;
  document.body.appendChild(_panel);

  _slider = _panel.querySelector('#wp-tm-slider');
  _label = _panel.querySelector('#wp-tm-label');
  _panel.querySelector('#wp-tm-close').addEventListener('click', _deactivate);

  _slider.addEventListener('input', () => {
    const ts = Number(_slider.value);
    _label.textContent = _fmtDate(ts);
    // Debounce: la fetch server-side (ricostruzione keyframe+replay) non ha
    // senso rifarla per OGNI pixel trascinato — solo quando l'utente si ferma.
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => _applyAt(ts), 180);
  });
}

async function _applyAt(ts) {
  _label.textContent = _fmtDate(ts);
  _hidePopup();
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
  _showPopup(e.point, nation);
}

function _showPopup(point, nation) {
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
    _popup.innerHTML = `${flagHtml}<span class="wp-tm-popup-name">${escapeHtml(nation.name)}</span>`;
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
