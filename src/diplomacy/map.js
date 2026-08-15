// map.js
import maplibregl from 'maplibre-gl';
import * as topojson from 'topojson-client';
import { state } from './state.js';
import { COLORS, LAYER_IDS, THEMES } from './config.js';
import {
  buildMultiBlocPatternExpression, getMultiBlocPatternExpression, getMultiBlocPatternExpressionOriginal,
} from './patterns.js';
import { updateDualBadges, clearDualBadges } from './dualBadges.js';
import {
  buildDiplomacyColorExpression, buildBlocColorExpression, buildOriginalBlocColorExpression, buildOriginalColorExpression,
  getEnemyAllies, getAllianceAllies, getDefensivePactAllies, getDualAllyDefensiveIds,
  buildBlocFocusColorExpression, getBlocMemberIds,
} from './diplomacy.js';
import { initLabelCanvas, preloadAllFlags, buildOriginalLabels, loadFlagImage, invalidateLabelCache } from './labels.js';
import { updateDynamicLegend, updateStats, updateSelectedDisplay } from './ui.js';
import { buildPopulationColorExpression, buildPopulationTextExpression } from './population.js';
import { buildWeeklyDamageColorExpression } from './weeklyDamage.js';
import { buildSphereColorExpression } from './sphereOfInfluence.js';
import { buildBattleHeatmapColorExpression } from './battleHeatmap.js';
import { initNationTooltip } from './nationTooltip.js';
import { hide as hideTooltip } from './nationTooltip.js';
import { initOceanBackground, applyOceanTheme } from './oceanBackground.js';
import { initAntiqueTheme, applyAntiqueTheme } from './antiqueTheme.js';
import { initDarkFleetTheme, applyDarkFleetTheme } from './darkFleetTheme.js';

const { SRC_REGIONS, SRC_BORDERS, SRC_DIPLOMACY_DUAL_BORDER, SRC_BATTLE_REGION, LYR_FILL, LYR_OUTLINE, LYR_COAST, LYR_BORDER, LYR_MULTI_BLOC, LYR_DIPLOMACY_DUAL, LYR_BATTLE_REGION, LYR_BATTLE_REGION_FILL, LYR_BLOC_FLASH } = LAYER_IDS;

// ==================== INIT MAPPA ====================
export function initMap() {
  const theme = THEMES[state.theme];
  state.map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': theme.OCEAN } }],
    },
    center: [0, 20],
    zoom: 2,
    minZoom: 1.7,
    maxZoom: 8,
    renderWorldCopies: true,
    attributionControl: false,
    // WarEra+ perf (misurato): questo è il singolo intervento più pesante
    // sul consumo a mappa FERMA. Il default di MapLibre è 300ms di
    // dissolvenza per i layer `symbol`; ogni volta che una qualsiasi
    // sorgente cambia, MapLibre ri-esegue il "symbol placement" e per
    // tutta la durata del fade tiene `_placementDirty` attivo, cioè
    // continua a ridisegnare a frame pieno. Con i pallini-nave decorativi
    // che fanno setData ogni 1,5s (oceanRoutes.js:makeRunner) la mappa non
    // tornava MAI idle: 30 secondi di immobilità totale producevano ~470
    // repaint WebGL, concentrati in burst da ~110 frame in un secondo.
    // Con fadeDuration:0 gli stessi 30 secondi ne producono 22 (-95%).
    // Costo: i pochi layer symbol presenti (marker flotta + texture onde
    // dei temi, roba decorativa) compaiono di colpo invece che in
    // dissolvenza allo zoom — impercettibile su quegli elementi.
    fadeDuration: 0,
  });
}

// ==================== SETUP LAYER ====================
export async function setupMapLayers() {
  const topoData = state.mapDataGlobal.map;
  state.baseGeoJSON = topojson.feature(topoData, topoData.objects.regions);
  state.labelsData = state.mapDataGlobal.countryLabels?.geometries || topoData.objects.countryLabels?.geometries || [];

  computeCentroids();
  invalidateLabelCache();

  _addOrUpdateSource(SRC_REGIONS, { type: 'geojson', data: state.baseGeoJSON });

  const bordersMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && a.properties.countryId !== b.properties.countryId);
  const coastMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a === b);
  const regionsMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && a.properties.countryId === b.properties.countryId);

  _addOrUpdateSource(SRC_BORDERS, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'border' }, geometry: bordersMesh },
        { type: 'Feature', properties: { kind: 'coast' }, geometry: coastMesh },
        { type: 'Feature', properties: { kind: 'region' }, geometry: regionsMesh },
      ],
    },
  });

  if (!state.map.getLayer(LYR_FILL)) {
    state.map.addLayer({ id: LYR_FILL, type: 'fill', source: SRC_REGIONS, paint: { 'fill-color': COLORS.NEUTRAL_UNSELECTED, 'fill-opacity': 0.9 } });
  }

  // WarEra+: layer ambientale del mare (rotte commerciali, tema scuro) e
  // easter egg "mappa antica" (nave/mostro/relitto, tema chiaro) —
  // entrambi puramente decorativi, mai indispensabili per la mappa vera e
  // propria. Avvolti in try/catch apposta: un RangeError di maplibre in
  // uno di questi due (già successo una volta, image mismatch su un
  // canvas passato ad addImage) interrompeva l'intera setupMapLayers() a
  // metà — mappa completamente rotta per un dettaglio ornamentale. Ora un
  // errore qui viene solo loggato, il resto della mappa (paesi, confini,
  // ecc. più sotto in questa funzione) si carica comunque.
  try {
    // SEMPRE inserito con beforeId=LYR_FILL, quindi resta sotto al
    // riempimento dei paesi e non tocca mai territori/confini.
    initOceanBackground(state.map, LYR_FILL);
    applyOceanTheme(state);
  } catch (err) {
    console.error('[map] layer ambientale del mare non caricato:', err);
  }
  try {
    // Easter egg illustrati del tema scuro (flotta/portaerei/cargo/onda) —
    // nessun beforeId: si aggiungono sopra a tutto il resto (decorativi,
    // stesso principio "solo immagini sulla mappa" del tema chiaro).
    initDarkFleetTheme(state.map);
    applyDarkFleetTheme(state);
  } catch (err) {
    console.error('[map] easter egg tema scuro non caricati:', err);
  }
  try {
    // Rotte "color seppia" inserite anch'esse con beforeId=LYR_FILL, come
    // quelle del tema scuro (i marker easter-egg invece vanno in cima,
    // nessun beforeId, gestito internamente).
    initAntiqueTheme(state.map, LYR_FILL);
    applyAntiqueTheme(state);
  } catch (err) {
    console.error('[map] estetica "mappa antica" non caricata:', err);
  }

  if (!state.map.getSource('original-borders-src')) {
    const origMesh = _getOriginalBordersMesh(topoData);
    state.map.addSource('original-borders-src', { type: 'geojson', data: origMesh });
    state.map.addLayer({ id: 'original-borders-line', type: 'line', source: 'original-borders-src', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.9 }, layout: { visibility: 'none' } });
  }

  if (!state.map.getLayer(LYR_MULTI_BLOC)) {
    state.map.addLayer({
      id: LYR_MULTI_BLOC, type: 'fill', source: SRC_REGIONS,
      filter: ['==', ['get', 'countryId'], '___none___'],
      layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.92 },
    });
  }
  if (!state.map.getLayer('multi-bloc-pattern-original')) {
    state.map.addLayer({
      id: 'multi-bloc-pattern-original', type: 'fill', source: SRC_REGIONS,
      filter: ['==', ['get', 'initialCountryId'], '___none___'],
      layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.92 },
    });
  }

  if (!state.map.getSource(SRC_BATTLE_REGION)) {
    // WarEra+: contorno rosso della SOLA regione (non l'intera nazione)
    // dove si svolge la battaglia selezionata. Sorgente dedicata,
    // aggiornata da battleMarkers.js con la geometria esatta della
    // regione trovata tramite query geografica (vedi highlightBattleRegion),
    // non un filtro per proprietà — non è garantito che le feature della
    // mappa espongano un id regione utilizzabile come filtro diretto.
    state.map.addSource(SRC_BATTLE_REGION, {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!state.map.getLayer(LYR_BATTLE_REGION_FILL)) {
    // WarEra+: riempimento dell'intera regione (non solo il contorno),
    // stessa sorgente del contorno sotto — aggiornati insieme da
    // highlightBattleRegion. Messo PRIMA del layer contorno nell'ordine
    // di creazione così il contorno resta sopra (più nitido) invece di
    // essere coperto dal riempimento.
    state.map.addLayer({
      id: LYR_BATTLE_REGION_FILL, type: 'fill', source: SRC_BATTLE_REGION,
      paint: { 'fill-color': '#ffee00', 'fill-opacity': 0.45 },
    });
  }
  if (!state.map.getLayer(LYR_BATTLE_REGION)) {
    // WarEra+ fix: era rosso, ma si perdeva quando la regione stessa
    // risultava colorata di rosso intenso dalla heatmap battaglia (lato
    // difensore molto coinvolto — vedi buildBattleHeatmapColorExpression
    // in battleHeatmap.js, che usa una scala che arriva a rosso pieno).
    // Il giallo contrasta bene sia col rosso sia col blu (lato attaccante)
    // usati dalla heatmap.
    state.map.addLayer({
      id: LYR_BATTLE_REGION, type: 'line', source: SRC_BATTLE_REGION,
      paint: { 'line-color': '#ffee00', 'line-width': 3.5, 'line-opacity': 1 },
    });
  }

  if (!state.map.getLayer(LYR_BLOC_FLASH)) {
    // WarEra+: effetto "blink" quando si clicca un'alleanza nella
    // legenda — riusa SRC_REGIONS con un filtro sui membri del blocco
    // cliccato, alternando la visibilità (vedi flashBlocOnMap sotto).
    state.map.addLayer({
      id: LYR_BLOC_FLASH, type: 'fill', source: SRC_REGIONS,
      filter: ['==', ['get', 'countryId'], '___none___'],
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#ffee00', 'fill-opacity': 0.6 },
    });
  }

  if (!state.map.getSource(SRC_DIPLOMACY_DUAL_BORDER)) {
    // Fix: prima questo layer leggeva da SRC_REGIONS (poligoni delle singole
    // regioni interne), quindi 'line' disegnava il contorno di OGNI regione,
    // comprese le divisioni interne tra regioni dello stesso paese. Ora usa
    // una sorgente dedicata contenente solo la mesh dei confini ESTERNI
    // (calcolata dinamicamente in _updateDualBorderMesh, stesso principio
    // di topojson.mesh già usato per bordersMesh/_getOriginalBordersMesh).
    state.map.addSource(SRC_DIPLOMACY_DUAL_BORDER, {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!state.map.getLayer(LYR_DIPLOMACY_DUAL)) {
    // WarEra+ (Opzione A): bordo colorato invece di riempimento a strisce.
    // Il vecchio pattern (strisce verde/viola su un tile 16px) diventava
    // illeggibile a molti zoom, si "impastava" in un colore sporco. Un
    // bordo dedicato è leggibile a qualunque zoom: il riempimento resta
    // il verde normale di ALLY_DIRECT, il bordo viola comunica "anche
    // patto difensivo" come canale visivo separato.
    state.map.addLayer({
      id: LYR_DIPLOMACY_DUAL, type: 'line', source: SRC_DIPLOMACY_DUAL_BORDER,
      layout: { visibility: 'none' },
      paint: { 'line-color': COLORS.DEFENSIVE_PACT, 'line-width': 5, 'line-opacity': 1 },
    });
  }

  if (!state.map.getLayer(LYR_COAST)) state.map.addLayer({ id: LYR_COAST, type: 'line', source: SRC_BORDERS, filter: ['==', ['get', 'kind'], 'coast'], paint: { 'line-color': '#ffffff', 'line-width': 1.0, 'line-opacity': 0.9 } });
  // WarEra+: width alzata da 1.2 a 2.2 ("confini più marcati", richiesto
  // esplicitamente dopo che nasconderli del tutto — vedi renderMap qui
  // sotto — li aveva resi troppo poco visibili). Un 1.2 qui per tornare
  // alla larghezza originale se troppo marcato.
  if (!state.map.getLayer(LYR_BORDER)) state.map.addLayer({ id: LYR_BORDER, type: 'line', source: SRC_BORDERS, filter: ['==', ['get', 'kind'], 'border'], paint: { 'line-color': '#ffffff', 'line-width': 2.2, 'line-opacity': 1 } });
  if (!state.map.getLayer(LYR_OUTLINE)) state.map.addLayer({ id: LYR_OUTLINE, type: 'line', source: SRC_BORDERS, filter: ['==', ['get', 'kind'], 'region'], paint: { 'line-color': '#000000', 'line-width': 0.4, 'line-opacity': 1 } });
  if (state.map.getLayer(LYR_OUTLINE) && state.map.getLayer(LYR_BORDER)) state.map.moveLayer(LYR_OUTLINE, LYR_BORDER);

  initLabelCanvas();
  preloadAllFlags();
  initNationTooltip(state.map);
state.map.on('click', (e) => {
  // Se siamo in battleHeatmap
  if (state.coloringMode === 'battleHeatmap') {
    // Controlla se il click è su un marker di battaglia
    const target = e.originalEvent?.target;
    const isMarker = target && target.closest && target.closest('.battle-marker');
    
    // Se NON è un marker, esci dalla heatmap
    if (!isMarker) {
      import('./battleHeatmap.js').then(m => m.exitBattleHeatmap());
    }
  }

  // WarEra+: click sull'oceano (nessuna nazione in quel punto) deseleziona
  // il blocco in focus, se presente — prima questo caso non era gestito
  // affatto: la deselezione avveniva solo cliccando un'altra nazione,
  // non "cliccando fuori" nel senso più comune del termine.
  if (state.coloringMode === 'blocs' && state.selectedBlocId) {
    const features = state.map.queryRenderedFeatures(e.point, { layers: [LYR_FILL] });
    if (!features.length) {
      state.selectedBlocId = null;
      clearBlocFlash();
      renderMap();
      import('../panel/countryPanel.js').then(m => m.selectBlocInPanel(null));
    }
  } else if (state.coloringMode === 'diplomacy' && state.selectedCountryId) {
    // Stesso principio del ramo blocs sopra, ma per la selezione nazione
    // "normale": _onRegionClick (bound solo a LYR_FILL) toggla la selezione
    // cliccando la STESSA nazione o ne seleziona un'altra cliccandone
    // un'altra, ma non gestiva affatto il click sul mare (nessuna feature
    // LYR_FILL in quel punto, quindi _onRegionClick non scattava proprio) —
    // "clicco fuori sul mare per uscire dalla selezione non funziona".
    const features = state.map.queryRenderedFeatures(e.point, { layers: [LYR_FILL] });
    if (!features.length) {
      state.selectedCountryId = null;
      hideTooltip();
      renderMap();
    }
  }
});
  state.map.on('click', LYR_FILL, _onRegionClick)
  state.map.on('mouseenter', LYR_FILL, () => { state.map.getCanvas().style.cursor = 'pointer'; });
  state.map.on('mouseleave', LYR_FILL, () => { state.map.getCanvas().style.cursor = ''; });

  await buildMultiBlocPatternExpression();
  renderMap();
}

// ==================== RENDER MAPPA ====================
export function renderMap() {
  if (!state.map || !state.mapDataGlobal) return;
  if (!state.alliancesList && state.coloringMode === 'blocs') return;
  if (!state.selectedCountryId) {
    hideTooltip();
  }
  updateDynamicLegend();
  updateStats();
  updateSelectedDisplay();

  // WarEra+: round 2 — nasconderlo del tutto (vedi commit precedente) lo
  // aveva reso troppo poco visibile; ripristinato SEMPRE visibile come
  // prima (con width alzata, vedi setupMapLayers) invece di dipendere solo
  // dal hover. La coastline (LYR_COAST, terra/oceano) è invece nascosta per
  // la prima volta ora, in prova — se non convince: `_setLayerVisibility(
  // LYR_COAST, true)` più `line-width: 1.0` in setupMapLayers per tornare
  // esattamente a come era (coastline bianca + confini sottili 1.2px).
  _setLayerVisibility(LYR_BORDER, state.mapSource === 'actual');
  _setLayerVisibility('original-borders-line', state.mapSource === 'original');
  _setLayerVisibility(LYR_COAST, false);

  const multiIds = [...state.multiBlocMap.keys()];
  if (state.coloringMode === 'blocs' && multiIds.length > 0 && !state.selectedBlocId) {
    if (state.mapSource === 'original') {
      _setLayerVisibility(LYR_MULTI_BLOC, false);
      const lyr = 'multi-bloc-pattern-original';
      state.map.setFilter(lyr, ['in', ['get', 'initialCountryId'], ['literal', multiIds]]);
      state.map.setPaintProperty(lyr, 'fill-pattern', getMultiBlocPatternExpressionOriginal());
      _setLayerVisibility(lyr, true);
    } else {
      _setLayerVisibility('multi-bloc-pattern-original', false);
      state.map.setFilter(LYR_MULTI_BLOC, ['in', ['get', 'countryId'], ['literal', multiIds]]);
      state.map.setPaintProperty(LYR_MULTI_BLOC, 'fill-pattern', getMultiBlocPatternExpression());
      _setLayerVisibility(LYR_MULTI_BLOC, true);
    }
  } else {
    _setLayerVisibility(LYR_MULTI_BLOC, false);
    _setLayerVisibility('multi-bloc-pattern-original', false);
  }

  let dualIds = [];
  if (state.coloringMode === 'diplomacy' && state.selectedCountryId) {
    dualIds = getDualAllyDefensiveIds(state.selectedCountryId);
  }
  if (state.coloringMode === 'diplomacy' && dualIds.length > 0) {
    _updateDualBorderMesh(dualIds);
    _setLayerVisibility(LYR_DIPLOMACY_DUAL, true);
    // WarEra+: il badge (Opzione B) usa state.centroids, che associa sia
    // l'id attuale sia quello originale allo stesso punto senza distinzione
    // di modalità — in 'actual' potrebbe quindi comparire sulla posizione
    // di un territorio ormai occupato da un'altra nazione. Il bordo
    // (Opzione A) invece ricalcola la mesh correttamente per entrambe le
    // modalità (vedi _updateDualBorderMesh) e resta visibile in entrambe.
    if (state.mapSource === 'original') {
      updateDualBadges(dualIds);
    } else {
      clearDualBadges();
    }
  } else {
    _setLayerVisibility(LYR_DIPLOMACY_DUAL, false);
    clearDualBadges();
  }

  let directWars = [], directAllies = [], enemyAllies = [];
  if (state.coloringMode === 'diplomacy' && state.selectedCountryId) {
    const target = state.nationMap.get(state.selectedCountryId);
    if (target) {
      directWars = [...(target.warsWith || [])];
      const dipl = state.diplomacyData.get(state.selectedCountryId);
      if (dipl?.swornEnemy) directWars.push(dipl.swornEnemy);
      directWars = [...new Set(directWars)];

      directAllies = getAllianceAllies(state.selectedCountryId);
      enemyAllies = getEnemyAllies(state.selectedCountryId);
    }
  }

  let fillExpr;
  if (state.coloringMode === 'population') {
    fillExpr = buildPopulationColorExpression(state.mapSource === 'original');
  } else if (state.coloringMode === 'weeklyDamage') {
    fillExpr = buildWeeklyDamageColorExpression(state.mapSource === 'original');
  } else if (state.coloringMode === 'sphereOfInfluence') {
    fillExpr = buildSphereColorExpression(state.mapSource === 'original');
  } else if (state.coloringMode === 'blocs') {
    if (state.selectedBlocId) {
      fillExpr = buildBlocFocusColorExpression(state.selectedBlocId, state.mapSource === 'original' ? 'initialCountryId' : 'countryId');
    } else {
      fillExpr = state.mapSource === 'actual' ? buildBlocColorExpression() : buildOriginalBlocColorExpression();
    }
  } else if (state.coloringMode === 'battleHeatmap') {
    fillExpr = buildBattleHeatmapColorExpression(state.mapSource === 'original');
  } else if (state.mapSource === 'actual') {
    const styleMap = {};
    state.labelsData.forEach(l => { if (l.properties?.countryId) styleMap[l.properties.countryId] = l.properties.strokeColor; });
    fillExpr = buildDiplomacyColorExpression(directWars, directAllies, enemyAllies, styleMap);
  } else {
    fillExpr = buildOriginalColorExpression(directWars, directAllies, enemyAllies);
  }

  if (state.map.getLayer(LYR_FILL)) {
    state.map.setPaintProperty(LYR_FILL, 'fill-color', fillExpr);
    state.map.setPaintProperty(LYR_FILL, 'fill-opacity', 0.9);
  }

  // WarEra+ perf: qui c'era una ricostruzione di centinaia di Feature
  // (_buildLabelsWithPopulation) ri-pubblicate su SRC_LABELS nelle modalità
  // popolazione/danni settimanali. Rimossa insieme alla sorgente stessa:
  // SRC_LABELS non aveva NESSUN layer che la leggesse (le etichette sono
  // passate da tempo al canvas 2D di labels.js) — era lavoro sprecato che
  // per giunta risvegliava il render loop ad ogni renderMap.
  if (state.labelCanvas) state.map.triggerRepaint();
}

// ==================== PRIVATE ====================
function _addOrUpdateSource(id, config) {
  if (!state.map.getSource(id)) state.map.addSource(id, config);
  else state.map.getSource(id).setData(config.data);
}

function _setLayerVisibility(id, visible) {
  if (state.map.getLayer(id)) state.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

// Prima questa funzione faceva JSON.parse(JSON.stringify(topoData)) su tutto
// il TopoJSON (potenzialmente svariati MB, in modo sincrono: era la causa piu'
// probabile dello scatto al primo caricamento) solo per riscrivere countryId
// con initialCountryId e poi confrontarlo.
// Il filtro di topojson.mesh riceve gia' le geometrie: basta confrontare
// direttamente initialCountryId. Nessuna copia, stesso risultato.
function _getOriginalBordersMesh(topoData) {
  const origId = (g) => g.properties?.initialCountryId ?? g.properties?.countryId;
  return topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && origId(a) !== origId(b));
}

// WarEra+: mesh dinamica dei confini ESTERNI per le nazioni "dual" (alleato +
// patto difensivo). Stesso principio di bordersMesh/_getOriginalBordersMesh
// (topojson.mesh unisce solo i segmenti condivisi tra countryId diversi,
// escludendo di per sé le divisioni interne tra regioni della stessa
// nazione), ma filtrata a includere solo i confini che toccano almeno una
// nazione in dualIds — così il bordo appare solo intorno alla sagoma
// esterna di quelle nazioni, non ovunque nel mondo.
// Cache sulla firma degli id: ricalcola solo se la selezione è cambiata,
// non ad ogni renderMap() (che viene chiamato anche per motivi non
// correlati: cambio tema, resize, switch di modalità colore, ecc.).
let _lastDualIdsSignature = null;
function _updateDualBorderMesh(dualIds) {
  if (!state.mapDataGlobal?.map) return;
  const propKey = state.mapSource === 'original' ? 'initialCountryId' : 'countryId';
  const dualSet = new Set(dualIds);
  const signature = `${propKey}|${[...dualSet].sort().join(',')}`;
  if (signature === _lastDualIdsSignature) return;
  _lastDualIdsSignature = signature;

  const topoData = state.mapDataGlobal.map;
  const idOf = (g) => (propKey === 'initialCountryId' ? (g.properties?.initialCountryId ?? g.properties?.countryId) : g.properties?.countryId);
  const mesh = topojson.mesh(
    topoData, topoData.objects.regions,
    (a, b) => a !== b && idOf(a) !== idOf(b) && (dualSet.has(idOf(a)) || dualSet.has(idOf(b)))
  );

  const source = state.map.getSource(LAYER_IDS.SRC_DIPLOMACY_DUAL_BORDER);
  if (source) source.setData({ type: 'Feature', properties: {}, geometry: mesh });
}

function _onRegionClick(e) {
  if (!e.features?.length) return;
  // WarEra+: mentre la time machine è aperta, il click su una regione mostra
  // il proprietario storico (gestito da src/app/timeMachine.js, che aggancia
  // il proprio listener) invece di selezionare la nazione live — additivo,
  // non tocca il comportamento normale (state.timeMachineActive è false di
  // default, vedi state.js).
  if (state.timeMachineActive) return;
  const cId = state.mapSource === 'original'
    ? e.features[0].properties.initialCountryId
    : e.features[0].properties.countryId;

  // WarEra+: in modalità 'blocs' il click seleziona il BLOCCO (alleanza)
  // a cui appartiene la nazione cliccata, non la singola nazione — la
  // mappa evidenzia poi la situazione diplomatica aggregata di tutto il
  // blocco (vedi buildBlocFocusColorExpression in diplomacy.js).
  if (state.coloringMode === 'blocs') {
    const allianceIds = state.nationAlliancesMap.get(cId);
    const blocId = allianceIds && allianceIds.size > 0 ? [...allianceIds][0] : null;
    if (blocId) {
      state.selectedBlocId = state.selectedBlocId === blocId ? null : blocId;
    } else {
      state.selectedBlocId = null; // nazione senza alleanza: nessun focus possibile
    }
    // Sicurezza: qualunque click che cambia la selezione blocco interrompe
    // ed elimina un'eventuale pulsazione "flash" ancora in corso su un
    // blocco diverso — evita che resti visibile un overlay giallo non più
    // pertinente (causa del bug "resta giallo" segnalato).
    clearBlocFlash();
    renderMap();
    // WarEra+: mostra/nasconde il pannello blocco nella colonna a destra
    // (import dinamico verso src/panel/, coerente con altri collegamenti
    // cross-modulo già presenti nel progetto, es. nationTooltip.js).
    import('../panel/countryPanel.js').then(m => m.selectBlocInPanel(state.selectedBlocId));
    if (window.umami && state.selectedBlocId) {
      const alliance = state.allianceMap.get(state.selectedBlocId);
      if (alliance) umami.track('bloc-click', { bloc: alliance.name });
    }
    return;
  }

  state.selectedCountryId = state.selectedCountryId === cId ? null : cId;
  if (!state.selectedCountryId) {
    hideTooltip();
  }
  renderMap();
  if (window.umami && state.selectedCountryId) {
    const nation = state.nationMap.get(state.selectedCountryId);
    if (nation) umami.track('nation-click', { nation: nation.name });
  }
}

// ==================== CENTROIDI (per battle markers) ====================
function computeCentroids() {
  state.centroids.clear();
  if (!state.baseGeoJSON) return;
  const flattenCoords = (geometry) => {
    const result = [];
    function extract(c) {
      if (!c) return;
      if (typeof c[0] === 'number') result.push(c);
      else c.forEach(extract);
    }
    extract(geometry.coordinates);
    return result;
  };

  state.baseGeoJSON.features.forEach(f => {
    const initId = f.properties?.initialCountryId;
    const curId = f.properties?.countryId;
    if (!initId && !curId) return;
    const coords = flattenCoords(f.geometry);
    if (!coords.length) return;
    let sumLng = 0, sumLat = 0;
    coords.forEach(coord => { sumLng += coord[0]; sumLat += coord[1]; });
    const c = [sumLng / coords.length, sumLat / coords.length];
    if (curId && !state.centroids.has(curId)) state.centroids.set(curId, c);
    if (initId && !state.centroids.has(initId)) state.centroids.set(initId, c);
  });
}

// ==================== RICERCA E RESET ====================
export function cercaNazione() {
  const input = document.getElementById('cercaInput');
  const val = input.value.toLowerCase().trim();
  if (!val) return;
  const found = state.nazioniGlobal.find(n => n.name.toLowerCase() === val) || state.nazioniGlobal.find(n => n.name.toLowerCase().includes(val));
  if (found) {
    state.selectedCountryId = found._id;
    input.value = found.name;
    renderMap();
    const label = state.labelsData.find(l => l.properties?.countryId === found._id);
    if (label) state.map.flyTo({ center: label.coordinates, zoom: Math.max(state.map.getZoom(), 3) });
    if (window.innerWidth <= 768) document.getElementById('dynamic-legend').classList.add('hidden');
  }
}

// WarEra+: evidenzia il contorno della SINGOLA regione dove si svolge una
// battaglia (non l'intera nazione). Approccio scelto deliberatamente:
// invece di filtrare le feature della mappa per un presunto nome di
// proprietà "id regione" (che non è stato possibile verificare contro i
// dati live in questo ambiente), si proietta la posizione nota della
// regione (da region.getById, già usata altrove per i marker battaglia)
// in coordinate schermo e si interroga la mappa per la feature
// EFFETTIVAMENTE renderizzata in quel punto — poi si usa la SUA
// geometria per disegnare il contorno. Robusto indipendentemente dai
// nomi delle proprietà nei dati vettoriali.
export function highlightBattleRegion(position) {
  if (!state.map || !position) return;
  let lngLat;
  if (Array.isArray(position)) lngLat = position;
  else if (position.lng != null && position.lat != null) lngLat = [position.lng, position.lat];
  else if (position.lon != null && position.lat != null) lngLat = [position.lon, position.lat];
  else if (position.x != null && position.y != null) lngLat = [position.x, position.y];
  else return;

  try {
    const screenPoint = state.map.project(lngLat);
    const features = state.map.queryRenderedFeatures(screenPoint, { layers: [LYR_FILL] });
    const source = state.map.getSource(SRC_BATTLE_REGION);
    if (!source) return;
    if (!features.length) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    source.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: features[0].geometry }],
    });
  } catch (err) {
    console.warn('WarEra+ highlightBattleRegion: errore nel localizzare la regione', err);
  }
}

export function clearBattleRegionHighlight() {
  const source = state.map?.getSource(SRC_BATTLE_REGION);
  if (source) source.setData({ type: 'FeatureCollection', features: [] });
}

// WarEra+: pulsazione fluida sul territorio di un blocco, usata dal
// click su una voce della legenda (vedi ui.js). Riscritta rispetto alla
// prima versione (setInterval con visibility a scatti: netta, e con un
// bug di parità nel conteggio dei toggle che poteva lasciare il layer
// bloccato VISIBILE alla fine — causa del giallo che restava acceso
// anche uscendo dalla selezione). Ora anima l'opacità con requestAnimationFrame
// su un'onda sinusoidale smorzata (pulsa e si affievolisce), e alla fine
// nasconde SEMPRE il layer esplicitamente, senza dipendere da un
// conteggio di toggle che potrebbe terminare nello stato sbagliato.
let _blocFlashRAF = null;
export function flashBlocOnMap(allianceId) {
  if (!state.map) return;
  const memberIds = getBlocMemberIds(allianceId);
  if (!memberIds.length) return;
  const propKey = state.mapSource === 'original' ? 'initialCountryId' : 'countryId';
  state.map.setFilter(LYR_BLOC_FLASH, ['in', ['get', propKey], ['literal', memberIds]]);
  state.map.setLayoutProperty(LYR_BLOC_FLASH, 'visibility', 'visible');

  if (_blocFlashRAF) cancelAnimationFrame(_blocFlashRAF);
  const durationMs = 1400;
  const pulses = 2.5; // numero di pulsazioni complete nella durata totale
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    if (elapsed >= durationMs) {
      // Stato finale sempre garantito: nascosto, indipendentemente da
      // quante pulsazioni sono state completate.
      state.map.setLayoutProperty(LYR_BLOC_FLASH, 'visibility', 'none');
      _blocFlashRAF = null;
      return;
    }
    const t = elapsed / durationMs;
    const wave = (Math.sin(t * pulses * Math.PI * 2) + 1) / 2; // 0..1, oscilla
    const fade = 1 - t; // si affievolisce progressivamente verso la fine
    state.map.setPaintProperty(LYR_BLOC_FLASH, 'fill-opacity', 0.12 + wave * 0.5 * fade);
    _blocFlashRAF = requestAnimationFrame(step);
  }
  _blocFlashRAF = requestAnimationFrame(step);
}

// WarEra+: nasconde immediatamente il layer di flash, usata come
// sicurezza extra ogni volta che la selezione del blocco cambia per
// qualunque via (click su nazione, cambio modalità colore, reset) —
// indipendentemente dall'animazione qui sopra, che potrebbe essere
// ancora in corso.
export function clearBlocFlash() {
  if (_blocFlashRAF) {
    cancelAnimationFrame(_blocFlashRAF);
    _blocFlashRAF = null;
  }
  if (state.map && state.map.getLayer(LYR_BLOC_FLASH)) {
    state.map.setLayoutProperty(LYR_BLOC_FLASH, 'visibility', 'none');
  }
}

export function resetDiplomazia() {
  state.selectedCountryId = null;
  state.selectedBlocId = null;
  state.blocFocusColorMap.clear();
  clearBlocFlash();
  import('../panel/countryPanel.js').then(m => m.selectBlocInPanel(null));
  state.customNaps = [];
  document.getElementById('cercaInput').value = '';
  document.getElementById('napInput').value = '';
  document.getElementById('checkExcludeExternalNaps').checked = false;
  // setMapSource e setColoringMode chiamano gia' renderMap(): prima veniva
  // eseguita 3 volte di fila ad ogni reset.
  state.mapSource = 'actual';
  _syncMapSourceUI(false);
  setColoringMode('diplomacy');
  import('./naps.js').then(({ updateNapListUI }) => updateNapListUI());
}

function _syncMapSourceUI(isOriginal) {
  const lA = document.getElementById('label-actual');
  const lO = document.getElementById('label-original');
  if (lA && lO) {
    lA.classList.toggle('active', !isOriginal);
    lO.classList.toggle('active', isOriginal);
  }
  const tb = document.getElementById('toggle-borders');
  if (tb) tb.checked = isOriginal;
}

export function setMapSource(isOriginal) {
  state.mapSource = isOriginal ? 'original' : 'actual';
  _syncMapSourceUI(isOriginal);
  renderMap();
}

export function applyTheme() {
  const theme = THEMES[state.theme];
  if (!state.map) return;
  if (state.map.getLayer('background')) {
    state.map.setPaintProperty('background', 'background-color', theme.OCEAN);
  }
  if (state.map.getLayer(LYR_COAST)) {
    state.map.setPaintProperty(LYR_COAST, 'line-color', theme.COAST_COLOR);
  }
  if (state.map.getLayer(LYR_BORDER)) {
    state.map.setPaintProperty(LYR_BORDER, 'line-color', theme.BORDER_COLOR);
  }
  if (state.map.getLayer(LYR_OUTLINE)) {
    state.map.setPaintProperty(LYR_OUTLINE, 'line-color', theme.OUTLINE_COLOR);
  }
  if (state.map.getLayer(LYR_FILL)) {
    state.map.setPaintProperty(LYR_FILL, 'fill-color', theme.NEUTRAL_UNSELECTED);
  }
  applyOceanTheme(state); // nasconde il layer mare futuristico sul tema chiaro (pergamena)
  applyAntiqueTheme(state); // attiva/disattiva pergamena + easter egg quando si passa a/da tema chiaro
  applyDarkFleetTheme(state); // attiva/disattiva gli easter egg del tema scuro (flotta/portaerei/cargo/onda)
  renderMap();
}

// map.js - sostituisci la funzione setColoringMode

export function setColoringMode(mode) {
  state.coloringMode = mode;
  // WarEra+: il focus su un blocco ha senso solo restando in modalità
  // 'blocs' — se si cambia modalità (anche rientrando dopo), si riparte
  // dalla vista blocs "flat" invece di lasciare un focus obsoleto.
  if (mode !== 'blocs') {
    state.selectedBlocId = null;
    state.blocFocusColorMap.clear();
    // WarEra+ fix: era il punto mancante esatto del bug "uscendo dalla
    // vista blocchi i paesi restano gialli" — si azzerava lo stato ma
    // non si nascondeva l'eventuale animazione flash ancora in corso o
    // rimasta visibile su LYR_BLOC_FLASH.
    clearBlocFlash();
    import('../panel/countryPanel.js').then(m => m.selectBlocInPanel(null));
  }

  // battleHeatmap non ha un pulsante nella barra: senza questo, tutti i
  // pulsanti restano spenti e la UI sembra "senza modalita'". Marchiamo la
  // barra cosi' il CSS puo' mostrare uno stato dedicato.
  const modeBar = document.getElementById('mode-slider')?.parentElement;
  if (modeBar) modeBar.classList.toggle('heatmap-active', mode === 'battleHeatmap');

  
  // Aggiorna i pulsanti della prima riga
  document.getElementById('mode-diplomacy').classList.toggle('active', mode === 'diplomacy');
  document.getElementById('mode-blocs').classList.toggle('active', mode === 'blocs');
  document.getElementById('mode-sphereOfInfluence')?.classList.toggle('active', mode === 'sphereOfInfluence');
  
  // Aggiorna i pulsanti della seconda riga
  document.getElementById('mode-weeklyDamage').classList.toggle('active', mode === 'weeklyDamage');
  document.getElementById('mode-population').classList.toggle('active', mode === 'population');
  
  // Slider prima riga (3 pulsanti: diplomacy, blocs, sphere)
  const sliderTop = document.getElementById('mode-slider');
  if (sliderTop) {
    const isMobile = window.innerWidth <= 768;
    const positions = {
      diplomacy: isMobile ? '2px' : '3px',
      blocs: isMobile ? 'calc(33.33% + 0.5px)' : 'calc(33.33% + 0.6px)',
      sphereOfInfluence: isMobile ? 'calc(66.66% + 0.5px)' : 'calc(66.66% + 0.6px)'
    };
    // Per i modi della seconda riga, nascondi lo slider o mettilo in una posizione neutra
    if (mode === 'weeklyDamage' || mode === 'population') {
      sliderTop.style.opacity = '0.3';
    } else {
      sliderTop.style.opacity = '1';
      sliderTop.style.left = positions[mode] || '3px';
    }
  }
  
  // Slider seconda riga (2 pulsanti: weeklyDamage, population)
  const sliderBottom = document.getElementById('mode-slider-bottom');
  if (sliderBottom) {
    const isMobile = window.innerWidth <= 768;
    const positions = {
      weeklyDamage: isMobile ? '2px' : '3px',
      population: isMobile ? 'calc(50% + 0.5px)' : 'calc(50% + 0.6px)'
    };
    if (mode === 'weeklyDamage' || mode === 'population') {
      sliderBottom.style.opacity = '1';
      sliderBottom.style.left = positions[mode] || '3px';
    } else {
      sliderBottom.style.opacity = '0.3';
      // Rimani nella posizione precedente o nascondi
      if (state._lastBottomMode) {
        sliderBottom.style.left = positions[state._lastBottomMode] || '3px';
      }
    }
    // Salva l'ultimo modo della seconda riga
    if (mode === 'weeklyDamage' || mode === 'population') {
      state._lastBottomMode = mode;
    }
  }
  
  renderMap();
}