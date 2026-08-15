// antiqueTheme.js
//
// WarEra+ — estetica "mappa antica" per il SOLO tema chiaro (che ha già
// la palette seppia: theme.light.OCEAN = #a2986f, DEFAULT_LAND = #ffe7a6,
// vedi config.js). Quattro pezzi, attivi/disattivi insieme col tema:
//
// 1. Rotte marittime commerciali "color seppia" — STESSA geometria del
//    tema scuro (chokepoint reali, unwrap dell'antimeridiano, pallini
//    animati — vedi oceanRoutes.js, condiviso con oceanBackground.js),
//    solo ridipinta in marroncino/inchiostro invece che ciano futuristico.
// 2. Easter egg da mappa antica: le 3 illustrazioni fornite dall'utente
//    (nave, mostro marino, relitto — vedi oceanImages.js) piazzate come
//    marker statici in punti di mare aperto "remoti" (uno per oceano:
//    nave nell'Atlantico, mostro nell'Indiano, relitto nel Pacifico).
//    Puramente decorative: SOLO immagini sulla mappa, nessun popup/hover al
//    passaggio del mouse (tolto su richiesta esplicita — "devono essere
//    solo immagini sulla mappa").
//    Dimensione agganciata allo zoom (interpolate esponenziale base 2, gli
//    stessi due estremi di minZoom/maxZoom della mappa in map.js): a ogni
//    livello di zoom raddoppiano, ESATTAMENTE come farebbe un'immagine
//    disegnata sulla carta (o una tile raster) — così restano "incollate"
//    al punto geografico invece di restare a dimensione UI costante mentre
//    il resto della mappa si ingrandisce sotto di loro (era il difetto
//    lamentato: a icon-size fissa, zoomando sembravano rimpicciolire
//    rispetto al resto).
// 3. Texture "onda" (wave-1/wave-2.png, vedi oceanImages.js): pochi punti
//    sparsi sull'oceano (vedi WAVE_TEXTURE più sotto), dimensione/opacità
//    più basse dei marker sopra — un dettaglio della carta, non un
//    easter egg da notare. Stesso schema dei marker (icon-size che scala
//    con lo zoom, layer separato sotto le rotte).
// 4. La bussola decorativa e la vignettatura ai bordi sono invece overlay
//    HTML/CSS puri (non layer mappa) — vedi #wp-compass/#wp-vignette in
//    index.html e shell.css: qui non se ne occupa questo file.
//
// NB: c'era anche una texture "grana pergamena" (pattern procedurale su
// oceano/terra) — TOLTA su richiesta esplicita: il tile che si ripete
// visibilmente creava un effetto "a cubetti"/macchiato che non piaceva,
// non una texture di carta. Il tema chiaro resta con la sua palette
// seppia piatta (config.js), senza pattern sopra.
//
// Tutto qui dentro è un layer NUOVO sopra LYR_FILL (rotte: SOTTO, con
// beforeId, stesso principio di oceanBackground.js) — non modifica mai
// fill-color, confini, proiezione o UI.

// Rinominato in import per evitare confusione con il parametro `state`
// di applyAntiqueTheme(state) qui sotto (stesso nome, scope diverso).
import { state as globalState } from './state.js';
import { LAYER_IDS } from './config.js';
import { loadOceanImages, OCEAN_IMAGE_IDS } from './oceanImages.js';

const { SRC_REGIONS } = LAYER_IDS;
import { buildRoutesData, makeRunner } from './oceanRoutes.js';

const SRC_PREFIX = 'wp-antique-';
const SRC_ANTIQUE_MARKERS = 'wp-antique-markers-src';
const LYR_ANTIQUE_MARKERS = 'wp-antique-markers';
const SRC_WAVE_TEXTURE = 'wp-antique-wave-texture-src';
const LYR_WAVE_TEXTURE = 'wp-antique-wave-texture';
const LYR_LAND_MUTE = 'wp-antique-land-mute';

// Tinta piatta (NIENT'affatto un pattern/texture — quello dava l'effetto
// "a cubetti" tolto sopra) per smorzare leggermente i colori nazione verso
// il tono della carta, come richiesto ("prima la terra sembrava avere un
// colore più spento, forse la preferivo"). Sperimentale/leggero (0.14 di
// opacità): se non piace basta segnalarlo, si toglie con una riga sola.
const LAND_MUTE_COLOR = '#a2986f';
const LAND_MUTE_OPACITY = 0.14;

const LYR = {
  routes: 'wp-antique-routes',
  routeNodes: 'wp-antique-route-nodes',
  routeShips: 'wp-antique-route-ships',
};

// Marroncino/inchiostro invece di ciano — "devono seguire il tema".
const COLOR = {
  route: '#6b5638',
  routeNode: '#8a6d3f',
  routeShip: '#4a3520',
};

// icon-size che raddoppia a ogni livello di zoom (interpolate esponenziale
// base 2), tra minZoom e maxZoom della mappa (vedi map.js: 1.7 -> 8) — così
// gli easter egg scalano come farebbe un'immagine "stampata" sulla carta
// invece di restare a dimensione UI costante. 0.24 è la dimensione a
// minZoom (circa quella vista di default), l'estremo a maxZoom è
// 0.24 * 2^(8-1.7) calcolato qui invece che a mano per tenere esplicito il
// legame con l'estremo iniziale se in futuro cambia.
const ICON_SIZE_BY_ZOOM = ['interpolate', ['exponential', 2], ['zoom'], 1.7, 0.18, 8, 0.24 * Math.pow(2, 8 - 1.7)];

// Punti "remoti" di mare aperto per gli easter egg — uno per oceano
// principale, lontani dalle grandi masse continentali. Solo statiche,
// SOLO tema chiaro (mai sul tema scuro, che resta astratto/GIS — vedi
// oceanBackground.js).
const MARKERS = [
  { id: OCEAN_IMAGE_IDS.ship, lng: -40, lat: 35 }, // Atlantico
  { id: OCEAN_IMAGE_IDS.seaMonster, lng: 78, lat: -18 }, // Indiano
  { id: OCEAN_IMAGE_IDS.shipwreck, lng: -160, lat: 10 }, // Pacifico
];

// Texture "onda" (wave-1/wave-2.png, vedi oceanImages.js) — decorazione di
// sfondo, non un easter egg da notare: punti sparsi per oceano (richiesto
// esplicitamente "poco e sparse", almeno 5/6), dimensione/opacità più basse
// dei marker sopra così restano un dettaglio della "carta" e non
// competono visivamente con nave/mostro/relitto. rot alterna leggermente
// l'orientamento perché ripetere la stessa immagine sempre dritta la
// farebbe notare come pattern invece che come texture.
//
// NOTA (round 2 — ridistribuzione su richiesta esplicita): troppe vicine fra
// loro nell'Oceano Indiano (2 appena a sud del mostro marino, lng 78/-18),
// nessuna nel Mediterraneo né nel Mare del Nord. Quella più a sud delle due
// vicino al mostro (Oceano Australe, era lng60/-50) è stata spostata più a
// ovest, sotto il Sud Africa; quella nel Pacifico che cadeva sopra al
// relitto (lng-160/10) è stata spostata più a nord. Mediterraneo e Mare del
// Nord/Norvegese (fra Islanda ~lng-18/65 e Norvegia) sono due punti nuovi —
// il Mediterraneo con `scale` ridotto (vedi icon-size più sotto), essendo
// un mare piccolo dove la stessa dimensione delle altre risulterebbe
// sproporzionata.
const WAVE_TEXTURE = [
  { id: OCEAN_IMAGE_IDS.wave1, lng: -35, lat: 45, rot: 12 }, // Atlantico nord
  { id: OCEAN_IMAGE_IDS.wave2, lng: -20, lat: -25, rot: -8 }, // Atlantico sud
  { id: OCEAN_IMAGE_IDS.wave1, lng: 65, lat: -32, rot: 5 }, // Oceano Indiano (l'unica rimasta vicino al mostro)
  { id: OCEAN_IMAGE_IDS.wave2, lng: -170, lat: 38, rot: -15 }, // Pacifico nord (spostata più a nord, prima sopra al relitto)
  { id: OCEAN_IMAGE_IDS.wave1, lng: -140, lat: -20, rot: 20 }, // Pacifico sud
  { id: OCEAN_IMAGE_IDS.wave2, lng: 12, lat: -42, rot: 9 }, // sotto il Sud Africa (era la seconda vicino al mostro, spostata più a sx)
  { id: OCEAN_IMAGE_IDS.wave1, lng: 16, lat: 36, rot: -6, scale: 0.5 }, // Mediterraneo, più piccola
  { id: OCEAN_IMAGE_IDS.wave2, lng: -5, lat: 66, rot: 18 }, // Mare del Nord/Norvegese, fra Islanda e Norvegia
];
// ["zoom"] può comparire SOLO come input diretto di un interpolate/step di
// primo livello nello style-spec di maplibre — non annidabile dentro un
// altro operatore come ["*", ...] attorno all'intero interpolate (era
// l'errore "zoom expression may only be used as input to a top-level step
// or interpolate expression" al primo giro). Il moltiplicatore per-feature
// `scale` va quindi dentro ai valori di output di ciascuno stop, non attorno
// a tutta l'espressione.
const WAVE_BASE_ICON_SIZE = 0.13;
const WAVE_ICON_SIZE_BY_ZOOM = [
  'interpolate', ['exponential', 2], ['zoom'],
  1.7, ['*', ['get', 'scale'], WAVE_BASE_ICON_SIZE],
  8, ['*', ['get', 'scale'], WAVE_BASE_ICON_SIZE * Math.pow(2, 8 - 1.7)],
];

let _stopShips = null;
let _shipsArgs = null; // { map, sourceId, sampledPaths, opts } — per riavviare dopo il tema scuro

function _stopAnimations() {
  if (_stopShips) { _stopShips(); _stopShips = null; }
}
function _startAnimations() {
  // Vedi la nota gemella in oceanBackground.js:startAnimations — la guardia
  // sul tema sta qui perché l'avvio arriva anche da resumeShipAnimation
  // (timeMachine.js alla chiusura), che risveglia entrambi i temi senza
  // sapere quale sia attivo.
  if (globalState.theme !== 'light') return; // rotte "seppia": solo tema chiaro
  if (!_stopShips && _shipsArgs) {
    _stopShips = makeRunner(_shipsArgs.map, _shipsArgs.sourceId, _shipsArgs.sampledPaths, _shipsArgs.opts);
  }
}

// WarEra+ — vedi commento gemello in oceanBackground.js (pauseShipAnimation/
// resumeShipAnimation): stessa idea, versione tema chiaro. Solo uno dei due
// temi ha un runner attivo alla volta (_stopShips è null nell'altro),
// quindi timeMachine.js può chiamare entrambe le coppie senza controllare
// quale tema è attivo — quella del tema inattivo è un no-op.
// NB: questa invariante era FALSA fino al fix qui sotto in initAntiqueTheme
// (entrambi i runner giravano insieme, misurato); ora regge davvero perché
// l'avvio passa solo da applyAntiqueTheme()/applyOceanTheme().
export function pauseShipAnimation() { _stopAnimations(); }
export function resumeShipAnimation() { _startAnimations(); }

let _initialized = false;

/**
 * Aggiunge le rotte "color seppia" (subito sotto `beforeLayerId`, in
 * pratica LYR_FILL, stesso principio di oceanBackground.js) + i marker
 * easter-egg (nave/mostro/relitto). Chiamare una volta da setupMapLayers;
 * la visibilità effettiva è gestita da applyAntiqueTheme() (chiamata da
 * applyTheme() in map.js), quindi qui i layer partono nascosti.
 */
export async function initAntiqueTheme(map, beforeLayerId) {
  if (!map || _initialized) return;
  _initialized = true;

  // Tutto in un try/catch: la parte dopo l'`await` gira come continuazione
  // asincrona, quindi un throw lì NON verrebbe intercettato dal try/catch
  // sincrono che la avvolge in map.js (che copre solo la parte fino al
  // primo await) — finirebbe come unhandled rejection silenziosa in
  // console invece che come errore leggibile.
  try {
    const addSrc = (name, data) => {
      const id = SRC_PREFIX + name;
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data });
      return id;
    };
    const midWidth = ['interpolate', ['linear'], ['zoom'], 1, 1.2, 4, 1.8, 8, 2.6];

    // --- Rotte marittime (stessa geometria del tema scuro, colori seppia) ---
    const routes = buildRoutesData();
    const routesSrc = addSrc('routes', routes.lines);
    const routeNodesSrc = addSrc('route-nodes', routes.nodes);
    const routeShipsSrc = addSrc('route-ships', { type: 'FeatureCollection', features: [] });
    map.addLayer({
      id: LYR.routes, type: 'line', source: routesSrc,
      layout: { visibility: 'none', 'line-cap': 'round' },
      paint: { 'line-color': COLOR.route, 'line-width': midWidth, 'line-opacity': 0.55, 'line-dasharray': [1, 3] },
    }, beforeLayerId);
    map.addLayer({
      id: LYR.routeNodes, type: 'circle', source: routeNodesSrc,
      layout: { visibility: 'none' },
      paint: { 'circle-radius': 1.8, 'circle-color': COLOR.routeNode, 'circle-opacity': 0.7 },
    }, beforeLayerId);
    map.addLayer({
      id: LYR.routeShips, type: 'circle', source: routeShipsSrc,
      layout: { visibility: 'none' },
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.6, 4, 3.6, 8, 5], 'circle-color': COLOR.routeShip, 'circle-opacity': 0.9 },
    }, beforeLayerId);
    // WarEra+ perf: 1500ms (era 500ms, prima ancora 180ms) — vedi nota in
    // oceanBackground.js (stessa animazione/geometria, solo temi diversi).
    // BUG FIX perf (misurato: il runner di QUESTO tema girava anche a tema
    // scuro attivo, animando layer con visibility:'none'). Qui c'era un
    // makeRunner() incondizionato. Race: initAntiqueTheme è `async` e
    // map.js:124 NON la attende — chiama applyAntiqueTheme(state) subito
    // dopo, quando `_initialized` è già true ma `_stopShips` è ancora null
    // perché l'await più sotto non si è risolto. Lo _stopAnimations() di
    // applyAntiqueTheme finiva quindi nel vuoto, e questa riga faceva
    // partire il runner DOPO, senza più nessuno a fermarlo.
    // Ora si registrano solo gli argomenti: chi decide se avviarlo è
    // applyAntiqueTheme(), richiamata in fondo a questa init (sotto) a
    // await ormai risolti.
    _shipsArgs = { map, sourceId: routeShipsSrc, sampledPaths: routes.sampledPaths, opts: { intervalMs: 1500, speedRange: [0.12, 0.22], withBearing: true, particlesPerPath: 1 } };

    // --- Tinta piatta per smorzare i colori nazione (vedi nota sopra
    // LAND_MUTE_COLOR) — NESSUN beforeId: si aggiunge sopra a LYR_FILL/le
    // rotte appena create, i layer aggiunti più avanti in setupMapLayers
    // (bordi ecc.) restano comunque sopra di lei. Stessa geometria di
    // LYR_FILL (SRC_REGIONS): copre esattamente le stesse forme, niente
    // di più — non tocca fill-color, solo un velo semi-trasparente sopra.
    if (!map.getLayer(LYR_LAND_MUTE)) {
      map.addLayer({
        id: LYR_LAND_MUTE, type: 'fill', source: SRC_REGIONS,
        layout: { visibility: 'none' },
        paint: { 'fill-color': LAND_MUTE_COLOR, 'fill-opacity': LAND_MUTE_OPACITY },
      });
    }

    // Marker easter-egg: solo per le immagini che sono state effettivamente
    // trovate (vedi oceanImages.js — se l'utente non ha ancora salvato i 3
    // PNG in public/icons/ocean/, questo semplicemente non aggiunge nulla,
    // nessun errore bloccante).
    const imgResults = await loadOceanImages(map);
    const features = MARKERS
      .filter(m => imgResults[m.id])
      .map(m => ({
        type: 'Feature',
        properties: { icon: m.id },
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      }));
    if (features.length && !map.getSource(SRC_ANTIQUE_MARKERS)) {
      map.addSource(SRC_ANTIQUE_MARKERS, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      // beforeId = LYR.routes (non beforeLayerId/LYR_FILL): le vogliamo
      // SOTTO ai layer delle rotte commerciali (linee/nodi/pallini nave),
      // non sopra — restano comunque sopra a LYR_FILL/terra, non c'entra.
      map.addLayer({
        id: LYR_ANTIQUE_MARKERS, type: 'symbol', source: SRC_ANTIQUE_MARKERS,
        layout: {
          visibility: 'none',
          'icon-image': ['get', 'icon'],
          // Scala come le tile della mappa (raddoppia ogni livello di zoom,
          // stessi estremi min/maxZoom di map.js) invece di icon-size
          // costante — vedi nota nel blocco di commenti in testa al file.
          'icon-size': ICON_SIZE_BY_ZOOM,
          'icon-allow-overlap': true,
        },
        paint: { 'icon-opacity': 0.88 },
      }, LYR.routes);
    }

    // Texture "onda" (vedi nota su WAVE_TEXTURE sopra): stesso schema dei
    // marker easter-egg (icone caricate via oceanImages.js, saltate senza
    // errori se i 2 PNG non sono stati ancora salvati su disco), ma layer
    // separato — dimensione/opacità più basse, nessuna interazione.
    const waveFeatures = WAVE_TEXTURE
      .filter(w => imgResults[w.id])
      .map(w => ({
        type: 'Feature',
        properties: { icon: w.id, rot: w.rot, scale: w.scale ?? 1 },
        geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
      }));
    if (waveFeatures.length && !map.getSource(SRC_WAVE_TEXTURE)) {
      map.addSource(SRC_WAVE_TEXTURE, { type: 'geojson', data: { type: 'FeatureCollection', features: waveFeatures } });
      map.addLayer({
        id: LYR_WAVE_TEXTURE, type: 'symbol', source: SRC_WAVE_TEXTURE,
        layout: {
          visibility: 'none',
          'icon-image': ['get', 'icon'],
          // Il moltiplicatore per-feature `scale` (usato dal punto nel
          // Mediterraneo, più piccolo) è già dentro a WAVE_ICON_SIZE_BY_ZOOM
          // — vedi il commento lì sopra sul perché non può stare qui attorno.
          'icon-size': WAVE_ICON_SIZE_BY_ZOOM,
          'icon-rotate': ['get', 'rot'],
          'icon-allow-overlap': true,
        },
        paint: { 'icon-opacity': 0.5 },
      }, LYR.routes);
    }
  } catch (err) {
    console.error('[antiqueTheme] inizializzazione fallita:', err);
    return;
  }

  // BUG FIX (storico): qui sotto era `applyAntiqueTheme()` senza argomento
  // — dato che initAntiqueTheme è async (aspetta loadOceanImages), quella
  // riga girava DOPO che map.js aveva già fatto la sua chiamata esplicita
  // `applyAntiqueTheme(state)` subito dopo initAntiqueTheme(...) (quella
  // chiamata arrivava quindi troppo presto: i layer non esistevano ancora).
  // Chiamare qui applyAntiqueTheme() senza stato reale valutava
  // `state?.theme === 'light'` come false SEMPRE, quindi i layer appena
  // creati venivano nascosti un istante dopo — a prescindere dal tema
  // attivo. Passando lo `state` importato dal modulo (singleton condiviso
  // con map.js) si applica il tema REALE al momento giusto.
  applyAntiqueTheme(globalState);
}

/**
 * Attiva/disattiva l'estetica antica (rotte + marker easter-egg). Da
 * richiamare da applyTheme() in map.js — attiva solo quando
 * state.theme === 'light'.
 */
export function applyAntiqueTheme(state) {
  const map = state?.map;
  if (!map || !_initialized) return;
  const light = state?.theme === 'light';

  Object.values(LYR).forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', light ? 'visible' : 'none');
  });
  if (light) _startAnimations(); else _stopAnimations();

  if (map.getLayer(LYR_ANTIQUE_MARKERS)) {
    map.setLayoutProperty(LYR_ANTIQUE_MARKERS, 'visibility', light ? 'visible' : 'none');
  }
  if (map.getLayer(LYR_WAVE_TEXTURE)) {
    map.setLayoutProperty(LYR_WAVE_TEXTURE, 'visibility', light ? 'visible' : 'none');
  }
  if (map.getLayer(LYR_LAND_MUTE)) {
    map.setLayoutProperty(LYR_LAND_MUTE, 'visibility', light ? 'visible' : 'none');
  }
}
