/* ══════════════════════════════════════════════════════════════
   WarEra+ — Vista mappa "Distanze" (quanto costa arrivare da A a B)
   ------------------------------------------------------------------
   Nata dal tool di nioKi (ni0ki.github.io/warera-distance-map, articolo
   del 16 set 2026), che fa la stessa cosa su una COPIA STATICA di
   map.getMapData presa una volta sola. Qui il dato è quello che la mappa
   ha già in memoria (state.mapDataGlobal, rinfrescato con la mappa):
   zero fetch nuove, e i confini sono sempre quelli di oggi.

   Il dato: ogni geometria di topoData.objects.regions porta `neighbors`
   (gli id delle regioni confinanti, misurato simmetrico: 726 regioni,
   nessuna coppia a senso unico, nessun id sconosciuto). La distanza è il
   numero di confini attraversati — una ricerca in ampiezza sul grafo —,
   non i chilometri: il mare, le guerre e i confini chiusi non entrano.

   ⚠️ I costi NON stanno in gameConfig (lì c'è solo la barra di stamina,
   `skills.stamina` = 100, e il ritorno gratis a casa,
   `region.freeTravelHomeCooldownHours` = 12). Sono quelli della patch
   0.26.1 come li usa il tool originale: 10 di stamina a regione, e oltre
   la barra 2 barili di petrolio a regione. Se il gioco li cambia, si
   cambiano le tre costanti qui sotto e basta. Si assume la barra PIENA:
   la stamina di chi guarda non la conosciamo.

   Tre pezzi, tutti qui dentro:
     · colore della mappa (renderMap → buildTravelColorExpression);
     · percorso disegnato + barra in basso (syncTravelOverlay, e l'hover);
     · riepilogo nel pannello: istogramma e giro delle casse di legno
       (travelOverviewHtml + wireTravelOverview, chiamati da
       viewOverview.js e countryPanel.js).
   Il giro delle casse è un Held-Karp su al più 5 casse, con in più lo
   stato "ritorno a casa gratis già speso o no": 32 × 5 × 2 stati, e ogni
   distanza è una BFS già in cache. Istantaneo.
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { COLORS } from './config.js';
import { escapeHtml } from './utils.js';
import { tT } from './travelI18n.js';
import { trackEvent } from '../shared/analytics.js';

export const STAMINA_PER_HOP = 10;
export const STAMINA_MAX = 100;
export const HOPS_PER_BAR = STAMINA_MAX / STAMINA_PER_HOP;
export const OIL_PER_EXTRA_HOP = 2;
export const FREE_HOME_HOURS = 12;   // gameConfig.region.freeTravelHomeCooldownHours
export const MAX_CASES = 5;

const HOME_KEY = 'we_travel_home';
const ORIGIN_COLOR = '#58a6ff';

const SRC = 'wp-travel-src';
const LYR_GLOW = 'wp-travel-glow';
const LYR_LINE = 'wp-travel-line';
const LYR_HOME = 'wp-travel-home-jump';
const LYR_DOTS = 'wp-travel-dots';
const LYR_NUMS = 'wp-travel-nums';

// ══════════════════ GRAFO ══════════════════

let _topo = null;
let _graph = new Map();       // regionId → [regionId confinanti]
let _pos = new Map();         // regionId → [lng, lat]
let _labelNames = new Map();  // regionId → nome, dalle etichette della mappa
const _bfs = new Map();       // origine → { dist, prev }

/** Ricostruisce il grafo solo se la mappa in memoria è cambiata
 *  (refreshData sostituisce l'oggetto intero). */
function graph() {
  const topo = state.mapDataGlobal?.map;
  if (!topo) return _graph;
  if (topo === _topo) return _graph;
  _topo = topo;
  _graph = new Map();
  _pos = new Map();
  _labelNames = new Map();
  _bfs.clear();
  for (const g of topo.objects?.regions?.geometries || []) {
    const p = g.properties || {};
    if (!p.regionId) continue;
    _graph.set(p.regionId, Array.isArray(p.neighbors) ? p.neighbors : []);
    if (Array.isArray(p.position)) _pos.set(p.regionId, p.position);
  }
  const labels = state.mapDataGlobal.regionLabels?.geometries || topo.objects?.regionLabels?.geometries || [];
  for (const l of labels) {
    const p = l.properties || {};
    if (p.regionId && p.name) _labelNames.set(p.regionId, p.name);
    if (p.regionId && !_pos.has(p.regionId) && Array.isArray(l.coordinates)) _pos.set(p.regionId, l.coordinates);
  }
  return _graph;
}

function bfs(origin) {
  const g = graph();
  let r = _bfs.get(origin);
  if (r) return r;
  const dist = new Map([[origin, 0]]);
  const prev = new Map();
  const queue = [origin];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist.get(cur);
    for (const n of g.get(cur) || []) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  // Una decina di origini bastano (partenza, casa, casse): oltre si riparte.
  if (_bfs.size > 24) _bfs.clear();
  r = { dist, prev };
  _bfs.set(origin, r);
  return r;
}

function hops(a, b) {
  return bfs(a).dist.get(b) ?? Infinity;
}

function pathBetween(a, b) {
  const { dist, prev } = bfs(a);
  if (!dist.has(b)) return [];
  const out = [b];
  let cur = b;
  while (cur !== a) { cur = prev.get(cur); out.push(cur); }
  return out.reverse();
}

export function regionName(id) {
  graph();
  return state.regionData?.[id]?.name || _labelNames.get(id) || '—';
}

function regionCountryId(id) {
  return state.regionData?.[id]?.country || null;
}

/** Stamina che resta e barili che servono per un viaggio di `h` regioni. */
export function travelCost(h) {
  const onBar = Math.min(h, HOPS_PER_BAR);
  return {
    staminaLeft: STAMINA_MAX - onBar * STAMINA_PER_HOP,
    barrels: Math.max(0, h - HOPS_PER_BAR) * OIL_PER_EXTRA_HOP,
  };
}

// ══════════════════ STATO DELLA VISTA ══════════════════

function t() {
  if (!state.travel) {
    let home = null;
    try { home = localStorage.getItem(HOME_KEY) || null; } catch { /* storage bloccato */ }
    state.travel = { origin: null, target: null, home, cases: [], pick: null };
  }
  return state.travel;
}

function saveHome(id) {
  try {
    if (id) localStorage.setItem(HOME_KEY, id);
    else localStorage.removeItem(HOME_KEY);
  } catch { /* storage bloccato: la casa vale per la sessione */ }
}

const canHover = () => window.matchMedia('(hover: hover)').matches;

/** Entrando nella vista: se non c'è ancora una partenza si parte da casa
 *  (se l'utente l'ha impostata) o dalla capitale della nazione selezionata. */
export function enterTravelView() {
  const tr = t();
  graph();
  if (tr.origin && _graph.has(tr.origin)) return;
  tr.origin = null;
  if (tr.home && _graph.has(tr.home)) { tr.origin = tr.home; return; }
  const cId = state.selectedCountryId;
  if (cId && state.regionData) {
    const cap = Object.values(state.regionData).find(r => r.country === cId && r.isCapital);
    if (cap && _graph.has(cap._id)) tr.origin = cap._id;
  }
}

// ══════════════════ COLORE DELLA MAPPA ══════════════════

const lerp = (a, b, k) => Math.round(a + (b - a) * k);

/** Dentro la barra: verde (una regione) → giallo → rosso (dieci). Oltre:
 *  viola, sempre più scuro man mano che servono più barili. Due famiglie
 *  di tinta apposta: il confine della barra è LA cosa da vedere. */
export function hopColor(h) {
  if (h === 0) return ORIGIN_COLOR;
  if (h <= HOPS_PER_BAR) {
    const u = (h - 1) / (HOPS_PER_BAR - 1);
    if (u < 0.5) {
      const k = u / 0.5;
      return `rgb(${lerp(31, 230, k)},${lerp(157, 193, k)},${lerp(79, 31, k)})`;
    }
    const k = (u - 0.5) / 0.5;
    return `rgb(${lerp(230, 200, k)},${lerp(193, 40, k)},${lerp(31, 35, k)})`;
  }
  const k = Math.min(1, (h - HOPS_PER_BAR - 1) / 9);
  return `rgb(${lerp(140, 45, k)},${lerp(90, 30, k)},${lerp(190, 70, k)})`;
}

export function travelLegendGradient() {
  const stops = [];
  for (let h = 1; h <= 20; h++) stops.push(`${hopColor(h)} ${((h - 1) / 19 * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function buildTravelColorExpression() {
  const tr = t();
  if (!tr.origin) return COLORS.DEFAULT_LAND;
  const { dist } = bfs(tr.origin);
  // Raggruppate per distanza: una 'match' con liste di etichette invece di
  // 726 coppie, stesso risultato e un'espressione dieci volte più corta.
  const byHop = new Map();
  for (const [id, h] of dist) {
    if (!byHop.has(h)) byHop.set(h, []);
    byHop.get(h).push(id);
  }
  const expr = ['match', ['get', 'regionId']];
  for (const [h, ids] of byHop) expr.push(ids, hopColor(h));
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}

// ══════════════════ NUMERI ══════════════════

export function getTravelStats(origin = t().origin) {
  const total = graph().size;
  if (!origin || !_graph.has(origin)) return null;
  const { dist } = bfs(origin);
  const bands = Array(HOPS_PER_BAR + 1).fill(0);   // 1..10 e "oltre"
  const values = [];
  let far = 0, farId = null;
  for (const [id, h] of dist) {
    if (h === 0) continue;
    bands[Math.min(h, HOPS_PER_BAR + 1) - 1]++;
    values.push(h);
    if (h > far) { far = h; farId = id; }
  }
  values.sort((a, b) => a - b);
  return {
    total,
    bands,
    withinBar: bands.slice(0, HOPS_PER_BAR).reduce((s, n) => s + n, 0),
    unreachable: total - dist.size,
    far, farId,
    median: values.length ? values[Math.floor(values.length / 2)] : 0,
  };
}

// ══════════════════ GIRO DELLE CASSE ══════════════════

/** Ordine migliore per raccogliere le casse partendo da `start`, con un
 *  viaggio gratis a `home` spendibile una volta (prima di qualunque tappa).
 *  Held-Karp: dp[maschera][ultima][speso] = regioni percorse. */
export function planRoute(start, home, caseIds) {
  const uniq = [...new Set(caseIds)];
  const reach = uniq.filter(c => bfs(start).dist.has(c) || (home && bfs(home).dist.has(c)));
  const unreachable = uniq.filter(c => !reach.includes(c));
  const n = reach.length;
  if (!n) return { steps: [], travels: 0, unreachable };

  const size = 1 << n;
  const dp = Array.from({ length: size }, () => Array.from({ length: n }, () => [Infinity, Infinity]));
  const par = Array.from({ length: size }, () => Array.from({ length: n }, () => [null, null]));

  for (let i = 0; i < n; i++) {
    dp[1 << i][i][0] = hops(start, reach[i]);
    par[1 << i][i][0] = { from: -1, used: 0, viaHome: false };
    if (home) {
      dp[1 << i][i][1] = hops(home, reach[i]);
      par[1 << i][i][1] = { from: -1, used: 0, viaHome: true };
    }
  }
  for (let mask = 1; mask < size; mask++) {
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      for (let u = 0; u < 2; u++) {
        const c = dp[mask][i][u];
        if (c === Infinity) continue;
        for (let j = 0; j < n; j++) {
          if (mask & (1 << j)) continue;
          const nm = mask | (1 << j);
          const walk = c + hops(reach[i], reach[j]);
          if (walk < dp[nm][j][u]) { dp[nm][j][u] = walk; par[nm][j][u] = { from: i, used: u, viaHome: false }; }
          if (u === 0 && home) {
            const jump = c + hops(home, reach[j]);
            if (jump < dp[nm][j][1]) { dp[nm][j][1] = jump; par[nm][j][1] = { from: i, used: 0, viaHome: true }; }
          }
        }
      }
    }
  }

  const full = size - 1;
  let best = Infinity, bi = -1, bu = 0;
  for (let u = 0; u < 2; u++) for (let i = 0; i < n; i++) {
    if (dp[full][i][u] < best) { best = dp[full][i][u]; bi = i; bu = u; }
  }
  if (bi < 0) return { steps: [], travels: 0, unreachable: uniq };

  const order = [];
  let mask = full, i = bi, u = bu;
  while (i >= 0) {
    const p = par[mask][i][u];
    order.push({ idx: i, viaHome: p.viaHome });
    mask ^= 1 << i;
    i = p.from;
    u = p.used;
  }
  order.reverse();

  let cur = start;
  const steps = order.map(({ idx, viaHome }) => {
    const caseId = reach[idx];
    const from = viaHome ? home : cur;
    cur = caseId;
    return { caseId, viaHome, from, travels: hops(from, caseId) };
  });
  return { steps, travels: best, unreachable };
}

function currentRoute() {
  const tr = t();
  if (!tr.origin || !tr.cases.length) return null;
  return planRoute(tr.origin, tr.home && _graph.has(tr.home) ? tr.home : null, tr.cases);
}

// ══════════════════ PERCORSO SULLA MAPPA ══════════════════

/** Longitudini "srotolate": Hawaii → Papua attraversa l'antimeridiano, e
 *  senza questo la linea farebbe il giro del mondo al contrario. */
function lineCoords(ids) {
  const out = [];
  let prevLng = null;
  for (const id of ids) {
    const p = _pos.get(id);
    if (!p) continue;
    let lng = p[0];
    if (prevLng != null) {
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
    }
    prevLng = lng;
    out.push([lng, p[1]]);
  }
  return out;
}

function point(id, role, label = '') {
  const p = _pos.get(id);
  return p ? { type: 'Feature', properties: { role, label }, geometry: { type: 'Point', coordinates: p } } : null;
}

function overlayFeatures() {
  const tr = t();
  const feats = [];
  if (!tr.origin) return feats;
  const route = currentRoute();
  if (route?.steps.length) {
    route.steps.forEach((s, i) => {
      // Il ritorno a casa è un salto, non una camminata: tratteggio
      // dritto dalla tappa prima alla casa, da cui riparte il percorso.
      if (s.viaHome && tr.home) {
        const j = lineCoords([i ? route.steps[i - 1].caseId : tr.origin, tr.home]);
        if (j.length === 2) feats.push({ type: 'Feature', properties: { kind: 'home' }, geometry: { type: 'LineString', coordinates: j } });
      }
      const c = lineCoords(pathBetween(s.from, s.caseId));
      if (c.length > 1) feats.push({ type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: c } });
    });
    route.steps.forEach((s, i) => { const f = point(s.caseId, 'case', String(i + 1)); if (f) feats.push(f); });
  } else {
    tr.cases.forEach(id => { const f = point(id, 'case', '·'); if (f) feats.push(f); });
  }
  if (tr.target && tr.target !== tr.origin) {
    const c = lineCoords(pathBetween(tr.origin, tr.target));
    if (c.length > 1) feats.push({ type: 'Feature', properties: { kind: 'walk' }, geometry: { type: 'LineString', coordinates: c } });
    const f = point(tr.target, 'target');
    if (f) feats.push(f);
  }
  if (tr.home) { const f = point(tr.home, 'home', '⌂'); if (f) feats.push(f); }
  const o = point(tr.origin, 'start');
  if (o) feats.push(o);
  return feats;
}

function ensureLayers(map) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const lineColor = ['match', ['get', 'kind'], 'route', '#f1c40f', '#ffffff'];
  map.addLayer({
    id: LYR_GLOW, type: 'line', source: SRC,
    filter: ['in', ['get', 'kind'], ['literal', ['walk', 'route']]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': lineColor, 'line-width': 9, 'line-blur': 4, 'line-opacity': 0.35 },
  });
  map.addLayer({
    id: LYR_LINE, type: 'line', source: SRC,
    filter: ['in', ['get', 'kind'], ['literal', ['walk', 'route']]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': lineColor, 'line-width': 2.5, 'line-opacity': 0.95 },
  });
  map.addLayer({
    id: LYR_HOME, type: 'line', source: SRC,
    filter: ['==', ['get', 'kind'], 'home'],
    paint: { 'line-color': ORIGIN_COLOR, 'line-width': 1.6, 'line-dasharray': [3, 2], 'line-opacity': 0.85 },
  });
  map.addLayer({
    id: LYR_DOTS, type: 'circle', source: SRC,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['match', ['get', 'role'], 'target', 5, 9],
      'circle-color': ['match', ['get', 'role'], 'start', '#2ecc71', 'home', ORIGIN_COLOR, 'target', '#ffffff', '#f1c40f'],
      'circle-stroke-color': '#0b1c33',
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: LYR_NUMS, type: 'symbol', source: SRC,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'label'], '']],
    layout: {
      // ⚠️ un font che fonts.openmaptiles.org NON ha (era 'Noto Sans Regular':
      // risponde 200 con una pagina HTML) fa fallire il parse dei glifi e con
      // lui l'intera sorgente, linee comprese: «Unimplemented type: 4».
      'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Open Sans Bold'],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#0b1c33' },
  });
}

let _listenersOn = false;
let _hoverId = null;

function onMove(e) {
  if (state.coloringMode !== 'travel' || !canHover()) return;
  const tr = t();
  if (!tr.origin || tr.pick) return;
  const id = e.features?.[0]?.properties?.regionId || null;
  if (id === _hoverId) return;
  _hoverId = id;
  tr.target = id && id !== tr.origin ? id : null;
  paintOverlay();
}

function onLeave() {
  if (state.coloringMode !== 'travel' || !canHover()) return;
  _hoverId = null;
  t().target = null;
  paintOverlay();
}

function onKey(e) {
  if (e.key !== 'Escape' || state.coloringMode !== 'travel') return;
  const tr = t();
  if (!tr.pick) return;
  tr.pick = null;
  refreshAll({ map: false });
}

function paintOverlay() {
  const map = state.map;
  if (!map?.getLayer('regions-fill')) return;
  const on = state.coloringMode === 'travel';
  if (on) ensureLayers(map);
  const src = map.getSource(SRC);
  if (src) src.setData({ type: 'FeatureCollection', features: on ? overlayFeatures() : [] });
  renderHud();
}

/** Chiamata da renderMap a ogni ridisegno: accende o spegne percorso e
 *  barra in basso a seconda della vista. Costa una setData. */
export function syncTravelOverlay() {
  if (!state.map) return;
  if (!_listenersOn && state.map.getLayer('regions-fill')) {
    _listenersOn = true;
    state.map.on('mousemove', 'regions-fill', onMove);
    state.map.on('mouseleave', 'regions-fill', onLeave);
    document.addEventListener('keydown', onKey);
  }
  if (state.coloringMode !== 'travel' && !state.map.getSource(SRC) && !_hud) return;
  paintOverlay();
}

// ══════════════════ BARRA IN BASSO ══════════════════

let _hud = null;

function staminaBarHtml(h) {
  const { staminaLeft, barrels } = travelCost(h);
  return `
    <span class="wp-travel-bar" role="img" aria-label="${staminaLeft}/${STAMINA_MAX}">
      <i style="width:${staminaLeft / STAMINA_MAX * 100}%"></i>
      <b>⚡ ${staminaLeft}/${STAMINA_MAX}</b>
    </span>
    ${barrels > 0 ? `<span class="wp-travel-oil">🛢️ ${escapeHtml(tT('{n} barrels', { n: barrels }))}</span>` : ''}`;
}

function renderHud() {
  const tr = t();
  const show = state.coloringMode === 'travel' && !!tr.origin;
  if (!show) { if (_hud) _hud.hidden = true; return; }
  if (!_hud) {
    _hud = document.createElement('div');
    _hud.id = 'wp-travel-hud';
    _hud.setAttribute('aria-live', 'polite');
    document.body.appendChild(_hud);
  }
  _hud.hidden = false;
  const from = escapeHtml(regionName(tr.origin));
  if (!tr.target) {
    _hud.innerHTML = `<div class="wp-travel-hud-title">📍 ${from}</div>
      <div class="wp-travel-hud-hint">${escapeHtml(canHover()
        ? tT('Hover a region to see the trip · click to start from it')
        : tT('Tap another region to see the trip'))}</div>`;
    return;
  }
  const h = hops(tr.origin, tr.target);
  const to = escapeHtml(regionName(tr.target));
  if (h === Infinity) {
    _hud.innerHTML = `<div class="wp-travel-hud-title">${from} → ${to} · ${escapeHtml(tT('unreachable'))}</div>`;
    return;
  }
  _hud.innerHTML = `<div class="wp-travel-hud-title">${from} → ${to} · ${escapeHtml(h === 1 ? tT('1 region away') : tT('{n} regions away', { n: h }))}</div>
    <div class="wp-travel-hud-cost">${staminaBarHtml(h)}</div>`;
}

// ══════════════════ CLICK SULLA MAPPA ══════════════════

/** Il click su una regione in vista Distanze (map.js:_onRegionClick). */
export function onTravelRegionClick(regionId) {
  if (!regionId) return;
  const tr = t();
  if (tr.pick === 'home') {
    tr.home = regionId;
    saveHome(regionId);
    tr.pick = null;
    trackEvent('travel-set-home');
  } else if (tr.pick === 'case') {
    if (tr.cases.includes(regionId)) tr.cases = tr.cases.filter(c => c !== regionId);
    else if (tr.cases.length < MAX_CASES) tr.cases = [...tr.cases, regionId];
    if (tr.cases.length >= MAX_CASES) tr.pick = null;
  } else if (!canHover() && tr.origin && !tr.target && regionId !== tr.origin) {
    // Su touch non c'è hover: il primo tocco sceglie la partenza, il
    // secondo la destinazione, il terzo ricomincia da capo.
    tr.target = regionId;
    refreshAll({ map: false, panel: false });
    return;
  } else {
    if (regionId === tr.origin && !tr.target) return;
    tr.origin = regionId;
    tr.target = null;
    trackEvent('travel-origin');
  }
  refreshAll();
}

function refreshAll({ map = true, panel = true } = {}) {
  if (map) import('./map.js').then(m => m.renderMap());
  else paintOverlay();
  if (panel) import('../panel/countryPanel.js').then(m => m.refreshViewOverviewPanel('travel'));
}

// ══════════════════ RIEPILOGO NEL PANNELLO ══════════════════

const plural = n => (n === 1 ? tT('1 region') : tT('{n} regions', { n }));
// Sulle ALTRE regioni del mondo (quella in cui si è non conta): così
// l'ultima riga dell'istogramma chiude a 100%.
const pct = (n, total) => `${total > 1 ? (n / (total - 1) * 100).toFixed(1) : '0.0'}%`;

function histogramHtml(s) {
  let cum = 0;
  const max = Math.max(1, ...s.bands);
  const rows = s.bands.map((n, i) => {
    cum += n;
    const h = i + 1;
    const oil = h > HOPS_PER_BAR;
    const label = oil ? `${STAMINA_MAX}${escapeHtml(tT('+ oil'))}` : String(h * STAMINA_PER_HOP);
    return `<tr>
      <th scope="row">${label}</th>
      <td class="wp-travel-hbar"><i style="width:${n / max * 100}%;background:${hopColor(oil ? HOPS_PER_BAR + 3 : h)}"></i></td>
      <td class="wp-travel-num">${n}</td>
      <td class="wp-travel-cum">(${cum})</td>
      <td class="wp-travel-num">${pct(cum, s.total)}</td>
    </tr>`;
  }).join('');
  return `
    <div class="wp-panel-section-title">${escapeHtml(tT('By distance'))}</div>
    <table class="wp-travel-hist">
      <thead><tr>
        <th scope="col">${escapeHtml(tT('Stamina'))}</th><td></td>
        <th scope="col" colspan="2">${escapeHtml(tT('Regions'))}</th>
        <th scope="col">${escapeHtml(tT('Of the world'))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="wp-vo-about">${escapeHtml(tT('The number in brackets is the running total. Wooden crates: a crate that spawns in a random region is within reach with the probability in the last column.'))}</div>`;
}

function fieldHtml(label, id, action) {
  const tr = t();
  const armed = tr.pick === action;
  return `<div class="wp-travel-field">
    <span class="wp-travel-field-label">${escapeHtml(label)}</span>
    <span class="wp-travel-field-value">${id ? escapeHtml(regionName(id)) : `<em>${escapeHtml(tT('not set'))}</em>`}</span>
    ${action ? `<button type="button" class="wp-travel-btn" data-travel-action="pick-${action}" aria-pressed="${armed}">${escapeHtml(armed ? tT('Picking…') : tT('Pick on map'))}</button>
    <button type="button" class="wp-travel-btn" data-travel-action="clear-${action}"${id ? '' : ' disabled'}>×</button>` : ''}
  </div>`;
}

function plannerHtml() {
  const tr = t();
  const route = currentRoute();
  const order = new Map();
  route?.steps.forEach((s, i) => order.set(s.caseId, i + 1));

  const cases = tr.cases.map(id => `<li class="wp-travel-case">
      <span class="wp-travel-case-n">${order.get(id) ?? '·'}</span>
      <span class="wp-travel-case-name">${escapeHtml(regionName(id))}</span>
      <button type="button" class="wp-travel-x" data-travel-action="drop-case" data-region="${escapeHtml(id)}" aria-label="${escapeHtml(tT('Remove'))}">×</button>
    </li>`).join('');

  let hint = '';
  if (tr.pick === 'home') hint = `${tT('Click your home region on the map.')} ${tT('Esc cancels.')}`;
  else if (tr.pick === 'case') hint = `${tT('Click the regions holding a case; click one again to drop it.')} ${tT('Esc cancels.')}`;
  else if (!tr.cases.length) hint = tT('Add the regions holding a case: the best order is worked out for you.');

  let result = '';
  if (route?.steps.length) {
    const legs = route.steps.map((s, i) => `<li class="wp-travel-leg">
        ${s.viaHome ? `<span class="wp-travel-leg-home">↩ ${escapeHtml(tT('travel home to {name} · free', { name: regionName(tr.home) }))}</span>` : ''}
        <span class="wp-travel-case-n">${i + 1}</span>
        <span class="wp-travel-case-name">${escapeHtml(regionName(s.caseId))}</span>
        <span class="wp-travel-leg-cost">${escapeHtml(plural(s.travels))}</span>
      </li>`).join('');
    const over = Math.max(0, route.travels - HOPS_PER_BAR);
    result = `<ol class="wp-travel-legs">
        <li class="wp-travel-leg"><span class="wp-travel-case-n">◎</span><span class="wp-travel-case-name">${escapeHtml(regionName(tr.origin))}</span><span class="wp-travel-leg-cost">${escapeHtml(tT('start'))}</span></li>
        ${legs}
      </ol>
      <div class="wp-travel-total">${escapeHtml(tT('Total: {n} regions travelled', { n: route.travels }))}</div>
      <div class="wp-travel-hud-cost">${staminaBarHtml(route.travels)}</div>
      ${over ? `<div class="wp-travel-warn">⚠️ ${escapeHtml(tT('This route outruns a full bar by {n} regions, at {oil} barrels each.', { n: over, oil: OIL_PER_EXTRA_HOP }))}</div>` : ''}
      ${tr.home
        ? `<div class="wp-vo-about">${escapeHtml(tT('Travelling home is free once every {h} hours: the route spends it on the leg where it saves the most, or keeps it.', { h: FREE_HOME_HOURS }))}</div>`
        : `<div class="wp-vo-about">${escapeHtml(tT('Set a home region too: the route can spend one free trip home on it.'))}</div>`}`;
  }
  if (route?.unreachable.length) {
    result += `<div class="wp-travel-warn">⚠️ ${escapeHtml(tT('Neither you nor home can reach: {names}', { names: route.unreachable.map(regionName).join(', ') }))}</div>`;
  }

  return `
    <div class="wp-panel-section-title">📦 ${escapeHtml(tT('Wooden case route'))}</div>
    <div class="wp-travel-planner">
      ${fieldHtml(tT('You are'), tr.origin, null)}
      ${fieldHtml(tT('Home'), tr.home, 'home')}
      <div class="wp-travel-field">
        <span class="wp-travel-field-label">${escapeHtml(tT('Cases {n}/{max}', { n: tr.cases.length, max: MAX_CASES }))}</span>
        <span class="wp-travel-field-value"></span>
        <button type="button" class="wp-travel-btn" data-travel-action="pick-case" aria-pressed="${tr.pick === 'case'}"${tr.cases.length >= MAX_CASES && tr.pick !== 'case' ? ' disabled' : ''}>${escapeHtml(tr.pick === 'case' ? tT('Picking…') : tT('Pick on map'))}</button>
        <button type="button" class="wp-travel-btn" data-travel-action="clear-case"${tr.cases.length ? '' : ' disabled'}>${escapeHtml(tT('Clear'))}</button>
      </div>
      ${cases ? `<ul class="wp-travel-cases">${cases}</ul>` : ''}
      ${hint ? `<div class="wp-travel-hint">${escapeHtml(hint)}</div>` : ''}
      ${result}
    </div>`;
}

/** Markup del riepilogo (viewOverview.js lo chiama per mode === 'travel'). */
export function travelOverviewHtml() {
  const tr = t();
  const header = (title) => `
    <div class="wp-panel-header"><div><div class="wp-panel-name">${escapeHtml(title)}</div></div></div>`;
  const about = `<div class="wp-vo-about">${escapeHtml(tT('Distance is the number of borders crossed on the game\'s own neighbour graph, not kilometres. Costs from patch 0.26.1: {s} stamina per region, so a full bar reaches {max} regions; past that, every region costs {oil} barrels of oil. A full bar is assumed.', { s: STAMINA_PER_HOP, max: HOPS_PER_BAR, oil: OIL_PER_EXTRA_HOP }))}</div>`;

  const s = getTravelStats();
  if (!s) {
    return header(tT('Travel distance'))
      + `<div class="wp-travel-hint wp-travel-hint-big">${escapeHtml(canHover()
        ? tT('Click a region on the map to measure every distance from it.')
        : tT('Tap a region on the map to measure every distance from it.'))}</div>`
      + about;
  }
  const cells = [
    { label: tT('Within a full bar'), value: `${s.withinBar} · ${pct(s.withinBar, s.total)}` },
    { label: tT('Farthest'), value: `${s.far} · ${regionName(s.farId)}` },
    { label: tT('Median'), value: plural(s.median) },
    { label: tT('Unreachable'), value: String(s.unreachable) },
  ];
  const country = regionCountryId(tr.origin);
  const nation = country ? state.nationMap?.get(country) : null;
  return header(tT('From {name}', { name: regionName(tr.origin) }))
    + (nation ? `<div class="wp-travel-nation">${escapeHtml(nation.name)}</div>` : '')
    + `<div class="wp-panel-grid wp-vo-grid">${cells.map(c => `
        <div class="wp-stat">
          <div class="wp-stat-label">${escapeHtml(c.label)}</div>
          <div class="wp-stat-value">${escapeHtml(c.value)}</div>
        </div>`).join('')}</div>`
    + about
    + plannerHtml()
    + histogramHtml(s);
}

/** Collega i bottoni del riepilogo (countryPanel.js, dopo innerHTML). */
export function wireTravelOverview(root) {
  root.querySelectorAll('[data-travel-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tr = t();
      const a = btn.dataset.travelAction;
      if (a === 'pick-home') tr.pick = tr.pick === 'home' ? null : 'home';
      else if (a === 'pick-case') tr.pick = tr.pick === 'case' ? null : 'case';
      else if (a === 'clear-home') { tr.home = null; saveHome(null); }
      else if (a === 'clear-case') { tr.cases = []; if (tr.pick === 'case') tr.pick = null; }
      else if (a === 'drop-case') tr.cases = tr.cases.filter(c => c !== btn.dataset.region);
      if (a.startsWith('pick-') && tr.pick) trackEvent('travel-pick', { what: tr.pick });
      refreshAll({ map: false });
    });
  });
}
