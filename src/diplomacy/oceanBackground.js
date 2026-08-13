// oceanBackground.js
//
// WarEra+ — layer ambientale per il mare, tema scuro: SOLO rotte
// commerciali (fra chokepoint marittimi reali, percorse da piccoli pallini
// animati). Le correnti (prima linee con frecce direzionali) sono state
// tolte del tutto su richiesta esplicita — venivano male. Prima ancora
// c'erano anche batimetria, griglia esagonale e archi radar, tolti per lo
// stesso motivo ("un'accozzaglia di robe"). Resta solo questa cosa,
// volutamente minimale.
//
// La geometria delle rotte (chokepoint, unwrap dell'antimeridiano,
// animazione) è condivisa con la versione "seppia" del tema chiaro — vedi
// oceanRoutes.js. Qui ci sono SOLO lo stile (colori ciano) e i layer.
//
// NB: qui NON si usano le illustrazioni nave/mostro/relitto fornite
// dall'utente — quelle sono SOLO per l'estetica "mappa antica" del tema
// chiaro (statiche, sparse, vedi antiqueTheme.js), mai sul tema scuro.
//
// Vincoli rispettati per costruzione:
// - NON tocca territori, confini, colori nazione, proiezione o UI: sono
//   layer maplibre nuovi, indipendenti, inseriti con `beforeId: LYR_FILL`
//   quindi disegnati SOTTO al layer di riempimento dei paesi (che ha
//   fill-opacity 0.9) — dove c'è terra, la copre quasi del tutto da sola.
// - Disattivabile via setOceanCategoryVisible(map, name, bool) /
//   setOceanBackgroundVisible(map, bool). Si nasconde da sola col tema
//   chiaro (mappa "pergamena") tramite applyOceanTheme() — quel tema ha
//   la sua estetica dedicata, vedi antiqueTheme.js.

import { buildRoutesData, makeRunner } from './oceanRoutes.js';

const SRC_PREFIX = 'wp-ocean-';

const LYR = {
  routes: 'wp-ocean-routes',
  routeNodes: 'wp-ocean-route-nodes',
  routeShips: 'wp-ocean-route-ships',
};

const COLOR = {
  route: '#1c7691',
  routeNode: '#49abc9',
  routeShip: '#8fe8ff',
};

let _stopShips = null;
// Riferimento salvato per poter riavviare l'animazione dopo che il tema
// chiaro l'aveva fermata, senza dover ricalcolare i sampledPaths.
let _shipsArgs = null;   // { map, sourceId, sampledPaths, opts }

function stopAnimations() {
  if (_stopShips) { _stopShips(); _stopShips = null; }
}

function startAnimations() {
  if (!_stopShips && _shipsArgs) {
    _stopShips = makeRunner(_shipsArgs.map, _shipsArgs.sourceId, _shipsArgs.sampledPaths, _shipsArgs.opts);
  }
}

// ==================== SETUP ====================
let _initialized = false;

/**
 * Aggiunge tutti i layer decorativi del mare, subito sotto `beforeLayerId`
 * (in pratica LYR_FILL, il riempimento dei paesi) così restano sempre
 * dietro ai territori. Idempotente: chiamabile più volte senza duplicare.
 */
export function initOceanBackground(map, beforeLayerId) {
  if (!map || _initialized) return;
  _initialized = true;

  const addSrc = (name, data) => {
    const id = SRC_PREFIX + name;
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data });
    return id;
  };

  const midWidth = ['interpolate', ['linear'], ['zoom'], 1, 1.3, 4, 2.0, 8, 3.0];

  // --- Rotte marittime reali (con pallini fissi + pallini "nave" animati) ---
  // NB: qui SOLO pallini, mai le illustrazioni nave/mostro/relitto fornite
  // dall'utente — quelle sono riservate alle statiche del tema chiaro
  // (antiqueTheme.js), il tema scuro resta "GIS futuristico" astratto.
  const routes = buildRoutesData();
  const routesSrc = addSrc('routes', routes.lines);
  const routeNodesSrc = addSrc('route-nodes', routes.nodes);
  const routeShipsSrc = addSrc('route-ships', { type: 'FeatureCollection', features: [] });
  map.addLayer({
    id: LYR.routes, type: 'line', source: routesSrc,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': COLOR.route, 'line-width': midWidth, 'line-opacity': 0.38, 'line-dasharray': [1, 3] },
  }, beforeLayerId);
  map.addLayer({
    id: LYR.routeNodes, type: 'circle', source: routeNodesSrc,
    paint: { 'circle-radius': 1.8, 'circle-color': COLOR.routeNode, 'circle-opacity': 0.55 },
  }, beforeLayerId);
  map.addLayer({
    id: LYR.routeShips, type: 'circle', source: routeShipsSrc,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.6, 4, 3.6, 8, 5], 'circle-color': COLOR.routeShip, 'circle-opacity': 0.85 },
  }, beforeLayerId);
  // 1 pallino "nave" per rotta.
  _shipsArgs = { map, sourceId: routeShipsSrc, sampledPaths: routes.sampledPaths, opts: { intervalMs: 180, speedRange: [0.12, 0.22], withBearing: true, particlesPerPath: 1 } };
  _stopShips = makeRunner(_shipsArgs.map, _shipsArgs.sourceId, _shipsArgs.sampledPaths, _shipsArgs.opts);

  applyOceanTheme();
}

/**
 * Mostra/nasconde tutto il layer ambientale insieme.
 */
export function setOceanBackgroundVisible(map, visible) {
  if (!map) return;
  Object.values(LYR).forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  });
  if (visible) startAnimations(); else stopAnimations();
}

/**
 * Mostra/nasconde una singola categoria (routes | routeNodes | routeShips).
 */
export function setOceanCategoryVisible(map, category, visible) {
  const id = LYR[category];
  if (!map || !id || !map.getLayer(id)) return;
  map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

/**
 * Il layer ha senso solo sul tema scuro (oceano quasi nero, estetica "GIS
 * militare"): sul tema chiaro la mappa diventa una pergamena calda con
 * la sua estetica dedicata (vedi antiqueTheme.js), quindi lo nascondiamo
 * del tutto. Da richiamare da applyTheme() in map.js.
 */
export function applyOceanTheme(state) {
  const map = state?.map;
  if (!map || !_initialized) return;
  const visible = (state?.theme ?? 'dark') !== 'light';
  setOceanBackgroundVisible(map, visible);
}
