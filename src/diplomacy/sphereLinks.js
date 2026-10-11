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

   ── FILTRO (feedback utente: «decisamente troppo cluttered») ──
   Tutte le sfere insieme sono ~60 fili sopra una mappa già tinta. Quindi
   di partenza si vedono SOLO quelli della sfera aperta nel pannello
   (state.selectedSphereId, rispecchiato da countryPanel.js): il
   riepilogo di tutte le sfere resta pulito, e cliccando una potenza o un
   suo proxy compaiono i suoi. Due comandi nel pannello (riepilogo e
   scheda della sfera) cambiano la scelta: quali fili (sfera aperta /
   tutte / nessuno) e da che fonte (CSV / radar / entrambi). La scelta sta
   in localStorage (`we_sphere_links`), è una comodità di chi guarda.

   Animazione, diversa da quelle delle altre viste: un IMPULSO di luce
   che parte dalla potenza e corre lungo il filo fino al proxy, uno ogni
   qualche secondo, sfasati fra loro — l'influenza che scorre in una
   direzione sola. Ferma uscendo dalla vista e sotto gli overlay
   (mapIdle.js).
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { countryAnchor, arc, alongArc, brightenColor } from './flowGeometry.js';
import { mergedSphereGroups } from '../proxy/radar.js';
import { getLang } from '../shared/i18n.js';
import { escapeHtml } from './utils.js';

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

/* ── Preferenze ── */
const PREFS_KEY = 'we_sphere_links';
const MODES = ['selected', 'all', 'off'];
const SOURCES = ['both', 'csv', 'radar'];
let _prefs = null;

export function sphereLinkPrefs() {
  if (!_prefs) {
    _prefs = { mode: 'selected', source: 'both' };
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (MODES.includes(saved?.mode)) _prefs.mode = saved.mode;
      if (SOURCES.includes(saved?.source)) _prefs.source = saved.source;
    } catch { /* storage bloccato: valgono i valori di partenza */ }
  }
  return _prefs;
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(_prefs)); } catch { /* idem */ }
}

/* ── Testi dei comandi (dizionario LOCALE, chiave = inglese, 9 lingue) ── */
const ORDINE = ['it', 'es', 'de', 'fr', 'nl', 'sv', 'pt', 'ar'];
const T = {
  'Links on the map': ['Fili sulla mappa', 'Hilos en el mapa', 'Fäden auf der Karte', 'Fils sur la carte', 'Draden op de kaart', 'Trådar på kartan', 'Fios no mapa', 'الخيوط على الخريطة'],
  'Open sphere': ['Sfera aperta', 'Esfera abierta', 'Offene Sphäre', 'Sphère ouverte', 'Open sfeer', 'Öppen sfär', 'Esfera aberta', 'النطاق المفتوح'],
  'All': ['Tutte', 'Todas', 'Alle', 'Toutes', 'Alle', 'Alla', 'Todas', 'الكل'],
  'None': ['Nessuno', 'Ninguno', 'Keine', 'Aucun', 'Geen', 'Inga', 'Nenhum', 'لا شيء'],
  'Source': ['Fonte', 'Fuente', 'Quelle', 'Source', 'Bron', 'Källa', 'Fonte', 'المصدر'],
  'Both': ['Entrambe', 'Ambas', 'Beide', 'Les deux', 'Beide', 'Båda', 'Ambas', 'كلاهما'],
  'Click a sphere to see its links.': ['Clicca una sfera per vederne i fili.', 'Haz clic en una esfera para ver sus hilos.', 'Klicke auf eine Sphäre, um ihre Fäden zu sehen.', 'Clique sur une sphère pour voir ses fils.', 'Klik op een sfeer om de draden te zien.', 'Klicka på en sfär för att se dess trådar.', 'Clica numa esfera para ver os seus fios.', 'انقر على نطاق لترى خيوطه.'],
};
function sT(k) {
  const i = ORDINE.indexOf(getLang());
  return (i >= 0 && T[k]?.[i]) || k;
}

/** I due comandi, per il riepilogo delle sfere e per la scheda di una
 *  sfera (countryPanel.js li inserisce e li collega con wireSphereLinkControls). */
export function sphereLinksControlHtml({ inOverview = false } = {}) {
  const p = sphereLinkPrefs();
  const seg = (label, attr, options, cur) => `
    <div class="wp-mig-seg" role="group" aria-label="${escapeHtml(label)}">
      <span class="wp-mig-seg-label">${escapeHtml(label)}</span>
      ${options.map(([v, text]) => `<button type="button" class="wp-travel-btn" data-${attr}="${v}" aria-pressed="${v === cur}">${escapeHtml(text)}</button>`).join('')}
    </div>`;
  return `<div class="wp-sphere-links-ctl">
    ${seg(sT('Links on the map'), 'sphere-links-mode', [['selected', sT('Open sphere')], ['all', sT('All')], ['off', sT('None')]], p.mode)}
    ${p.mode === 'off' ? '' : seg(sT('Source'), 'sphere-links-src', [['both', sT('Both')], ['csv', 'CSV'], ['radar', 'Radar']], p.source)}
    ${inOverview && p.mode === 'selected' ? `<div class="wp-mig-hint">${escapeHtml(sT('Click a sphere to see its links.'))}</div>` : ''}
  </div>`;
}

/** Collega i comandi; `rerender` ridisegna il pannello che li contiene
 *  (per aggiornare i bottoni accesi). */
export function wireSphereLinkControls(root, rerender) {
  root.querySelectorAll('[data-sphere-links-mode], [data-sphere-links-src]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = sphereLinkPrefs();
      if (btn.dataset.sphereLinksMode) p.mode = btn.dataset.sphereLinksMode;
      if (btn.dataset.sphereLinksSrc) p.source = btn.dataset.sphereLinksSrc;
      savePrefs();
      syncSphereLinks();
      rerender?.();
    });
  });
}

let _arcs = [];             // { coords, color, phase } per l'animazione
let _raf = null;
let _last = 0;
let _paused = false;
let _fxOn = false;

function features() {
  _arcs = [];
  const feats = [];
  let k = 0;
  const p = sphereLinkPrefs();
  if (p.mode === 'off') return feats;
  const only = p.mode === 'selected' ? state.selectedSphereId : null;
  if (p.mode === 'selected' && !only) return feats;
  for (const g of mergedSphereGroups({ forMap: true })) {
    if (only && g.primaryId !== only) continue;
    const home = countryAnchor(g.primaryId);
    if (!home) continue;
    const color = brightenColor(state.nationBaseColorMap.get(g.primaryId), 0.35);
    let drawn = 0;
    for (const px of g.proxies) {
      const isCsv = px.source === 'csv';
      if ((p.source === 'csv' && !isCsv) || (p.source === 'radar' && isCsv)) continue;
      const to = countryAnchor(px.id);
      if (!to || Math.hypot(to[0] - home[0], to[1] - home[1]) < MIN_ARC_DEG) continue;
      const { coords } = arc(home, to);
      feats.push({ type: 'Feature', properties: { c: color, src: isCsv ? 'csv' : 'radar' }, geometry: { type: 'LineString', coordinates: coords } });
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
