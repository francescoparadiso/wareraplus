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
// Rinominato in import per non confondersi col parametro `state` di
// applyOceanTheme(state) — stesso schema già usato in antiqueTheme.js.
import { state as globalState } from './state.js';

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
  // Guardia sul tema DENTRO a start (non nei chiamanti): l'avvio arriva da
  // più punti — applyOceanTheme via setOceanBackgroundVisible, e
  // resumeShipAnimation chiamata da timeMachine.js alla chiusura. Quella
  // di timeMachine.js risveglia entrambi i temi senza guardare quale sia
  // attivo (per scelta: non deve conoscerne i dettagli), quindi il
  // controllo deve stare qui, altrimenti il runner del tema NON attivo
  // riparte alla chiusura della time machine e ricomincia ad animare
  // layer nascosti.
  if (globalState.theme === 'light') return; // rotte "futuristiche": solo tema scuro
  if (!_stopShips && _shipsArgs) {
    _stopShips = makeRunner(_shipsArgs.map, _shipsArgs.sourceId, _shipsArgs.sampledPaths, _shipsArgs.opts);
  }
}

// WarEra+ (feedback utente: rendering in ritardo durante la time machine —
// il pallino nave è puramente decorativo, il suo movimento è sempre lo
// stesso schema seedato, non dipende dai dati). A differenza di
// setOceanBackgroundVisible sopra, questi NON toccano la visibilità dei
// layer (le rotte/navi restano visibili, solo ferme) — pensati per essere
// richiamati da timeMachine.js mentre è aperta, per liberare il thread
// principale dal repaint ogni 500ms mentre il playback ne ha più bisogno.
export function pauseShipAnimation() { stopAnimations(); }
export function resumeShipAnimation() { startAnimations(); }

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
  // WarEra+ perf: era 180ms, poi 500ms (~5.5 -> ~2 repaint MapLibre/sec per
  // sempre, mai in pausa mentre l'app è aperta — vedi labels.js: trainava
  // anche drawLabels ad ogni giro, bound a map.on('render')). Ulteriore
  // richiesta esplicita dell'utente: rallentare ancora per ridurre il
  // costo sul thread principale — 1500ms (~3x meno repaint/sec di 500ms).
  // `speed` (avanzamento per tick) resta invariato: intervalMs più lungo
  // rallenta ANCHE il movimento percepito (stesso passo, meno spesso), non
  // solo il costo — coerente con "rallenta il movimento" chiesto.
  // WarEra+ perf: qui c'era anche un makeRunner() incondizionato. Ora si
  // registrano solo gli argomenti e a decidere se avviarlo è
  // applyOceanTheme() qui sotto (via setOceanBackgroundVisible), che
  // conosce il tema attivo — così il runner del tema NON attivo non gira
  // a vuoto animando layer nascosti. Stessa correzione applicata al
  // gemello di antiqueTheme.js.
  _shipsArgs = { map, sourceId: routeShipsSrc, sampledPaths: routes.sampledPaths, opts: { intervalMs: 1500, speedRange: [0.12, 0.22], withBearing: true, particlesPerPath: 1 } };

  // Era `applyOceanTheme()` senza argomento: `state?.map` risultava
  // undefined e la funzione usciva subito, rendendo la riga un no-op
  // silenzioso. Passando lo `state` importato (stesso singleton di map.js)
  // fa davvero il suo lavoro — e ora è anche il punto che avvia il runner.
  applyOceanTheme(globalState);
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
