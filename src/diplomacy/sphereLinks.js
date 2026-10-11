/* ══════════════════════════════════════════════════════════════
   WarEra+ — I fili delle sfere d'influenza
   ------------------------------------------------------------------
   Richiesta dell'utente: in vista Sfera d'influenza, fili dalla potenza
   ai suoi proxy — pieni se il legame viene dal CSV compilato a mano,
   tratteggiati se è stimato dal radar (src/proxy/radar.js).

   Prima la sfera si vedeva solo come colore: potenza e proxy nella
   stessa tinta. Per due sfere vicine di colore simile, o per un proxy
   dall'altra parte del mondo, non si capiva CHI tirava i fili di chi.

   Zero fetch: gli stessi gruppi che tingono la mappa
   (mergedSphereGroups({ forMap: true }) — CSV sempre, radar solo sopra
   la soglia di sicurezza o col toggle "anche i rilevamenti incerti"),
   così un filo c'è esattamente dove c'è il colore. Capitali da
   flowGeometry.js. Colore = quello della potenza, schiarito: le tinte
   delle nazioni sono pensate per le campiture, non per una linea.

   Animazione, diversa da quelle delle altre viste: un IMPULSO di luce
   che parte dalla potenza e corre lungo il filo fino al proxy, uno ogni
   qualche secondo, sfasati fra loro — l'influenza che scorre in una
   direzione sola. Ferma uscendo dalla vista e sotto gli overlay
   (mapIdle.js).
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { countryAnchor, arc, alongArc, brightenColor } from './flowGeometry.js';
import { mergedSphereGroups } from '../proxy/radar.js';

const SRC = 'wp-sphere-links-src';
const SRC_FX = 'wp-sphere-links-fx-src';
const LYR_CSV = 'wp-sphere-links-csv';
const LYR_RADAR = 'wp-sphere-links-radar';
const LYR_HUB = 'wp-sphere-links-hub';
const LYR_PULSE_GLOW = 'wp-sphere-links-pulse-glow';
const LYR_PULSE = 'wp-sphere-links-pulse';

const MIN_ARC_DEG = 1.2;
const PULSE_MS = 3600;      // il viaggio di un impulso dalla potenza al proxy
const FRAME_MS = 40;

let _arcs = [];             // { coords, color, phase } per l'animazione
let _raf = null;
let _last = 0;
let _paused = false;
let _fxOn = false;

function features() {
  _arcs = [];
  const feats = [];
  let k = 0;
  for (const g of mergedSphereGroups({ forMap: true })) {
    const home = countryAnchor(g.primaryId);
    if (!home) continue;
    const color = brightenColor(state.nationBaseColorMap.get(g.primaryId), 0.35);
    let drawn = 0;
    for (const p of g.proxies) {
      const to = countryAnchor(p.id);
      if (!to || Math.hypot(to[0] - home[0], to[1] - home[1]) < MIN_ARC_DEG) continue;
      const { coords } = arc(home, to);
      feats.push({ type: 'Feature', properties: { c: color, src: p.source === 'csv' ? 'csv' : 'radar' }, geometry: { type: 'LineString', coordinates: coords } });
      _arcs.push({ coords, color, phase: (k++ * 0.37) % 1 });
      drawn++;
    }
    if (drawn) feats.push({ type: 'Feature', properties: { c: color, role: 'hub' }, geometry: { type: 'Point', coordinates: home } });
  }
  return feats;
}

function ensureLayers(map) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource(SRC_FX, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const isLine = ['==', ['geometry-type'], 'LineString'];
  map.addLayer({
    id: LYR_CSV, type: 'line', source: SRC, filter: ['all', isLine, ['==', ['get', 'src'], 'csv']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.4, 5, 2.6], 'line-opacity': 0.75 },
  });
  map.addLayer({
    id: LYR_RADAR, type: 'line', source: SRC, filter: ['all', isLine, ['==', ['get', 'src'], 'radar']],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.4, 5, 2.6], 'line-opacity': 0.75, 'line-dasharray': [2, 2] },
  });
  map.addLayer({
    id: LYR_HUB, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'hub'],
    paint: { 'circle-radius': 5, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: LYR_PULSE_GLOW, type: 'circle', source: SRC_FX,
    paint: { 'circle-radius': 9, 'circle-color': ['get', 'c'], 'circle-blur': 1, 'circle-opacity': ['*', ['get', 'o'], 0.6] },
  });
  map.addLayer({
    id: LYR_PULSE, type: 'circle', source: SRC_FX,
    paint: { 'circle-radius': 3, 'circle-color': '#ffffff', 'circle-opacity': ['get', 'o'] },
  });
}

function tick(now) {
  _raf = null;
  const map = state.map;
  if (_paused || state.timeMachineActive || state.coloringMode !== 'sphereOfInfluence' || !_arcs.length || !map?.getSource(SRC_FX)) {
    if (_fxOn) { map?.getSource(SRC_FX)?.setData({ type: 'FeatureCollection', features: [] }); _fxOn = false; }
    return;
  }
  if (now - _last >= FRAME_MS) {
    _last = now;
    const feats = [];
    for (const a of _arcs) {
      const t = (now / PULSE_MS + a.phase) % 1;
      // Nasce e muore dolce: niente punto che compare di colpo sulla capitale.
      const o = Math.min(1, t * 6, (1 - t) * 6);
      feats.push({ type: 'Feature', properties: { c: a.color, o }, geometry: { type: 'Point', coordinates: alongArc(a.coords, t) } });
    }
    map.getSource(SRC_FX).setData({ type: 'FeatureCollection', features: feats });
    _fxOn = true;
  }
  _raf = requestAnimationFrame(tick);
}

function start() {
  if (_raf || _paused) return;
  _raf = requestAnimationFrame(tick);
}

/** Overlay a tutto schermo sopra la mappa (src/app/mapIdle.js). */
export function pauseSphereLinks() {
  _paused = true;
  if (_raf) cancelAnimationFrame(_raf);
  _raf = null;
}

export function resumeSphereLinks() {
  _paused = false;
  if (state.coloringMode === 'sphereOfInfluence' && _arcs.length) start();
}

/** Chiamata da renderMap a ogni ridisegno: accende i fili in vista Sfera,
 *  li toglie fuori. Il radar che arriva dopo ridisegna la mappa, e con lei
 *  i fili (countryPanel.js: repaintSphereMap). */
export function syncSphereLinks() {
  const map = state.map;
  if (!map?.getLayer('regions-fill')) return;
  const on = state.coloringMode === 'sphereOfInfluence';
  if (!on && !map.getSource(SRC)) return;
  if (on) ensureLayers(map);
  map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: on ? features() : [] });
  if (!on) {
    _arcs = [];
    if (_raf) cancelAnimationFrame(_raf);
    _raf = null;
    if (_fxOn) { map.getSource(SRC_FX)?.setData({ type: 'FeatureCollection', features: [] }); _fxOn = false; }
    return;
  }
  if (_arcs.length) start();
}
