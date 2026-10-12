/* ══════════════════════════════════════════════════════════════
   WarEra+ — Vista mappa "Finanziamenti" (chi manda soldi a chi)
   ------------------------------------------------------------------
   Richiesta dell'utente: cliccando una nazione, frecce da chi la
   finanzia e verso chi finanzia lei, spesse quanto l'importo, con
   un'animazione nuova — monete che scorrono.

   Il dato sono i bonifici da tesoro a tesoro (`countryMoneyTransfer`),
   che finora si vedevano solo nella scheda di una battaglia, filtrati
   sulla sua finestra. Si scaricano con la STESSA funzione
   (src/battles/moneyTransfers.js: fetchMoneyTransfers, cache di
   sessione): prima il server di cache (archivio dal 25 aprile 2026),
   altrimenti l'API, che ricorda ~3 giorni. Tutto il resto si conta qui
   in memoria — sono poche migliaia di righe.

   Stessa struttura della vista Migrazioni (migrationFlows.js), e per
   questo non ripetuta nei commenti: colore per saldo, clic = frecce di
   una nazione, riepilogo nel pannello (viewOverview.js). Differenze:
     · la tinta non è "bene/male": chi RICEVE più di quanto manda è oro,
       chi DÀ è viola. Un donatore netto non sta perdendo niente;
     · le frecce partono da chi paga e arrivano a chi incassa, sempre,
       qualunque sia la nazione cliccata: il verso è quello del denaro;
     · niente comete: MONETE che scorrono lungo l'arco, più numerose
       dove passa più denaro.

   ⚠️ `coverageFrom` dice da quando l'archivio guarda: con la finestra
   "tutto" o con l'API di riserva una nazione senza bonifici non vuol
   dire "nessuno l'ha mai finanziata". Il riepilogo lo dichiara.
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { COLORS } from './config.js';
import { countryAnchor, arc, alongArc } from './flowGeometry.js';
import { trackEvent } from '../shared/analytics.js';
import { animationsOn } from '../shared/motion.js';
import { syncBack, updateBackParams } from '../app/backNav.js';

export const FUNDING_DAYS = [7, 30, 90, 0];   // 0 = tutto l'archivio
export const IN_COLOR = '#e3b341';            // denaro che arriva alla nazione cliccata
export const OUT_COLOR = '#a371f7';           // denaro che parte dalla nazione cliccata
const NEUTRAL = '#8b949e';
const MAX_ARROWS = 15;
const MIN_ARC_DEG = 1.2;
const DAY_MS = 86400000;
const TTL_MS = 10 * 60 * 1000;

const SRC = 'wp-funding-src';
const SRC_FX = 'wp-funding-fx-src';
const LYR_GROUND = 'wp-funding-ground';
const LYR_LINE = 'wp-funding-line';
const LYR_ORIGIN = 'wp-funding-origin';
const LYR_ENDS = 'wp-funding-ends';
const LYR_COINS = 'wp-funding-coins';
const COIN = 'wp-funding-coin';

export function fund() {
  if (!state.funding) {
    state.funding = { data: null, error: null, at: 0, days: 30, focus: null, dir: 'both', loading: false };
  }
  return state.funding;
}

const canHover = () => window.matchMedia('(hover: hover)').matches;
export { canHover as fundingCanHover };

/* ══════════════════ DATI ══════════════════ */

let _timer = null;

export async function loadFunding({ force = false } = {}) {
  const s = fund();
  if (!force && s.data && Date.now() - s.at < TTL_MS) return;
  s.loading = true;
  try {
    const { fetchMoneyTransfers } = await import('../battles/moneyTransfers.js');
    const data = await fetchMoneyTransfers();
    if (!data) throw new Error('nessuna sorgente ha risposto');
    s.data = data;
    s.at = Date.now();
    s.error = null;
  } catch (err) {
    console.warn('[funding] bonifici non disponibili:', err.message);
    s.error = 'unreachable';
  } finally {
    s.loading = false;
  }
  _agg = null;
  if (state.coloringMode === 'funding') refreshAll();
}

export function enterFundingView() {
  clearInterval(_timer);
  _timer = setInterval(() => {
    if (state.coloringMode !== 'funding') { clearInterval(_timer); _timer = null; return; }
    if (!document.hidden) loadFunding({ force: true });
  }, TTL_MS);
  return loadFunding();
}

/* Somme sulla finestra scelta, ricalcolate solo se cambiano dati o
   finestra: renderMap le chiede a ogni ridisegno. */
let _agg = null;
let _aggKey = '';

export function fundingAgg() {
  const s = fund();
  if (!s.data) return null;
  const key = `${s.data.at}|${s.days}`;
  if (_agg && _aggKey === key) return _agg;
  const since = s.days ? Date.now() - s.days * DAY_MS : 0;
  const countries = {};
  const pairs = new Map();
  let total = 0, count = 0;
  const touch = id => countries[id] || (countries[id] = { in: 0, out: 0, net: 0, nIn: 0, nOut: 0 });
  for (const t of s.data.transfers) {
    if (t.at < since || !t.from || !t.to || t.from === t.to) continue;
    const m = Number(t.money) || 0;
    if (m <= 0) continue;
    total += m; count++;
    const a = touch(t.from), b = touch(t.to);
    a.out += m; a.nOut++;
    b.in += m; b.nIn++;
    const k = `${t.from}>${t.to}`;
    const p = pairs.get(k) || { f: t.from, t: t.to, m: 0, n: 0 };
    p.m += m; p.n++;
    pairs.set(k, p);
  }
  for (const c of Object.values(countries)) c.net = c.in - c.out;
  _agg = {
    countries,
    flows: [...pairs.values()].sort((a, b) => b.m - a.m),
    total, count,
    coverageFrom: s.data.coverageFrom || null,
    fromServer: Boolean(s.data.fromServer),
    since,
  };
  _aggKey = key;
  return _agg;
}

/** Vero se la finestra comincia prima di dove arriva l'archivio. */
export function fundingWindowShort() {
  const a = fundingAgg();
  if (!a?.coverageFrom) return false;
  return !a.since || a.since < a.coverageFrom;
}

/* ══════════════════ COLORE ══════════════════ */

const lerp = (a, b, k) => Math.round(a + (b - a) * k);
const mix = (c1, c2, k) => `rgb(${lerp(c1[0], c2[0], k)},${lerp(c1[1], c2[1], k)},${lerp(c1[2], c2[2], k)})`;
const GOLD_LO = [245, 222, 160], GOLD_HI = [176, 124, 18];
const VIOLET_LO = [214, 196, 248], VIOLET_HI = [110, 64, 201];

function scaleMax() {
  const vals = Object.values(fundingAgg()?.countries || {}).map(c => Math.abs(c.net)).filter(v => v > 0).sort((a, b) => a - b);
  if (!vals.length) return 1;
  return vals[Math.floor((vals.length - 1) * 0.9)] || 1;
}

export function fundingColor(v, max = scaleMax()) {
  if (v == null) return null;
  if (v === 0) return NEUTRAL;
  const k = Math.min(1, Math.sqrt(Math.abs(v) / max));
  return v > 0 ? mix(GOLD_LO, GOLD_HI, k) : mix(VIOLET_LO, VIOLET_HI, k);
}

export function fundingLegendGradient() {
  return `linear-gradient(to right, rgb(${VIOLET_HI}), rgb(${VIOLET_LO}) 45%, ${NEUTRAL} 50%, rgb(${GOLD_LO}) 55%, rgb(${GOLD_HI}))`;
}

export function buildFundingColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const a = fundingAgg();
  if (!a) return COLORS.DEFAULT_LAND;
  // Con una nazione a fuoco si colorano SOLO lei e i suoi partner: col
  // saldo di tutto il mondo sotto, quasi ogni paese è oro o viola e le
  // frecce oro sparivano sui paesi oro (verificato sull'Ucraina).
  const focus = fund().focus;
  if (focus) {
    const f = fundingFocus(focus);
    const expr = ['match', ['get', prop], focus, COLORS.SELECTED];
    const seen = new Set([focus]);
    const both = new Set(f.in.map(r => r.id).filter(id => f.out.some(o => o.id === id)));
    const ins = f.in.map(r => r.id).filter(id => !seen.has(id) && !both.has(id));
    ins.forEach(id => seen.add(id));
    const outs = f.out.map(r => r.id).filter(id => !seen.has(id) && !both.has(id));
    outs.forEach(id => seen.add(id));
    if (ins.length) expr.push(ins, mix(GOLD_LO, GOLD_HI, 0.55));
    if (outs.length) expr.push(outs, mix(VIOLET_LO, VIOLET_HI, 0.55));
    if (both.size) expr.push([...both], '#c89be0');
    expr.push(COLORS.NEUTRAL_UNSELECTED || COLORS.DEFAULT_LAND);
    return expr;
  }
  const max = scaleMax();
  const byColor = new Map();
  for (const [id, c] of Object.entries(a.countries)) {
    const col = fundingColor(c.net, max);
    if (!col) continue;
    if (!byColor.has(col)) byColor.set(col, []);
    byColor.get(col).push(id);
  }
  if (!byColor.size) return COLORS.DEFAULT_LAND;
  const expr = ['match', ['get', prop]];
  for (const [col, ids] of byColor) expr.push(ids, col);
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}

/* ══════════════════ NUMERI ══════════════════ */

export function getFundingStats() {
  const a = fundingAgg();
  if (!a) return null;
  let receivers = 0, givers = 0;
  for (const c of Object.values(a.countries)) {
    if (c.net > 0) receivers++;
    else if (c.net < 0) givers++;
  }
  return { total: a.total, count: a.count, receivers, givers };
}

export function fundingRanking(limit = 10) {
  const a = fundingAgg();
  if (!a) return { receivers: [], givers: [], flows: [] };
  const rows = Object.entries(a.countries).map(([id, c]) => ({ id, ...c })).filter(r => r.net !== 0);
  return {
    receivers: rows.filter(r => r.net > 0).sort((x, y) => y.net - x.net).slice(0, limit),
    givers: rows.filter(r => r.net < 0).sort((x, y) => x.net - y.net).slice(0, limit),
    flows: a.flows.slice(0, limit),
  };
}

/** I partner di una nazione: chi la finanzia (in) e chi finanzia lei (out). */
export function fundingFocus(id = fund().focus) {
  const a = fundingAgg();
  const inn = [], out = [];
  for (const f of a?.flows || []) {
    if (f.t === id) inn.push({ id: f.f, m: f.m, n: f.n });
    else if (f.f === id) out.push({ id: f.t, m: f.m, n: f.n });
  }
  return { in: inn, out, country: a?.countries?.[id] || null };
}

/* ══════════════════ FRECCE E MONETE ══════════════════ */

let _arcs = [];   // { coords, kind, w, phase }

function overlayFeatures() {
  _arcs = [];
  const s = fund();
  if (!s.focus || !fundingAgg()) return [];
  const home = countryAnchor(s.focus);
  if (!home) return [];
  const f = fundingFocus(s.focus);
  const drawIn = s.dir !== 'out' ? f.in.slice(0, MAX_ARROWS) : [];
  const drawOut = s.dir !== 'in' ? f.out.slice(0, MAX_ARROWS) : [];
  const maxM = Math.max(1, ...drawIn.map(r => r.m), ...drawOut.map(r => r.m));
  const feats = [];
  const add = (kind, from, to, m) => {
    if (!from || !to || Math.hypot(from[0] - to[0], from[1] - to[1]) < MIN_ARC_DEG) return;
    const { coords } = arc(from, to);
    const w = Math.sqrt(m / maxM);
    feats.push({ type: 'Feature', properties: { kind, w, role: 'ground' }, geometry: { type: 'LineString', coordinates: [from, to] } });
    feats.push({ type: 'Feature', properties: { kind, w }, geometry: { type: 'LineString', coordinates: coords } });
    feats.push({ type: 'Feature', properties: { kind, role: 'end' }, geometry: { type: 'Point', coordinates: kind === 'in' ? from : to } });
    _arcs.push({ coords, kind, w, phase: (_arcs.length * 0.618) % 1 });
  };
  // Il verso è quello del denaro: da chi paga a chi incassa.
  for (const r of drawIn) add('in', countryAnchor(r.id), home, r.m);
  for (const r of drawOut) add('out', home, countryAnchor(r.id), r.m);
  feats.push({ type: 'Feature', properties: { role: 'origin' }, geometry: { type: 'Point', coordinates: home } });
  return feats;
}

/** La moneta: un disco d'oro con bordo e riflesso, disegnato una volta.
 *  NON è SDF — i colori sono suoi, è una moneta per tutte e due le
 *  direzioni; a distinguere i versi ci pensano le linee. */
function ensureCoin(map) {
  if (map.hasImage(COIN)) return;
  const size = 40;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size * 0.38, size * 0.35, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#fff3c4');
  g.addColorStop(0.45, '#f2c94c');
  g.addColorStop(1, '#a8740f');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#7a5208';
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(122,82,8,.6)';
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2); ctx.stroke();
  map.addImage(COIN, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function ensureLayers(map) {
  ensureCoin(map);
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource(SRC_FX, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const kindColor = ['match', ['get', 'kind'], 'in', IN_COLOR, OUT_COLOR];
  const width = (lo, hi) => ['interpolate', ['linear'], ['zoom'],
    1, ['+', lo, ['*', hi, ['get', 'w']]],
    5, ['+', lo * 1.8, ['*', hi * 1.8, ['get', 'w']]]];
  map.addLayer({
    id: LYR_GROUND, type: 'line', source: SRC, filter: ['==', ['get', 'role'], 'ground'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#000000', 'line-width': width(1, 2.5), 'line-blur': 2.5, 'line-opacity': 0.25 },
  });
  map.addLayer({
    id: LYR_LINE, type: 'line', source: SRC,
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'role'], 'ground']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': kindColor, 'line-width': width(1.2, 5), 'line-opacity': 0.55 },
  });
  map.addLayer({
    id: LYR_ENDS, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'end'],
    paint: { 'circle-radius': 3.5, 'circle-color': kindColor, 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 1 },
  });
  map.addLayer({
    id: LYR_ORIGIN, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'origin'],
    paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 2.5 },
  });
  map.addLayer({
    id: LYR_COINS, type: 'symbol', source: SRC_FX,
    layout: {
      'icon-image': COIN,
      'icon-size': ['get', 's'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': ['get', 'o'] },
  });
}

/* ── Monete che scorrono ──
   Più monete dove passa più denaro (1 → 4), sfasate fra loro; ognuna
   "ruota" stringendosi e allargandosi un poco mentre avanza. Ferme
   uscendo dalla vista, con la time machine e sotto gli overlay. */
const FX_FRAME_MS = 33;
const COIN_TRIP_MS = 3000;
let _raf = null;
let _last = 0;
let _paused = false;
let _fxOn = false;

function tick(now) {
  _raf = null;
  const map = state.map;
  if (_paused || !animationsOn() || state.timeMachineActive || state.coloringMode !== 'funding' || !_arcs.length || !map?.getSource(SRC_FX)) {
    if (_fxOn) { map?.getSource(SRC_FX)?.setData({ type: 'FeatureCollection', features: [] }); _fxOn = false; }
    return;
  }
  if (now - _last >= FX_FRAME_MS) {
    _last = now;
    const feats = [];
    for (const a of _arcs) {
      const coins = 1 + Math.round(a.w * 3);
      for (let j = 0; j < coins; j++) {
        const t = (now / COIN_TRIP_MS + a.phase + j / coins) % 1;
        const o = Math.min(1, t * 8, (1 - t) * 8);
        const spin = 0.85 + 0.15 * Math.cos((now / 260) + j * 1.7 + a.phase * 10);
        feats.push({
          type: 'Feature',
          properties: { s: (0.42 + 0.35 * a.w) * spin, o },
          geometry: { type: 'Point', coordinates: alongArc(a.coords, t) },
        });
      }
    }
    map.getSource(SRC_FX).setData({ type: 'FeatureCollection', features: feats });
    _fxOn = true;
  }
  _raf = requestAnimationFrame(tick);
}

function start() {
  if (_raf || _paused || !animationsOn()) return;
  _raf = requestAnimationFrame(tick);
}

export function pauseFundingFx() {
  _paused = true;
  if (_raf) cancelAnimationFrame(_raf);
  _raf = null;
}

export function resumeFundingFx() {
  _paused = false;
  if (state.coloringMode === 'funding' && _arcs.length) start();
}

/** Chiamata da renderMap a ogni ridisegno. */
export function syncFundingOverlay() {
  const map = state.map;
  if (!map?.getLayer('regions-fill')) return;
  const on = state.coloringMode === 'funding';
  if (!on && !map.getSource(SRC)) return;
  if (on) ensureLayers(map);
  map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: on ? overlayFeatures() : [] });
  if (!on) _arcs = [];
  if (on && _arcs.length) start();
  else if (_fxOn) { map.getSource(SRC_FX)?.setData({ type: 'FeatureCollection', features: [] }); _fxOn = false; }
}

/* ══════════════════ CLICK E COMANDI ══════════════════ */

export function onFundingCountryClick(countryId) {
  if (!countryId) return;
  const s = fund();
  s.focus = s.focus === countryId ? null : countryId;
  if (s.focus) trackEvent('funding-focus', { nation: state.nationMap.get(s.focus)?.name });
  // map: true — col fuoco cambia anche il colore della mappa (vedi sopra).
  refreshAll();
}

export function clearFundingFocus() {
  const s = fund();
  if (!s.focus) return;
  s.focus = null;
  refreshAll();
}

function refreshAll({ map = true } = {}) {
  syncLink();
  if (map) import('./map.js').then(m => m.renderMap());
  else syncFundingOverlay();
  if (!map) import('./ui.js').then(m => m.updateDynamicLegend());
  import('../panel/countryPanel.js').then(m => m.refreshViewOverviewPanel('funding'));
}

/** WarEra+ — link condivisibile e tasto Indietro (src/app/backNav.js), come
 *  in Migrazioni: ?days= nel link della vista (0 = tutto l'archivio; la
 *  finestra di partenza, 30, non si scrive), ?focus= come livello sopra la
 *  vista. Il fuoco qui ricolora anche la mappa, da cui `map: true`. */
function syncLink() {
  if (state.coloringMode !== 'funding') return;
  const s = fund();
  updateBackParams('mapview', { days: s.days !== 30 ? s.days : undefined });
  syncBack('mapview/focus', !!s.focus, () => { s.focus = null; refreshAll(); },
    () => state.coloringMode === 'funding' && !!fund().focus, { focus: s.focus });
}

export function wireFundingOverview(root) {
  root.querySelectorAll('[data-fund-days]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = fund();
      const d = Number(btn.dataset.fundDays);
      if (d === s.days) return;
      s.days = d;
      trackEvent('funding-days', { days: d });
      refreshAll();
    });
  });
  root.querySelectorAll('[data-fund-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = fund();
      if (btn.dataset.fundDir === s.dir) return;
      s.dir = btn.dataset.fundDir;
      refreshAll({ map: false });
    });
  });
  root.querySelectorAll('[data-fund-country]').forEach(el => {
    el.addEventListener('click', () => {
      fund().focus = el.dataset.fundCountry;
      refreshAll();
    });
  });
  root.querySelectorAll('[data-fund-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = fund();
      if (btn.dataset.fundAction === 'unfocus') { s.focus = null; refreshAll(); }
      else if (btn.dataset.fundAction === 'open-nation' && s.focus) {
        import('../panel/countryPanel.js').then(m => m.selectNationInPanel(s.focus));
      }
    });
  });
}
