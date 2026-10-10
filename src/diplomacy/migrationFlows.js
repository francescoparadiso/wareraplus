/* ══════════════════════════════════════════════════════════════
   WarEra+ — Vista mappa "Migrazioni" (chi guadagna giocatori, chi li perde)
   ------------------------------------------------------------------
   Richiesta dell'utente: una vista dei flussi migratori — quali nazioni
   hanno un saldo positivo e quali negativo, e cliccandone una le frecce
   verso dove sta "esportando" giocatori.

   Il dato non è del gioco: WarEra dice solo dove sta un giocatore
   ADESSO. I trasferimenti li ricava il cache-server confrontando ogni ora
   il censimento cittadini con quello dell'ora prima (server/
   citizenMoves.js), e /migration-flows li restituisce già sommati per
   coppia da → a, per tutto il mondo, in una richiesta sola. Nessun
   ripiego diretto: non esiste una chiamata WarEra equivalente, quindi
   senza server la legenda e il riepilogo lo dicono e la mappa resta
   neutra — stesso degrado della sezione movimenti del pannello nazione
   (src/panel/nationWatch.js), che legge lo stesso archivio.

   ⚠️ Accumula e non recupera: prima del deploy di citizenMoves.js non
   c'è niente. `coverageFrom` nella risposta dice da quando l'archivio
   guarda, e il riepilogo lo dichiara se la finestra scelta comincia
   prima — altrimenti un mese "vuoto" sembrerebbe un mese tranquillo.

   Tre pezzi, tutti qui dentro (come travelDistance.js):
     · colore della mappa: saldo per nazione, rosso → verde, assoluto o
       ogni 100 cittadini di livello 10+ (renderMap →
       buildMigrationColorExpression);
     · frecce della nazione cliccata: archi curvi con le punte lungo la
       linea, spessore ∝ √spostamenti, il numero a metà arco
       (syncMigrationOverlay, chiamata da renderMap), più l'effetto
       "volo" animato (vedi ANIMAZIONE più sotto);
     · comandi del riepilogo nel pannello (wireMigrationOverview); il
       markup sta in viewOverview.js con le altre viste, che ne possiede
       gli attrezzi (righe, celle, intestazione).
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { COLORS, WARERA_CACHE_BASE } from './config.js';
import { trackEvent } from '../shared/analytics.js';

export const MIGRATION_DAYS = [1, 7, 30];
export const OUT_COLOR = '#ff9f43';   // partenze: arancio, non si confonde col rosso del saldo
export const IN_COLOR = '#4fc3f7';    // arrivi: azzurro
const NEUTRAL = '#8b949e';            // si è mosso qualcuno ma il saldo è zero
// Sotto questi cittadini il saldo "ogni 100" è rumore: 2 partenze su 6
// abitanti farebbero della nazione la peggiore del mondo.
export const MIN_RATE_CITIZENS = 20;
const MAX_ARROWS = 15;                // per direzione: oltre, l'elenco nel pannello
const FETCH_TIMEOUT_MS = 15000;
const TTL_MS = 10 * 60 * 1000;        // il server ricalcola ogni 10 min, il dato cambia ogni ora

const SRC = 'wp-migration-src';
const LYR_GROUND = 'wp-migration-ground';
const LYR_GLOW = 'wp-migration-glow';
const LYR_LINE = 'wp-migration-line';
const LYR_HEADS = 'wp-migration-heads';
const LYR_ENDS = 'wp-migration-ends';
const LYR_BADGE = 'wp-migration-badge';
const LYR_BADGE_TXT = 'wp-migration-badge-txt';
const LYR_ORIGIN = 'wp-migration-origin';
const ICON = 'wp-migration-chevron';
const SRC_FX = 'wp-migration-fx-src';
const LYR_FX_SHADOW = 'wp-migration-fx-shadow';
const LYR_FX_GLOW = 'wp-migration-fx-glow';
const LYR_FX_CORE = 'wp-migration-fx-core';

/** Lo stato della vista, creato al primo uso. */
export function mig() {
  if (!state.migration) {
    // `dir` parte da 'both' (richiesta dell'utente): con le sole partenze
    // le frecce in entrata restavano dietro un bottone e sembravano mancare.
    state.migration = { data: null, error: null, at: 0, days: 7, metric: 'net', focus: null, dir: 'both', loading: false };
  }
  return state.migration;
}

const canHover = () => window.matchMedia('(hover: hover)').matches;
export { canHover as migrationCanHover };

// ══════════════════ DATI ══════════════════

let _timer = null;
let _reqSeq = 0;

/** Scarica i flussi della finestra scelta. `error`: 'missing' (404, server
 *  non rideployato) o 'unreachable'. Un errore non cancella i dati buoni
 *  della finestra precedente se è la stessa. */
export async function loadMigrationFlows({ force = false } = {}) {
  const s = mig();
  if (!force && s.data && s.data.days === s.days && Date.now() - s.at < TTL_MS) return;
  const seq = ++_reqSeq;
  const days = s.days;
  s.loading = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}/migration-flows?days=${days}`, { signal: controller.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const body = await res.json();
    if (seq !== _reqSeq) return;     // nel frattempo si è chiesta un'altra finestra
    if (!body || !body.countries) throw new Error('risposta senza countries');
    s.data = body;
    s.at = Date.now();
    s.error = null;
  } catch (err) {
    if (seq !== _reqSeq) return;
    console.warn('[migration] flussi non disponibili:', err.message);
    s.error = err.status === 404 ? 'missing' : 'unreachable';
    if (s.data && s.data.days !== days) s.data = null;
  } finally {
    clearTimeout(timer);
    if (seq === _reqSeq) s.loading = false;
  }
  if (state.coloringMode === 'migration') refreshAll();
}

/** Entrando nella vista: scarica (se serve) e tiene il dato fresco finché
 *  la vista resta accesa e la scheda è visibile. */
export function enterMigrationView() {
  clearInterval(_timer);
  _timer = setInterval(() => {
    if (state.coloringMode !== 'migration') { clearInterval(_timer); _timer = null; return; }
    if (!document.hidden) loadMigrationFlows({ force: true });
  }, TTL_MS);
  return loadMigrationFlows();
}

// ══════════════════ NUMERI ══════════════════

/** Il valore che tinge una nazione con la metrica scelta, o null. */
export function migrationValue(c, metric = mig().metric) {
  if (!c) return null;
  if (metric === 'rate') {
    if (!c.citizens || c.citizens < MIN_RATE_CITIZENS) return null;
    return c.net / c.citizens * 100;
  }
  return c.net;
}

/** Fondo scala: il 90° percentile dei valori, non il massimo — una
 *  nazione che si svuota in un giorno non deve spegnere tutte le altre. */
function scaleMax(metric = mig().metric) {
  const vals = Object.values(mig().data?.countries || {})
    .map(c => Math.abs(migrationValue(c, metric) ?? 0))
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  if (!vals.length) return 1;
  return Math.max(metric === 'rate' ? 0.5 : 2, vals[Math.floor((vals.length - 1) * 0.9)]);
}

const lerp = (a, b, k) => Math.round(a + (b - a) * k);
const mix = (c1, c2, k) => `rgb(${lerp(c1[0], c2[0], k)},${lerp(c1[1], c2[1], k)},${lerp(c1[2], c2[2], k)})`;
const GREEN_LO = [155, 233, 168], GREEN_HI = [26, 127, 55];
const RED_LO = [255, 179, 173], RED_HI = [182, 35, 36];

export function migrationColor(v, max = scaleMax()) {
  if (v == null) return null;
  if (v === 0) return NEUTRAL;
  // Radice: i saldi piccoli (la maggior parte) restano distinguibili dal
  // neutro invece di schiacciarsi tutti sul colore più chiaro.
  const k = Math.min(1, Math.sqrt(Math.abs(v) / max));
  return v > 0 ? mix(GREEN_LO, GREEN_HI, k) : mix(RED_LO, RED_HI, k);
}

export function migrationLegendGradient() {
  return `linear-gradient(to right, rgb(${RED_HI}), rgb(${RED_LO}) 45%, ${NEUTRAL} 50%, rgb(${GREEN_LO}) 55%, rgb(${GREEN_HI}))`;
}

export function buildMigrationColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const countries = mig().data?.countries;
  if (!countries) return COLORS.DEFAULT_LAND;
  const max = scaleMax();
  const byColor = new Map();
  for (const [id, c] of Object.entries(countries)) {
    const col = migrationColor(migrationValue(c), max);
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

export function getMigrationStats() {
  const d = mig().data;
  if (!d) return null;
  let gaining = 0, losing = 0;
  for (const c of Object.values(d.countries)) {
    if (c.net > 0) gaining++;
    else if (c.net < 0) losing++;
  }
  return {
    moves: d.totals?.moves || 0,
    people: d.totals?.people || 0,
    gaining, losing,
    inactive: d.totals?.inactive || 0,
    lowLevel: d.totals?.lowLevel || 0,
  };
}

/** Le classifiche del riepilogo: chi guadagna, chi perde, le coppie più grosse. */
export function migrationRanking(limit = 10) {
  const d = mig().data;
  if (!d) return { gaining: [], losing: [], flows: [] };
  const metric = mig().metric;
  const rows = Object.entries(d.countries)
    .map(([id, c]) => ({ id, ...c, value: migrationValue(c, metric) }))
    .filter(r => r.value != null && r.value !== 0);
  return {
    gaining: rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value || b.in - a.in).slice(0, limit),
    losing: rows.filter(r => r.value < 0).sort((a, b) => a.value - b.value || b.out - a.out).slice(0, limit),
    flows: (d.flows || []).slice(0, limit),
  };
}

/** I partner di una nazione: dove vanno i suoi e da dove arrivano gli altri. */
export function focusFlows(id = mig().focus) {
  const flows = mig().data?.flows || [];
  const out = [], inn = [];
  for (const f of flows) {
    if (f.f === id) out.push({ id: f.t, n: f.n });
    else if (f.t === id) inn.push({ id: f.f, n: f.n });
  }
  // `flows` arriva già ordinato per n decrescente dal server.
  return { out, in: inn, country: mig().data?.countries?.[id] || null };
}

// ══════════════════ FRECCE ══════════════════

let _anchorsFrom = null;
let _anchors = new Map();

/** Dove parte e arriva una freccia: il punto dell'etichetta della nazione
 *  (sta dentro il territorio principale anche per le nazioni a forma di
 *  mezzaluna), altrimenti il centroide dei marker battaglia. */
function anchorOf(id) {
  if (_anchorsFrom !== state.labelsData) {
    _anchorsFrom = state.labelsData;
    _anchors = new Map();
    for (const l of state.labelsData || []) {
      const cId = l.properties?.countryId;
      if (cId && Array.isArray(l.coordinates) && !_anchors.has(cId)) _anchors.set(cId, l.coordinates);
    }
  }
  return _anchors.get(id) || state.centroids?.get(id) || null;
}

// L'arco si calcola in Mercatore, non in gradi: è così che la mappa lo
// disegna, e una curva fatta in latitudine sembrerebbe storta al nord.
const D2R = Math.PI / 180;
const toY = lat => Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) / D2R;
const toLat = y => (2 * Math.atan(Math.exp(y * D2R)) - Math.PI / 2) / D2R;

/** Arco da a a b che piega a SINISTRA del verso di marcia: andata e
 *  ritorno fra le stesse due nazioni stanno così su due lati, non uno
 *  sopra l'altro. Restituisce anche il punto a metà, per il numero. */
function arc(a, b, steps = 28) {
  const ax = a[0], ay = toY(a[1]), bx = b[0], by = toY(b[1]);
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(0.28, 0.12 + 4 / len) * len;
  const cx = (ax + bx) / 2 - dy / len * bend;
  const cy = (ay + by) / 2 + dx / len * bend;
  const pt = (t) => {
    const u = 1 - t;
    return [u * u * ax + 2 * u * t * cx + t * t * bx, toLat(u * u * ay + 2 * u * t * cy + t * t * by)];
  };
  const coords = [];
  for (let i = 0; i <= steps; i++) coords.push(pt(i / steps));
  return { coords, mid: pt(0.5) };
}

// Mercatore dritto da a a b, per l'ombra "a terra" di una cometa.
function groundAt(a, b, t) {
  const ay = toY(a[1]), by = toY(b[1]);
  return [a[0] + (b[0] - a[0]) * t, toLat(ay + (by - ay) * t)];
}

/** Punto a frazione t (0–1) lungo una polilinea a passi uniformi. */
function alongArc(coords, t) {
  const f = Math.max(0, Math.min(1, t)) * (coords.length - 1);
  const i = Math.min(coords.length - 2, Math.floor(f));
  const k = f - i;
  const p = coords[i], q = coords[i + 1];
  return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
}

// Gli archi disegnati adesso, per l'animazione: la geometria si calcola
// una volta sola in overlayFeatures, il giro dei fotogrammi la rilegge.
let _fxArcs = [];

function overlayFeatures() {
  const s = mig();
  _fxArcs = [];
  if (!s.focus || !s.data) return [];
  const home = anchorOf(s.focus);
  if (!home) return [];
  const { out, in: inn } = focusFlows(s.focus);
  const drawOut = s.dir !== 'in' ? out.slice(0, MAX_ARROWS) : [];
  const drawIn = s.dir !== 'out' ? inn.slice(0, MAX_ARROWS) : [];
  const maxN = Math.max(1, ...drawOut.map(r => r.n), ...drawIn.map(r => r.n));
  const feats = [];
  const add = (kind, from, to, n) => {
    if (!from || !to) return;
    const { coords, mid } = arc(from, to);
    const w = Math.sqrt(n / maxN);
    // L'ombra a terra: la retta fra i due estremi, sotto l'arco. È lei a
    // far leggere l'arco come una traiettoria SOLLEVATA e non come una
    // linea storta sulla mappa.
    feats.push({ type: 'Feature', properties: { kind, n, w, role: 'ground' }, geometry: { type: 'LineString', coordinates: [from, to] } });
    feats.push({ type: 'Feature', properties: { kind, n, w }, geometry: { type: 'LineString', coordinates: coords } });
    _fxArcs.push({ kind, coords, from, to, w, phase: (_fxArcs.length * 0.618) % 1 });
    feats.push({ type: 'Feature', properties: { kind, n, w, role: 'badge', label: String(n) }, geometry: { type: 'Point', coordinates: mid } });
    // Il pallino all'estremo che non è la nazione cliccata.
    const end = kind === 'out' ? to : from;
    feats.push({ type: 'Feature', properties: { kind, role: 'end' }, geometry: { type: 'Point', coordinates: end } });
  };
  for (const r of drawOut) add('out', home, anchorOf(r.id), r.n);
  for (const r of drawIn) add('in', anchorOf(r.id), home, r.n);
  feats.push({ type: 'Feature', properties: { role: 'origin' }, geometry: { type: 'Point', coordinates: home } });
  return feats;
}

/** La punta di freccia, disegnata una volta su un canvas e caricata come
 *  icona SDF: così il colore lo decide il layer, e una sola immagine serve
 *  sia alle partenze sia agli arrivi. Punta verso destra = verso della
 *  linea, che è quello che `symbol-placement: line` si aspetta. */
function ensureIcon(map) {
  if (map.hasImage(ICON)) return;
  const size = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(26, 16);
  ctx.lineTo(8, 26);
  ctx.lineTo(13, 16);
  ctx.closePath();
  ctx.fill();
  map.addImage(ICON, ctx.getImageData(0, 0, size, size), { sdf: true, pixelRatio: 2 });
}

function ensureLayers(map) {
  ensureIcon(map);
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const kindColor = ['match', ['get', 'kind'], 'out', OUT_COLOR, IN_COLOR];
  const isLine = ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'role'], 'ground']];
  // Spessore: base + √(spostamenti / il più grosso), e cresce col zoom.
  const width = (lo, hi) => ['interpolate', ['linear'], ['zoom'],
    1, ['+', lo, ['*', hi, ['get', 'w']]],
    5, ['+', lo * 1.8, ['*', hi * 1.8, ['get', 'w']]]];
  map.addLayer({
    id: LYR_GROUND, type: 'line', source: SRC,
    filter: ['==', ['get', 'role'], 'ground'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#000000', 'line-width': width(1.5, 3), 'line-blur': 2.5, 'line-opacity': 0.28 },
  });
  map.addLayer({
    id: LYR_GLOW, type: 'line', source: SRC, filter: isLine,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': kindColor, 'line-width': width(4, 6), 'line-blur': 4, 'line-opacity': 0.3 },
  });
  map.addLayer({
    id: LYR_LINE, type: 'line', source: SRC, filter: isLine,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': kindColor, 'line-width': width(1.2, 4), 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: LYR_HEADS, type: 'symbol', source: SRC, filter: isLine,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 90,
      'icon-image': ICON,
      'icon-size': ['+', 0.55, ['*', 0.5, ['get', 'w']]],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotation-alignment': 'map',
    },
    paint: { 'icon-color': kindColor, 'icon-halo-color': '#0b1c33', 'icon-halo-width': 1 },
  });
  map.addLayer({
    id: LYR_ENDS, type: 'circle', source: SRC,
    filter: ['==', ['get', 'role'], 'end'],
    paint: { 'circle-radius': 3.5, 'circle-color': kindColor, 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 1 },
  });
  map.addLayer({
    id: LYR_ORIGIN, type: 'circle', source: SRC,
    filter: ['==', ['get', 'role'], 'origin'],
    paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 2.5 },
  });
  map.addLayer({
    id: LYR_BADGE, type: 'circle', source: SRC,
    filter: ['==', ['get', 'role'], 'badge'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'w'], 0, 8, 1, 11],
      'circle-color': kindColor,
      'circle-stroke-color': '#0b1c33',
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: LYR_BADGE_TXT, type: 'symbol', source: SRC,
    filter: ['==', ['get', 'role'], 'badge'],
    layout: {
      // ⚠️ un font che fonts.openmaptiles.org NON ha (era 'Noto Sans Regular':
      // risponde 200 con una pagina HTML) fa fallire il parse dei glifi e con
      // lui l'intera sorgente, linee comprese: «Unimplemented type: 4».
      'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Open Sans Bold'],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#0b1c33' },
  });

  // L'animazione ha una sorgente sua: riscrivere ogni fotogramma quella
  // delle frecce rifarebbe anche numeri e punte, che stanno fermi.
  // Ombre sotto, poi l'alone, poi il nucleo; badge e numeri restano sopra
  // a tutto perché questi layer si infilano prima di LYR_ENDS.
  map.addSource(SRC_FX, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: LYR_FX_SHADOW, type: 'circle', source: SRC_FX,
    filter: ['==', ['get', 'role'], 'shadow'],
    paint: { 'circle-radius': ['get', 'r'], 'circle-color': '#000000', 'circle-blur': 0.8, 'circle-opacity': ['get', 'o'] },
  }, LYR_ENDS);
  map.addLayer({
    id: LYR_FX_GLOW, type: 'circle', source: SRC_FX,
    filter: ['==', ['get', 'role'], 'comet'],
    paint: { 'circle-radius': ['*', ['get', 'r'], 2.4], 'circle-color': kindColor, 'circle-blur': 1, 'circle-opacity': ['*', ['get', 'o'], 0.45] },
  }, LYR_ENDS);
  map.addLayer({
    id: LYR_FX_CORE, type: 'circle', source: SRC_FX,
    filter: ['==', ['get', 'role'], 'comet'],
    paint: {
      'circle-radius': ['get', 'r'],
      'circle-color': ['match', ['get', 'kind'], 'out', '#ffd9b0', '#d6f3ff'],
      'circle-stroke-color': kindColor,
      'circle-stroke-width': ['*', ['get', 'r'], 0.35],
      'circle-opacity': ['get', 'o'],
      'circle-stroke-opacity': ['get', 'o'],
    },
  }, LYR_ENDS);
}

/* ══════════════════ ANIMAZIONE ══════════════════
   Richiesta dell'utente: «un effetto di movimento 3D» sulle frecce.
   La mappa è piatta (niente pitch, MapLibre non solleva le linee), quindi
   la profondità si finge con tre segnali che l'occhio legge insieme:
     · l'arco ha sotto la sua OMBRA dritta a terra (layer statico);
     · lungo l'arco corrono COMETE con la scia, che si ingrandiscono
       verso il colmo (sin π·t: "più vicine") e rimpiccioliscono
       all'arrivo;
     · ogni cometa ha la sua ombra sulla retta a terra, che fa l'opposto:
       al colmo è piccola e sbiadita, come un oggetto che si alza.
   Le comete dicono anche il VERSO senza bisogno di leggere le punte.

   Costo: ogni fotogramma è una setData su qualche centinaio di punti, e
   ogni setData ridisegna la mappa (e le etichette, labels.js). Quindi:
   ~30 fotogrammi al secondo e non 60, solo con una nazione a fuoco e in
   questa vista, fermo con la scheda nascosta (requestAnimationFrame lo
   fa da sé), con la time machine aperta e sotto gli overlay a tutto
   schermo (pauseMigrationFx, chiamata da src/app/mapIdle.js).

   ⚠️ NON si guarda `prefers-reduced-motion`. C'era, e spegneva tutto
   sulla macchina dell'utente: Windows con "Effetti di animazione"
   disattivati lo dichiara a ogni sito, e il risultato era "il 3D c'è,
   il movimento no". L'animazione qui è il contenuto chiesto, non un
   ornamento, e parte solo dopo un clic esplicito su una nazione.
   ══════════════════════════════════════════════════════════════ */
const FX_FRAME_MS = 33;
const FX_PERIOD_MS = 3200;      // il tempo di un volo, lungo o corto che sia
const FX_TRAIL = 4;             // punti della scia, cometa compresa
let _fxRaf = null;
let _fxLast = 0;
let _fxPaused = false;
let _fxOn = false;               // la sorgente FX ha qualcosa disegnato

function fxFeatures(now) {
  const feats = [];
  for (const a of _fxArcs) {
    const comets = 1 + Math.round(a.w * 2);
    const size = 2.2 + 2.8 * a.w;
    for (let j = 0; j < comets; j++) {
      const t0 = (now / FX_PERIOD_MS + a.phase + j / comets) % 1;
      for (let k = 0; k < FX_TRAIL; k++) {
        const t = t0 - k * 0.022;
        if (t <= 0) break;
        const h = Math.sin(Math.PI * t);                    // "altezza": 0 agli estremi, 1 al colmo
        const edge = Math.min(1, t * 10, (1 - t) * 10);    // nasce e muore dolce agli estremi
        feats.push({
          type: 'Feature',
          properties: { role: 'comet', kind: a.kind, r: size * (0.65 + 0.85 * h) * (1 - k * 0.2), o: edge * (1 - k * 0.24) },
          geometry: { type: 'Point', coordinates: alongArc(a.coords, t) },
        });
        if (k === 0) {
          feats.push({
            type: 'Feature',
            properties: { role: 'shadow', r: size * (1.1 - 0.5 * h), o: edge * 0.5 * (1 - 0.65 * h) },
            geometry: { type: 'Point', coordinates: groundAt(a.from, a.to, t) },
          });
        }
      }
    }
  }
  return feats;
}

function setFx(features) {
  const src = state.map?.getSource(SRC_FX);
  if (src) src.setData({ type: 'FeatureCollection', features });
  _fxOn = features.length > 0;
}

function fxTick(now) {
  _fxRaf = null;
  if (_fxPaused || state.timeMachineActive || state.coloringMode !== 'migration' || !_fxArcs.length) {
    if (_fxOn) setFx([]);
    return;
  }
  if (now - _fxLast >= FX_FRAME_MS) {
    _fxLast = now;
    setFx(fxFeatures(now));
  }
  _fxRaf = requestAnimationFrame(fxTick);
}

function startFx() {
  if (_fxRaf || _fxPaused) return;
  _fxRaf = requestAnimationFrame(fxTick);
}

function stopFx() {
  if (_fxRaf) cancelAnimationFrame(_fxRaf);
  _fxRaf = null;
  if (_fxOn) setFx([]);
}

/** Overlay a tutto schermo aperto sopra la mappa (src/app/mapIdle.js). */
export function pauseMigrationFx() {
  _fxPaused = true;
  stopFx();
}

export function resumeMigrationFx() {
  _fxPaused = false;
  if (state.coloringMode === 'migration' && _fxArcs.length) startFx();
}

/** Chiamata da renderMap a ogni ridisegno: accende o spegne le frecce a
 *  seconda della vista. Uscire dalla vista le toglie senza un hook a parte. */
export function syncMigrationOverlay() {
  const map = state.map;
  if (!map?.getLayer('regions-fill')) return;
  const on = state.coloringMode === 'migration';
  if (!on && !map.getSource(SRC)) return;
  if (on) ensureLayers(map);
  const src = map.getSource(SRC);
  if (src) src.setData({ type: 'FeatureCollection', features: on ? overlayFeatures() : [] });
  if (!on) _fxArcs = [];
  if (on && _fxArcs.length) startFx();
  else stopFx();
}

// ══════════════════ CLICK E COMANDI ══════════════════

/** Il click su una nazione in vista Migrazioni (map.js:_onRegionClick).
 *  Riclicco della stessa = si torna al mondo. */
export function onMigrationCountryClick(countryId) {
  if (!countryId) return;
  const s = mig();
  s.focus = s.focus === countryId ? null : countryId;
  if (s.focus) trackEvent('migration-focus', { nation: state.nationMap.get(s.focus)?.name });
  refreshAll({ map: false });
}

/** Click sul mare: via le frecce, il riepilogo torna al mondo. */
export function clearMigrationFocus() {
  const s = mig();
  if (!s.focus) return;
  s.focus = null;
  refreshAll({ map: false });
}

function refreshAll({ map = true } = {}) {
  if (map) import('./map.js').then(m => m.renderMap());
  else syncMigrationOverlay();
  if (!map) import('./ui.js').then(m => m.updateDynamicLegend());
  import('../panel/countryPanel.js').then(m => m.refreshViewOverviewPanel('migration'));
}

/** Collega i comandi del riepilogo (countryPanel.js, dopo innerHTML). */
export function wireMigrationOverview(root) {
  root.querySelectorAll('[data-mig-days]').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = Number(btn.dataset.migDays);
      const s = mig();
      if (!days || days === s.days) return;
      s.days = days;
      trackEvent('migration-days', { days });
      refreshAll({ map: false });
      loadMigrationFlows({ force: true });
    });
  });
  root.querySelectorAll('[data-mig-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = mig();
      if (btn.dataset.migMetric === s.metric) return;
      s.metric = btn.dataset.migMetric;
      trackEvent('migration-metric', { metric: s.metric });
      refreshAll();
    });
  });
  root.querySelectorAll('[data-mig-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = mig();
      if (btn.dataset.migDir === s.dir) return;
      s.dir = btn.dataset.migDir;
      refreshAll({ map: false });
    });
  });
  root.querySelectorAll('[data-mig-country]').forEach(el => {
    el.addEventListener('click', () => {
      mig().focus = el.dataset.migCountry;
      trackEvent('migration-focus', { nation: state.nationMap.get(el.dataset.migCountry)?.name, via: 'panel' });
      refreshAll({ map: false });
    });
  });
  root.querySelectorAll('[data-mig-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = mig();
      if (btn.dataset.migAction === 'unfocus') {
        s.focus = null;
        refreshAll({ map: false });
      } else if (btn.dataset.migAction === 'open-nation' && s.focus) {
        import('../panel/countryPanel.js').then(m => m.selectNationInPanel(s.focus));
      }
    });
  });
}
