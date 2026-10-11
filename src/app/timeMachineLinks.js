/* ══════════════════════════════════════════════════════════════
   WarEra+ — Guerre e patti come archi nella time machine
   ------------------------------------------------------------------
   Richiesta dell'utente: nella time machine, archi fra le nazioni in
   guerra quel giorno e fra quelle legate da un patto. Prima la
   diplomazia storica (server/dayHistory.js, da aprile 2026) si vedeva
   solo nei colori della nazione selezionata e nel suo popup.

   ⚠️ SOLO per la nazione selezionata, non per il mondo: un giorno
   qualunque ha ~600 coppie in guerra e ~575 patti (misurato sul 9 ott
   2026). Mille archi sopra una mappa sono una matassa, non
   un'informazione. Con una nazione a fuoco sono le sue guerre e i suoi
   patti, cioè le stesse nazioni che la time machine già colora — e con
   gli STESSI colori (COLORS della mappa principale): rosso guerra, rosso
   acceso il nemico giurato, viola i patti. Archi e territori dicono la
   stessa cosa.

   ── Da dove partono ────────────────────────────────────────────
   Dalla capitale di QUEL giorno: la capitale originaria se in quel
   fotogramma è ancora della nazione, altrimenti la sua regione più
   vicina alla capitale perduta (regionsMap del fotogramma, nessuna
   fetch). Una nazione senza territorio quel giorno non ha archi: il
   popup la elenca, ma un arco verso la sua capitale perduta finirebbe
   dentro chi l'ha occupata (misurato: l'Italia l'11 ott 2026 ha 11 patti
   e 6 archi, i 5 mancanti sono nazioni a zero regioni).

   ── Animazione ─────────────────────────────────────────────────
   Le guerre "scorrono": trattini che avanzano dalla nazione verso il
   nemico. Il nemico giurato ha la linea più spessa. I patti sono
   linee piene che respirano piano (opacità). Si ferma con la time
   machine chiusa o senza selezione.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { COLORS } from '../diplomacy/config.js';
import { arc } from '../diplomacy/flowGeometry.js';
import { getTimeMachineMap, TM_LYR_FILL } from './timeMachineMap.js';
import { animationsOn } from '../shared/motion.js';

const SRC = 'wp-tm-links-src';
const LYR_SHADOW = 'wp-tm-links-shadow';
const LYR_PACT = 'wp-tm-links-pact';
const LYR_WAR_BASE = 'wp-tm-links-war-base';
const LYR_WAR = 'wp-tm-links-war';
const LYR_ENDS = 'wp-tm-links-ends';
const LYR_HOME = 'wp-tm-links-home';

const DASH_SEQ = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];
const DASH_STEP_MS = 70;
const BREATH_MS = 2400;
const MIN_ARC_DEG = 0.8;

let _raf = null;
let _step = -1;
let _has = false;

/* ── Punto di aggancio di una nazione in un fotogramma ── */

let _capsFrom = null;
let _caps = null;          // countryId → regionId della capitale originaria
function capitalRegion(countryId) {
  if (_capsFrom !== state.regionData) {
    _capsFrom = state.regionData;
    _caps = new Map();
    for (const r of Object.values(state.regionData || {})) {
      if (r?.isCapital && r.initialCountry) _caps.set(r.initialCountry, r._id);
    }
  }
  return _caps.get(countryId) || null;
}

const posOf = id => {
  const p = state.regionData?.[id]?.position;
  return Array.isArray(p) ? p : null;
};

function anchorAt(countryId, regionsMap, owned) {
  const capId = capitalRegion(countryId);
  if (capId && regionsMap[capId] === countryId) return posOf(capId);
  const list = owned.get(countryId);
  if (!list?.length) return null;
  const cap = capId ? posOf(capId) : null;
  if (!cap) return posOf(list[0]);
  let best = null, bestD = Infinity;
  for (const id of list) {
    const p = posOf(id);
    if (!p) continue;
    const d = (p[0] - cap[0]) ** 2 + (p[1] - cap[1]) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/* ── Layer ── */

function ensureLayers(map) {
  if (map.getSource(SRC)) return true;
  if (!map.getLayer(TM_LYR_FILL)) return false;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const kind = k => ['==', ['get', 'kind'], k];
  const isLine = ['==', ['geometry-type'], 'LineString'];
  map.addLayer({
    id: LYR_SHADOW, type: 'line', source: SRC, filter: ['all', isLine, ['==', ['get', 'role'], 'ground']],
    paint: { 'line-color': '#000000', 'line-width': 2.5, 'line-blur': 2.5, 'line-opacity': 0.3 },
  });
  map.addLayer({
    id: LYR_PACT, type: 'line', source: SRC, filter: ['all', isLine, kind('pact')],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': COLORS.DEFENSIVE_PACT, 'line-width': 2.5, 'line-opacity': 0.85 },
  });
  map.addLayer({
    id: LYR_WAR_BASE, type: 'line', source: SRC, filter: ['all', isLine, ['in', ['get', 'kind'], ['literal', ['war', 'sworn']]]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'kind'], 'sworn', COLORS.SWORN_ENEMY, COLORS.WAR_DIRECT],
      'line-width': ['match', ['get', 'kind'], 'sworn', 4.5, 2.5],
      'line-opacity': 0.25,
    },
  });
  map.addLayer({
    id: LYR_WAR, type: 'line', source: SRC, filter: ['all', isLine, ['in', ['get', 'kind'], ['literal', ['war', 'sworn']]]],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'kind'], 'sworn', COLORS.SWORN_ENEMY, COLORS.WAR_DIRECT],
      'line-width': ['match', ['get', 'kind'], 'sworn', 4.5, 2.5],
      'line-opacity': 0.95,
      'line-dasharray': DASH_SEQ[0],
    },
  });
  map.addLayer({
    id: LYR_ENDS, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'end'],
    paint: {
      'circle-radius': 3.5,
      'circle-color': ['match', ['get', 'kind'], 'sworn', COLORS.SWORN_ENEMY, 'pact', COLORS.DEFENSIVE_PACT, COLORS.WAR_DIRECT],
      'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 1,
    },
  });
  map.addLayer({
    id: LYR_HOME, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'home'],
    paint: { 'circle-radius': 6, 'circle-color': COLORS.SELECTED, 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 2 },
  });
  return true;
}

/* ── Animazione ── */

function tick(now) {
  _raf = null;
  const map = getTimeMachineMap();
  if (!_has || !state.timeMachineActive || !map?.getLayer(LYR_WAR) || !animationsOn()) return;
  const step = Math.floor(now / DASH_STEP_MS) % DASH_SEQ.length;
  if (step !== _step) {
    _step = step;
    map.setPaintProperty(LYR_WAR, 'line-dasharray', DASH_SEQ[step]);
    const k = 0.5 + 0.5 * Math.sin(now / BREATH_MS * 2 * Math.PI);
    map.setPaintProperty(LYR_PACT, 'line-opacity', 0.55 + 0.4 * k);
  }
  _raf = requestAnimationFrame(tick);
}

/**
 * Disegna gli archi della nazione selezionata per il fotogramma corrente.
 * `focus` è lo stesso oggetto passato a setTimeMachineFocus
 * ({ self, wars, pacts, sworn, … }); null o senza diplomazia = via tutto.
 */
export function setTimeMachineLinks(focus, regionsMap) {
  const map = getTimeMachineMap();
  if (!map) return;
  if (!focus?.self || !regionsMap || (!focus.wars?.length && !focus.pacts?.length && !focus.sworn)) {
    clearTimeMachineLinks();
    return;
  }
  if (!ensureLayers(map)) return;
  const owned = new Map();
  for (const [rid, cid] of Object.entries(regionsMap)) {
    if (!owned.has(cid)) owned.set(cid, []);
    owned.get(cid).push(rid);
  }
  const home = anchorAt(focus.self, regionsMap, owned);
  const feats = [];
  if (home) {
    const seen = new Set([focus.self]);
    const add = (id, kind) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const to = anchorAt(id, regionsMap, owned);
      if (!to || Math.hypot(to[0] - home[0], to[1] - home[1]) < MIN_ARC_DEG) return;
      feats.push({ type: 'Feature', properties: { kind, role: 'ground' }, geometry: { type: 'LineString', coordinates: [home, to] } });
      feats.push({ type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates: arc(home, to).coords } });
      feats.push({ type: 'Feature', properties: { kind, role: 'end' }, geometry: { type: 'Point', coordinates: to } });
    };
    // Stessa precedenza dei colori della time machine: nemico giurato,
    // poi guerra, poi patto.
    add(focus.sworn, 'sworn');
    for (const id of focus.wars || []) add(id, 'war');
    for (const id of focus.pacts || []) add(id, 'pact');
    if (feats.length) feats.push({ type: 'Feature', properties: { role: 'home' }, geometry: { type: 'Point', coordinates: home } });
  }
  map.getSource(SRC).setData({ type: 'FeatureCollection', features: feats });
  _has = feats.length > 0;
  if (_has && !_raf && animationsOn()) _raf = requestAnimationFrame(tick);
}

export function clearTimeMachineLinks() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = null;
  _has = false;
  getTimeMachineMap()?.getSource(SRC)?.setData({ type: 'FeatureCollection', features: [] });
}

// Riaccese dalle Impostazioni: la time machine non passa da renderMap,
// quindi il giro dei trattini riparte da qui.
window.addEventListener('wareraplus:motionchange', () => {
  if (animationsOn() && _has && !_raf) _raf = requestAnimationFrame(tick);
});
