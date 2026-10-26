/* ══════════════════════════════════════════════════════════════
   WarEra+ — Tre animazioni legate a una vista mappa
   ------------------------------------------------------------------
   Richieste dell'utente, tutte con dati che la pagina ha GIÀ:
     · vista Produzione — le regioni con un GIACIMENTO (bonus temporaneo
       +30% su una risorsa, region.deposit in state.regionData) pulsano,
       sempre più in fretta man mano che il bonus sta per scadere: la
       cosa da sapere di un giacimento è quanto gli resta.
       Dalla v0.27 i giacimenti non esistono più e la vista racconta la
       rendita giornaliera (productionHeatmap.js): "respirano" in oro le
       TOP_REVENUE regioni che rendono di più, grandi quanto la loro
       rendita — le stesse dell'elenco nel riepilogo. Poche apposta: un
       puntino per ogni regione con una rendita coprirebbe la mappa;
     · vista Popolazione — le nazioni che nelle ultime 24 ore hanno
       guadagnato giocatori ATTIVI "respirano" in verde, quelle che ne
       hanno persi in rosso, grandi quanto la variazione;
     · vista Finanziamenti, senza nazione a fuoco — MONETE che salgono
       sopra le capitali dove il tesoro è cresciuto molto in 24 ore, e che
       scendono (con un alone rosso) dove è calato.
   Popolazione e tesoro sono gli aggregati a 24 ore del ticker, che li
   chiede già a ogni giro di 5 minuti e li annuncia con l'evento
   `wareraplus:ticker-data` (newsTicker.js): nessuna richiesta in più, e
   nessun import fra mappa e ticker. Finché il ticker non ha fatto il
   primo giro non c'è niente da mostrare.

   Una sorgente sola, ridisegnata a ~25 fps solo nella vista che la usa;
   con le animazioni spente (shared/motion.js) un fotogramma fermo, che
   dice ancora DOVE e QUANTO.
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { countryAnchor } from './flowGeometry.js';
import { activeDeposits, isRevenueEra, topRevenueRegions } from './productionHeatmap.js';
import { regionAnchor } from './travelDistance.js';
import { animationsOn } from '../shared/motion.js';

const SRC = 'wp-map-pulses-src';
const LYR_RING = 'wp-map-pulses-ring';
const LYR_DOT = 'wp-map-pulses-dot';
const LYR_COIN = 'wp-map-pulses-coin';
const COIN = 'wp-funding-coin';       // la stessa moneta della vista Finanziamenti
const FRAME_MS = 40;

const MAX_POP = 40;                   // nazioni che respirano: le variazioni più grosse
const TOP_REVENUE = 10;               // v0.27: regioni più redditizie che respirano
const MIN_TREASURY_PCT = 2;           // sotto, il tesoro "non è cambiato molto"
const MAX_TREASURY = 30;

let _items = [];      // dipende dalla vista, vedi build()
let _mode = null;
let _raf = null;
let _last = 0;
let _paused = false;
let _on = false;

let _agg = null;
window.addEventListener('wareraplus:ticker-data', (e) => {
  _agg = e.detail?.agg24 || null;
  if (state.coloringMode === 'population' || state.coloringMode === 'funding') syncMapPulses();
});
const aggregates = () => _agg;

function regionPos(id) {
  const p = state.regionData?.[id]?.position;
  return Array.isArray(p) ? p : null;
}

function build(mode) {
  _items = [];
  if (mode === 'production' && isRevenueEra()) {
    // v0.27: le regioni più redditizie. Il punto è quello della geometria
    // (regionAnchor), non `position`, che per alcune regioni è la città di
    // un'altra (vedi le Operazioni in CLAUDE.md).
    const rows = topRevenueRegions(TOP_REVENUE);
    const max = rows[0]?.total || 1;
    for (const r of rows) {
      const pos = regionAnchor(r.id) || regionPos(r.id);
      if (!pos) continue;
      _items.push({ kind: 'revenue', pos, w: Math.sqrt(r.total / max), phase: _items.length * 0.37 % 1 });
    }
  } else if (mode === 'production') {
    const now = Date.now();
    for (const d of activeDeposits(now)) {
      const pos = regionPos(d.regionId);
      if (!pos) continue;
      // Quanto ne resta sulla durata intera: 1 = appena acceso, 0 = scade.
      const left = d.startsAt && d.endsAt > d.startsAt ? Math.max(0, Math.min(1, (d.endsAt - now) / (d.endsAt - d.startsAt))) : 0.5;
      _items.push({ kind: 'deposit', pos, period: 600 + 2600 * left, phase: _items.length * 0.29 % 1 });
    }
  } else if (mode === 'population') {
    const pop = aggregates()?.population || {};
    const rows = Object.entries(pop).filter(([, d]) => d).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, MAX_POP);
    const max = Math.max(1, ...rows.map(([, d]) => Math.abs(d)));
    for (const [id, d] of rows) {
      const pos = countryAnchor(id);
      if (!pos) continue;
      _items.push({ kind: 'pop', pos, up: d > 0, w: Math.sqrt(Math.abs(d) / max), phase: _items.length * 0.37 % 1 });
    }
  } else if (mode === 'funding') {
    const wealth = aggregates()?.wealth || {};
    const rows = Object.entries(wealth).filter(([, p]) => Math.abs(p) >= MIN_TREASURY_PCT)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, MAX_TREASURY);
    const max = Math.max(1, ...rows.map(([, p]) => Math.abs(p)));
    for (const [id, p] of rows) {
      const pos = countryAnchor(id);
      if (!pos) continue;
      _items.push({ kind: 'coin', pos, up: p > 0, w: Math.min(1, Math.sqrt(Math.abs(p) / max)), phase: _items.length * 0.53 % 1 });
    }
  }
}

function features(now, still) {
  const feats = [];
  for (const it of _items) {
    if (it.kind === 'deposit') {
      // Due anelli che si allargano dalla regione, al passo del giacimento.
      for (let k = 0; k < 2; k++) {
        const x = still ? 0.35 : ((now / it.period) + it.phase + k / 2) % 1;
        feats.push({ type: 'Feature', properties: { role: 'ring', c: '#e3b341', r: 4 + 16 * x, o: (1 - x) * 0.9 }, geometry: { type: 'Point', coordinates: it.pos } });
        if (still) break;
      }
      feats.push({ type: 'Feature', properties: { role: 'dot', c: '#e3b341', r: 3, o: 1 }, geometry: { type: 'Point', coordinates: it.pos } });
    } else if (it.kind === 'revenue') {
      // Un respiro lento in oro, come la popolazione: non è un conto alla
      // rovescia, è "qui si incassa".
      const b = still ? 0.5 : 0.5 + 0.5 * Math.sin((now / 3600 + it.phase) * 2 * Math.PI);
      const r = (5 + 12 * it.w) * (0.75 + 0.35 * b);
      feats.push({ type: 'Feature', properties: { role: 'ring', c: '#e3b341', r, o: 0.35 + 0.45 * b, fill: 1 }, geometry: { type: 'Point', coordinates: it.pos } });
    } else if (it.kind === 'pop') {
      // Un respiro lento: si gonfia e si sgonfia, non batte.
      const b = still ? 0.5 : 0.5 + 0.5 * Math.sin((now / 3200 + it.phase) * 2 * Math.PI);
      const r = (5 + 14 * it.w) * (0.7 + 0.45 * b);
      feats.push({ type: 'Feature', properties: { role: 'ring', c: it.up ? '#3fb950' : '#f85149', r, o: 0.35 + 0.45 * b, fill: 1 }, geometry: { type: 'Point', coordinates: it.pos } });
    } else if (it.kind === 'coin') {
      // Una moneta sale (tesoro cresciuto) o scende (calato) e svanisce.
      const x = still ? 0.5 : ((now / 2600) + it.phase) % 1;
      const dy = (it.up ? -1 : 1) * (6 + 34 * x);
      feats.push({ type: 'Feature', properties: { role: 'coin', s: 0.4 + 0.3 * it.w, dy, o: Math.min(1, x * 6, (1 - x) * 3) }, geometry: { type: 'Point', coordinates: it.pos } });
      if (!it.up) feats.push({ type: 'Feature', properties: { role: 'ring', c: '#f85149', r: 9 + 6 * it.w, o: 0.5 }, geometry: { type: 'Point', coordinates: it.pos } });
    }
  }
  return feats;
}

function ensureLayers(map) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: LYR_RING, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'ring'],
    paint: {
      'circle-radius': ['get', 'r'],
      'circle-color': ['get', 'c'],
      'circle-opacity': ['*', ['get', 'o'], ['case', ['==', ['get', 'fill'], 1], 0.35, 0.08]],
      'circle-stroke-color': ['get', 'c'],
      'circle-stroke-width': 2,
      'circle-stroke-opacity': ['get', 'o'],
    },
  });
  map.addLayer({
    id: LYR_DOT, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'dot'],
    paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'c'], 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 1 },
  });
  map.addLayer({
    id: LYR_COIN, type: 'symbol', source: SRC, filter: ['==', ['get', 'role'], 'coin'],
    layout: {
      'icon-image': COIN,
      'icon-size': ['get', 's'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': ['get', 'o'] },
  });
}

/* Lo spostamento in su o in giù della moneta va nella geometria, in pixel
   convertiti in gradi allo zoom di adesso: `icon-translate` vale per tutto
   il layer, non per la singola moneta. */
function pxToLat(map, pos, dy) {
  const p = map.project(pos);
  const q = map.unproject([p.x, p.y + dy]);
  return [pos[0], q.lat];
}

function paint(now, still) {
  const map = state.map;
  const src = map?.getSource(SRC);
  if (!src) return;
  const feats = features(now, still).map(f => (f.properties.role === 'coin'
    ? { ...f, geometry: { type: 'Point', coordinates: pxToLat(map, f.geometry.coordinates, f.properties.dy) } }
    : f));
  src.setData({ type: 'FeatureCollection', features: feats });
  _on = feats.length > 0;
}

function tick(now) {
  _raf = null;
  if (_paused || state.timeMachineActive || state.coloringMode !== _mode || !_items.length) return;
  if (!animationsOn()) { paint(now, true); return; }
  if (now - _last >= FRAME_MS) { _last = now; paint(now, false); }
  _raf = requestAnimationFrame(tick);
}

const modeFor = () => {
  const m = state.coloringMode;
  if (m === 'production' || m === 'population') return m;
  if (m === 'funding' && !state.funding?.focus) return 'funding';
  return null;
};

/** Chiamata da renderMap a ogni ridisegno. */
export function syncMapPulses() {
  const map = state.map;
  if (!map?.getLayer('regions-fill')) return;
  const mode = modeFor();
  if (!mode) {
    _mode = null;
    _items = [];
    if (_raf) cancelAnimationFrame(_raf);
    _raf = null;
    if (_on) { map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: [] }); _on = false; }
    return;
  }
  ensureLayers(map);
  // La moneta la disegna fundingFlows.js; se lì non è ancora passata,
  // in vista Finanziamenti si aspetta il giro dopo invece di rompersi.
  if (mode === 'funding' && !map.hasImage(COIN)) return;
  _mode = mode;
  build(mode);
  if (!_items.length) { if (_on) { map.getSource(SRC).setData({ type: 'FeatureCollection', features: [] }); _on = false; } return; }
  if (!animationsOn()) { paint(performance.now(), true); return; }
  if (!_raf && !_paused) _raf = requestAnimationFrame(tick);
}

export function pauseMapPulses() {
  _paused = true;
  if (_raf) cancelAnimationFrame(_raf);
  _raf = null;
}

export function resumeMapPulses() {
  _paused = false;
  if (_mode && _items.length && animationsOn()) _raf = requestAnimationFrame(tick);
}
