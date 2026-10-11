/* ══════════════════════════════════════════════════════════════
   WarEra+ — Le conquiste animate nella time machine
   ------------------------------------------------------------------
   Richiesta dell'utente: durante la riproduzione della time machine, una
   freccia lampo dalla nazione che conquista alla regione presa, con
   un'onda di colore sul territorio.

   Zero fetch: gli eventi di passaggio di mano ({ts, regionId, toCountry})
   timeMachine.js li carica già una volta per sessione per il salto
   "evento precedente/successivo" e per il "dal —" del popup. A ogni
   fotogramma applicato gli si passano quelli caduti fra l'istante di
   prima e quello nuovo, e si disegnano qui sopra la mappa DEDICATA della
   time machine (timeMachineMap.js) — la principale è nascosta e non si
   tocca.

   ── Da dove parte la freccia ───────────────────────────────────
   Dalla capitale ORIGINARIA del conquistatore (la regione con isCapital
   e initialCountry = lui, in state.regionData): in un fotogramma di
   aprile la capitale di oggi può essere stata presa nel frattempo, la
   capitale di partenza no. Chi una capitale non l'ha mai avuta (nazioni
   nate dopo) ricade sul punto d'aggancio di oggi (flowGeometry.js).

   ── Quante alla volta ──────────────────────────────────────────
   ~20 passaggi di mano al giorno in media, e la riproduzione corre fino
   a 3 giorni al secondo: senza un tetto sarebbero sessanta frecce al
   secondo. Quindi:
     · un salto lungo (trascinamento, data scelta a mano) non anima
       niente oltre gli ultimi MAX_SPAN_MS: chi salta di due mesi vuole
       la mappa di allora, non duemila lampi;
     · per fotogramma al massimo MAX_PER_FRAME, le più recenti;
     · a schermo al massimo MAX_LIVE, le più vecchie cedono il posto.
   Indietro nel tempo non si anima niente: una conquista vista al
   contrario non è una conquista.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { arc, alongArc, countryAnchor, brightenColor } from '../diplomacy/flowGeometry.js';
import { getTimeMachineMap, TM_LYR_FILL } from './timeMachineMap.js';
import { animationsOn } from '../shared/motion.js';

const SRC = 'wp-tm-conq-src';
const LYR_GLOW = 'wp-tm-conq-glow';
const LYR_LINE = 'wp-tm-conq-line';
const LYR_RING = 'wp-tm-conq-ring';
const LYR_TIP = 'wp-tm-conq-tip';

const MAX_SPAN_MS = 4 * 24 * 60 * 60 * 1000;
const MAX_PER_FRAME = 6;
const MAX_LIVE = 14;
const STAGGER_MS = 70;      // fra due lampi dello stesso fotogramma
const DRAW_MS = 450;        // la freccia che si allunga fino alla regione
const RING_MS = 1300;       // l'onda sulla regione, dopo l'arrivo
const FADE_MS = 800;        // la freccia che svanisce, dopo l'arrivo
const MIN_ARC_DEG = 1.2;    // capitale quasi sulla regione: solo l'onda
const FALLBACK = '#ffd166';

let _capitals = null;
let _capitalsFrom = null;
let _effects = [];          // { start, coords, to, color }
let _raf = null;
let _on = false;

/** Capitale originaria per nazione, calcolata una volta per regionData. */
function originalCapital(countryId) {
  if (_capitalsFrom !== state.regionData) {
    _capitalsFrom = state.regionData;
    _capitals = new Map();
    for (const r of Object.values(state.regionData || {})) {
      if (r?.isCapital && r.initialCountry && Array.isArray(r.position)) _capitals.set(r.initialCountry, r.position);
    }
  }
  return _capitals.get(countryId) || countryAnchor(countryId);
}

function ensureLayers(map) {
  if (map.getSource(SRC)) return true;
  // Non isStyleLoaded(): torna false ogni volta che una sorgente sta
  // ricevendo dati, cioè a ogni fotogramma della riproduzione. Basta che
  // la mappa abbia i suoi layer (timeMachineMap.js li crea al 'load').
  if (!map.getLayer(TM_LYR_FILL)) return false;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const isLine = ['==', ['geometry-type'], 'LineString'];
  map.addLayer({
    id: LYR_GLOW, type: 'line', source: SRC, filter: isLine,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': 10, 'line-blur': 6, 'line-opacity': ['*', ['get', 'o'], 0.8] },
  });
  map.addLayer({
    id: LYR_LINE, type: 'line', source: SRC, filter: isLine,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 2.4, 'line-opacity': ['get', 'o'] },
  });
  map.addLayer({
    id: LYR_RING, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'ring'],
    paint: {
      'circle-radius': ['get', 'r'],
      'circle-color': ['get', 'c'],
      'circle-opacity': ['*', ['get', 'o'], 0.35],
      'circle-stroke-color': ['get', 'c'],
      'circle-stroke-width': 3.5,
      'circle-stroke-opacity': ['get', 'o'],
    },
  });
  map.addLayer({
    id: LYR_TIP, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'tip'],
    paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-blur': 0.3, 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': 2 },
  });
  return true;
}

function frameFeatures(now) {
  const feats = [];
  _effects = _effects.filter(e => now - e.start < DRAW_MS + Math.max(RING_MS, FADE_MS));
  for (const e of _effects) {
    const age = now - e.start;
    if (age < 0) continue;
    if (e.coords) {
      if (age < DRAW_MS) {
        // La freccia si allunga: si taglia l'arco alla frazione raggiunta.
        const k = age / DRAW_MS;
        const n = Math.max(1, Math.floor(k * (e.coords.length - 1)));
        const tip = alongArc(e.coords, k);
        feats.push({ type: 'Feature', properties: { c: e.color, o: 1 }, geometry: { type: 'LineString', coordinates: [...e.coords.slice(0, n), tip] } });
        feats.push({ type: 'Feature', properties: { c: e.color, role: 'tip' }, geometry: { type: 'Point', coordinates: tip } });
      } else if (age < DRAW_MS + FADE_MS) {
        const o = 1 - (age - DRAW_MS) / FADE_MS;
        feats.push({ type: 'Feature', properties: { c: e.color, o }, geometry: { type: 'LineString', coordinates: e.coords } });
      }
    }
    const ringAge = e.coords ? age - DRAW_MS : age;
    if (ringAge >= 0 && ringAge < RING_MS) {
      const t = ringAge / RING_MS;
      feats.push({ type: 'Feature', properties: { c: e.color, role: 'ring', r: 6 + 44 * t, o: (1 - t) * (1 - t) }, geometry: { type: 'Point', coordinates: e.to } });
    }
  }
  return feats;
}

function setData(features) {
  getTimeMachineMap()?.getSource(SRC)?.setData({ type: 'FeatureCollection', features });
  _on = features.length > 0;
}

function tick() {
  _raf = null;
  if (!state.timeMachineActive) { clearConquests(); return; }
  setData(frameFeatures(performance.now()));
  if (_effects.length) _raf = requestAnimationFrame(tick);
  else if (_on) setData([]);
}

/**
 * Le conquiste cadute in (prevTs, ts]: chiamata da timeMachine.js dopo
 * ogni fotogramma applicato. `events` è l'elenco ordinato per ts.
 */
export function animateConquests(events, prevTs, ts) {
  const map = getTimeMachineMap();
  // Animazioni spente: la conquista si vede già dal colore della regione.
  if (!map || !events?.length || !(ts > prevTs) || !animationsOn()) return;
  if (!ensureLayers(map)) return;
  const from = Math.max(prevTs, ts - MAX_SPAN_MS);
  // Ricerca binaria del primo evento dopo `from`.
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].ts <= from) lo = mid + 1; else hi = mid; }
  const fresh = [];
  for (let i = lo; i < events.length && events[i].ts <= ts; i++) fresh.push(events[i]);
  if (!fresh.length) return;
  const now = performance.now();
  fresh.slice(-MAX_PER_FRAME).forEach((ev, i) => {
    const to = state.regionData?.[ev.regionId]?.position;
    if (!Array.isArray(to)) return;
    const color = brightenColor((ev.toCountry && state.nationBaseColorMap?.get(ev.toCountry)) || FALLBACK, 0.45, FALLBACK);
    const cap = ev.toCountry ? originalCapital(ev.toCountry) : null;
    const coords = cap && Math.hypot(cap[0] - to[0], cap[1] - to[1]) >= MIN_ARC_DEG ? arc(cap, to).coords : null;
    _effects.push({ start: now + i * STAGGER_MS, coords, to, color });
  });
  if (_effects.length > MAX_LIVE) _effects = _effects.slice(-MAX_LIVE);
  if (!_raf) _raf = requestAnimationFrame(tick);
}

/** Chiusura della time machine (o salto indietro): via tutto. */
export function clearConquests() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = null;
  _effects = [];
  if (_on) setData([]);
}
