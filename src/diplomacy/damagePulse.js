/* ══════════════════════════════════════════════════════════════
   WarEra+ — Il battito del danno (vista "Danni settimanali")
   ------------------------------------------------------------------
   Richiesta dell'utente: nella vista Danni, ogni nazione che pulsa al
   ritmo del danno dell'ultima ora, più accesa dove ci sono molti
   pillati.

   Il colore della vista resta quello di sempre (danno della SETTIMANA,
   blu → rosso, dal dato già in memoria). Sopra, sulla capitale di ogni
   nazione (flowGeometry.js), un cuore che dice cosa sta succedendo
   ADESSO, cioè nell'ultima ora completa:
     · grande e veloce quanto il danno di quell'ora (√ danno / il più
       alto): una nazione ferma non batte, una in piena guerra corre;
     · l'alone va dall'ambra al rosa acceso, e si allarga, con la quota
       di giocatori attivi PILLATI in quell'ora (item `cocain`, +60%
       attacco). Il denominatore è la popolazione attiva della classifica
       (rankings.countryActivePopulation, la metrica giusta).
   Il battito è doppio, "tu-tum", sfasato fra nazioni.

   Dati: /damage-pulse (server/damageTimeline.js: readPulse), una
   richiesta per tutto il mondo, rinfrescata ogni 10 minuti a vista
   accesa. Nessun ripiego: il danno di un'ora è la differenza fra due
   letture del cumulato settimanale e lo sa solo il server — senza, la
   vista resta quella di prima e la legenda lo dice.
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { WARERA_CACHE_BASE } from './config.js';
import { countryAnchor } from './flowGeometry.js';
import { animationsOn } from '../shared/motion.js';

const SRC = 'wp-dmg-pulse-src';
const LYR_GLOW = 'wp-dmg-pulse-glow';
const LYR_CORE = 'wp-dmg-pulse-core';
const TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10000;
const FRAME_MS = 40;
const SLOW_MS = 2600, FAST_MS = 650;   // periodo del battito: niente danno ↔ il più alto

let _data = null;        // { at, hour, to, rows: [{ id, d, p, rate }] }
let _error = null;
let _loading = false;
let _beats = [];         // { pos, w, rate, phase, period }
let _raf = null;
let _last = 0;
let _paused = false;
let _on = false;

export function damagePulseInfo() {
  return { data: _data, error: _error, loading: _loading };
}

async function load() {
  if (_loading || (_data && Date.now() - _data.at < TTL_MS)) return;
  _loading = true;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}/damage-pulse`, { signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const b = await res.json();
    const rows = [];
    (b.ids || []).forEach((id, i) => {
      const pop = state.nationMap.get(id)?.rankings?.countryActivePopulation?.value || 0;
      rows.push({ id, d: b.d[i] || 0, p: b.p[i] || 0, rate: pop ? Math.min(1, (b.p[i] || 0) / pop) : 0 });
    });
    _data = { at: Date.now(), hour: b.hour, to: b.to, rows };
    _error = null;
  } catch (err) {
    console.warn('[damage-pulse] non disponibile:', err.message);
    _error = err.status === 404 ? 'missing' : 'unreachable';
  } finally {
    clearTimeout(timer);
    _loading = false;
  }
  if (state.coloringMode === 'weeklyDamage') {
    syncDamagePulse();
    import('./ui.js').then(m => m.updateDynamicLegend()).catch(() => {});
  }
}

function buildBeats() {
  _beats = [];
  if (!_data?.rows?.length) return;
  const maxD = Math.max(1, ..._data.rows.map(r => r.d));
  let k = 0;
  for (const r of _data.rows) {
    if (r.d <= 0) continue;
    const pos = countryAnchor(r.id);
    if (!pos) continue;
    const w = Math.sqrt(r.d / maxD);
    _beats.push({ pos, w, rate: r.rate, phase: (k++ * 0.381) % 1, period: SLOW_MS + (FAST_MS - SLOW_MS) * w });
  }
}

/* "Tu-tum": due picchi stretti a inizio periodo, poi quiete. */
function heartbeat(x) {
  const g = (c, s) => Math.exp(-(((x - c) / s) ** 2));
  return g(0.08, 0.05) + 0.55 * g(0.26, 0.05);
}

const lerp = (a, b, k) => Math.round(a + (b - a) * k);
const AMBER = [255, 179, 71], HOT = [255, 92, 225];
const glowColor = r => `rgb(${lerp(AMBER[0], HOT[0], r)},${lerp(AMBER[1], HOT[1], r)},${lerp(AMBER[2], HOT[2], r)})`;

function ensureLayers(map) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: LYR_GLOW, type: 'circle', source: SRC,
    paint: { 'circle-radius': ['get', 'gr'], 'circle-color': ['get', 'c'], 'circle-blur': 1, 'circle-opacity': ['get', 'go'] },
  });
  map.addLayer({
    id: LYR_CORE, type: 'circle', source: SRC,
    paint: {
      'circle-radius': ['get', 'r'],
      'circle-color': '#ffffff',
      'circle-opacity': 0.95,
      'circle-stroke-color': ['get', 'c'],
      'circle-stroke-width': 1.5,
    },
  });
}

function tick(now) {
  _raf = null;
  const map = state.map;
  // Animazioni spente (Impostazioni): i cuori restano, fermi.
  if (!animationsOn() && !_paused && state.coloringMode === 'weeklyDamage' && _beats.length && map?.getSource(SRC)) {
    paintStill(map);
    return;
  }
  if (_paused || state.timeMachineActive || state.coloringMode !== 'weeklyDamage' || !_beats.length || !map?.getSource(SRC)) {
    if (_on) { map?.getSource(SRC)?.setData({ type: 'FeatureCollection', features: [] }); _on = false; }
    return;
  }
  // A vista accesa il dato si rinnova da sé: l'ora completa cambia ogni ora.
  if (_data && Date.now() - _data.at > TTL_MS && !document.hidden) load();
  if (now - _last >= FRAME_MS) {
    _last = now;
    const feats = _beats.map(b => {
      const x = ((now / b.period) + b.phase) % 1;
      const h = heartbeat(x);
      const base = 2.5 + 7 * b.w;
      return {
        type: 'Feature',
        properties: {
          r: base * (1 + 0.45 * h),
          gr: base * (2 + 1.6 * b.rate) * (1 + 0.6 * h),
          go: (0.25 + 0.45 * b.rate) * (0.55 + 0.45 * h),
          c: glowColor(b.rate),
        },
        geometry: { type: 'Point', coordinates: b.pos },
      };
    });
    map.getSource(SRC).setData({ type: 'FeatureCollection', features: feats });
    _on = true;
  }
  _raf = requestAnimationFrame(tick);
}

function start() {
  if (_raf || _paused) return;
  if (!animationsOn()) { paintStill(state.map); return; }
  _raf = requestAnimationFrame(tick);
}

/** Un fotogramma fermo, a battito nullo: la dimensione e l'alone dicono
 *  ancora danno e pillati, manca solo il movimento. */
function paintStill(map) {
  const src = map?.getSource(SRC);
  if (!src) return;
  src.setData({ type: 'FeatureCollection', features: _beats.map(b => {
    const base = 2.5 + 7 * b.w;
    return {
      type: 'Feature',
      properties: { r: base, gr: base * (2 + 1.6 * b.rate), go: (0.25 + 0.45 * b.rate) * 0.7, c: glowColor(b.rate) },
      geometry: { type: 'Point', coordinates: b.pos },
    };
  }) });
  _on = true;
}

export function pauseDamagePulse() {
  _paused = true;
  if (_raf) cancelAnimationFrame(_raf);
  _raf = null;
}

export function resumeDamagePulse() {
  _paused = false;
  if (state.coloringMode === 'weeklyDamage' && _beats.length) start();
}

/** Chiamata da renderMap a ogni ridisegno: accende il battito in vista
 *  Danni (scaricando il dato se serve), lo spegne fuori. */
export function syncDamagePulse() {
  const map = state.map;
  if (!map?.getLayer('regions-fill')) return;
  const on = state.coloringMode === 'weeklyDamage';
  if (!on) {
    if (_raf) cancelAnimationFrame(_raf);
    _raf = null;
    _beats = [];
    if (_on) { map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: [] }); _on = false; }
    return;
  }
  ensureLayers(map);
  if (!_data || Date.now() - _data.at > TTL_MS) load();
  buildBeats();
  if (_beats.length) start();
}
