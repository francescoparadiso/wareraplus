// darkFleetTheme.js
//
// WarEra+ — easter egg illustrati per il tema SCURO: gruppo navale da
// scorta (6 navi, Atlantico), gruppo portaerei (7 navi, Pacifico), nave
// cargo (Oceano Indiano) + texture "onda" sparsa (vedi oceanImages.js per
// i file, incollati dall'utente in chat — round 2 dopo il batch del tema
// chiaro). Analogo ad antiqueTheme.js ma per il tema scuro, con una
// differenza: qui NON si ridisegnano le rotte commerciali, già gestite in
// ciano da oceanBackground.js — solo le illustrazioni statiche sopra.
//
// Stesso principio "solo immagini sulla mappa, nessun popup/hover al
// passaggio del mouse" del tema chiaro (richiesto esplicitamente lì,
// mantenuto qui per coerenza).
//
// Tutto qui dentro è un layer NUOVO, indipendente — non tocca mai
// fill-color, confini, proiezione o UI (stesso vincolo di
// oceanBackground.js/antiqueTheme.js).

import { state as globalState } from './state.js';
import { loadOceanImages, OCEAN_IMAGE_IDS } from './oceanImages.js';

const SRC_MARKERS = 'wp-darkfleet-markers-src';
const LYR_MARKERS = 'wp-darkfleet-markers';
const SRC_WAVE = 'wp-darkfleet-wave-texture-src';
const LYR_WAVE = 'wp-darkfleet-wave-texture';

// icon-size che raddoppia a ogni livello di zoom (interpolate esponenziale
// base 2), stessi estremi min/maxZoom della mappa (map.js: 1.7 -> 8) —
// così i marker scalano come farebbe un'illustrazione "stampata" sulla
// carta invece di restare a dimensione UI costante. Stessa formula di
// antiqueTheme.js (vedi commento lì per i dettagli).
const ICON_SIZE_BY_ZOOM = ['interpolate', ['exponential', 2], ['zoom'], 1.7, 0.18, 8, 0.24 * Math.pow(2, 8 - 1.7)];

// Punti "remoti" di mare aperto, uno per oceano principale — stessa
// convenzione dei 3 marker del tema chiaro (vedi MARKERS in
// antiqueTheme.js), coordinate diverse per non sovrapporsi esattamente
// (comunque mai visibili insieme: i due temi sono mutuamente esclusivi).
const MARKERS = [
  { id: OCEAN_IMAGE_IDS.fleetDestroyers, lng: -40, lat: 35 },  // Atlantico
  { id: OCEAN_IMAGE_IDS.fleetCarrier, lng: -160, lat: 10 },    // Pacifico
  { id: OCEAN_IMAGE_IDS.cargoShip, lng: 78, lat: -18 },        // Oceano Indiano
];

// Texture "onda" — stesso schema di WAVE_TEXTURE in antiqueTheme.js (punti
// sparsi, dimensione/opacità basse, rotazione alternata per non sembrare un
// pattern ripetuto). Round 3: 3 disegni alternati (wave-dark/-2/-3) invece
// di ripetere sempre lo stesso — stessa idea dell'alternanza wave-1/wave-2
// del tema chiaro, qui con un disegno in più.
//
// `scale` per-feature (default 1, vedi WAVE_ICON_SIZE_BY_ZOOM sotto): il
// punto nel Mediterraneo usa 0.5, IDENTICO al motivo per cui antiqueTheme.js
// fa lo stesso per il suo punto mediterraneo — un mare piccolo dove la
// stessa dimensione delle altre risulta sproporzionata ("troppo lunga").
const WAVE_BASE_ICON_SIZE = 0.13;
const WAVE_ICON_SIZE_BY_ZOOM = [
  'interpolate', ['exponential', 2], ['zoom'],
  1.7, ['*', ['get', 'scale'], WAVE_BASE_ICON_SIZE],
  8, ['*', ['get', 'scale'], WAVE_BASE_ICON_SIZE * Math.pow(2, 8 - 1.7)],
];
const WAVE_TEXTURE = [
  { id: OCEAN_IMAGE_IDS.waveDark, lng: -35, lat: 45, rot: 12 },              // Atlantico nord
  { id: OCEAN_IMAGE_IDS.waveDark2, lng: -20, lat: -25, rot: -8 },            // Atlantico sud
  { id: OCEAN_IMAGE_IDS.waveDark3, lng: 65, lat: -32, rot: 5 },              // Oceano Indiano
  { id: OCEAN_IMAGE_IDS.waveDark, lng: -170, lat: 38, rot: -15 },            // Pacifico nord
  { id: OCEAN_IMAGE_IDS.waveDark2, lng: -140, lat: -20, rot: 20 },           // Pacifico sud
  { id: OCEAN_IMAGE_IDS.waveDark3, lng: 12, lat: -42, rot: 9 },              // sotto il Sud Africa
  { id: OCEAN_IMAGE_IDS.waveDark, lng: 16, lat: 36, rot: -6, scale: 0.5 },   // Mediterraneo, più piccola
  { id: OCEAN_IMAGE_IDS.waveDark2, lng: -5, lat: 66, rot: 18 },              // Mare del Nord/Norvegese
];

// Solo le immagini che questo tema usa davvero (WarEra+ perf mobile): fino
// a ieri loadOceanImages() le caricava tutte e 11, comprese le 5 del tema
// chiaro che qui non compaiono mai. Derivato da MARKERS/WAVE_TEXTURE invece
// che scritto a mano, così aggiungere un marker non lascia indietro la sua
// immagine.
const USED_IMAGE_IDS = [...new Set([...MARKERS, ...WAVE_TEXTURE].map(x => x.id))];

let _initialized = false;

/**
 * Aggiunge i marker easter-egg (chiamare una volta da setupMapLayers, dopo
 * initOceanBackground). La visibilità effettiva è gestita da
 * applyDarkFleetTheme() (chiamata da applyTheme() in map.js), quindi qui i
 * layer partono nascosti.
 */
export async function initDarkFleetTheme(map) {
  if (!map || _initialized) return;
  _initialized = true;

  // Come in antiqueTheme.js: tutto in un try/catch perché la continuazione
  // dopo l'await gira async, un throw lì non verrebbe intercettato dal
  // try/catch sincrono di map.js che avvolge la chiamata iniziale.
  try {
    const imgResults = await loadOceanImages(map, USED_IMAGE_IDS);

    const features = MARKERS
      .filter(m => imgResults[m.id])
      .map(m => ({
        type: 'Feature',
        properties: { icon: m.id },
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      }));
    if (features.length && !map.getSource(SRC_MARKERS)) {
      map.addSource(SRC_MARKERS, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: LYR_MARKERS, type: 'symbol', source: SRC_MARKERS,
        layout: {
          visibility: 'none',
          'icon-image': ['get', 'icon'],
          'icon-size': ICON_SIZE_BY_ZOOM,
          'icon-allow-overlap': true,
        },
        paint: { 'icon-opacity': 0.88 },
      });
    }

    // Ogni punto salta singolarmente se il suo disegno specifico non è
    // stato caricato (es. solo wave-dark.png salvato, wave-dark-2/-3
    // ancora mancanti) — stesso principio "nessun errore bloccante" del
    // resto del file, applicato per-immagine invece che per-layer.
    const waveFeatures = WAVE_TEXTURE
      .filter(w => imgResults[w.id])
      .map(w => ({
        type: 'Feature',
        properties: { icon: w.id, rot: w.rot, scale: w.scale ?? 1 },
        geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
      }));
    if (waveFeatures.length && !map.getSource(SRC_WAVE)) {
      map.addSource(SRC_WAVE, { type: 'geojson', data: { type: 'FeatureCollection', features: waveFeatures } });
      map.addLayer({
        id: LYR_WAVE, type: 'symbol', source: SRC_WAVE,
        layout: {
          visibility: 'none',
          'icon-image': ['get', 'icon'],
          // Il moltiplicatore per-feature `scale` (usato dal punto nel
          // Mediterraneo, più piccolo) è già dentro a WAVE_ICON_SIZE_BY_ZOOM
          // — vedi il commento lì sopra sul perché non può stare qui attorno
          // (stessa nota di antiqueTheme.js: ["zoom"] può comparire solo come
          // input diretto di un interpolate/step di primo livello).
          'icon-size': WAVE_ICON_SIZE_BY_ZOOM,
          'icon-rotate': ['get', 'rot'],
          'icon-allow-overlap': true,
        },
        paint: { 'icon-opacity': 0.5 },
      });
    }
  } catch (err) {
    console.error('[darkFleetTheme] inizializzazione fallita:', err);
    return;
  }

  // BUG FIX storico (già capitato una volta identico in antiqueTheme.js,
  // vedi commento lì): initDarkFleetTheme è async (aspetta
  // loadOceanImages), quindi la chiamata esplicita applyDarkFleetTheme(state)
  // che map.js fa subito dopo initDarkFleetTheme(...) arriva troppo presto
  // (i layer non esistono ancora). Chiamarla qui, a valle dell'await, con lo
  // state reale importato dal modulo (singleton condiviso con map.js)
  // applica il tema giusto al momento giusto.
  applyDarkFleetTheme(globalState);
}

/**
 * Attiva/disattiva gli easter egg del tema scuro. Da richiamare da
 * applyTheme() in map.js — attivo quando state.theme !== 'light' (stessa
 * convenzione "scuro di default" di applyOceanTheme in oceanBackground.js).
 */
export function applyDarkFleetTheme(state) {
  const map = state?.map;
  if (!map || !_initialized) return;
  const dark = (state?.theme ?? 'dark') !== 'light';

  if (map.getLayer(LYR_MARKERS)) {
    map.setLayoutProperty(LYR_MARKERS, 'visibility', dark ? 'visible' : 'none');
  }
  if (map.getLayer(LYR_WAVE)) {
    map.setLayoutProperty(LYR_WAVE, 'visibility', dark ? 'visible' : 'none');
  }
}
