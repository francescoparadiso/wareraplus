/* ══════════════════════════════════════════════════════════════
   WarEra+ — Le elezioni in diretta (vista "Elezioni")
   ------------------------------------------------------------------
   Richiesta dell'utente: durante il voto, la tinta dell'affluenza che si
   scalda man mano, con un piccolo battito ogni volta che il conteggio
   sale.

   Il dato è lo stesso di sempre: /elections?open=1, riletto ogni 3
   minuti a vista accesa (diplomacy/main.js: _loadOpenElections). Prima a
   ogni giro la mappa saltava di colpo al colore nuovo; ora, se i voti di
   un'elezione sono saliti dal giro prima:
     · la tinta passa dal colore vecchio al nuovo in TRANSITION_MS,
       ridipingendo il solo riempimento con un'affluenza interpolata
       (politicsHeatmap.js: buildPoliticsColorExpression con le
       affluenze date) — non tutto renderMap a ogni passo;
     · sulla capitale di quella nazione (flowGeometry.js) due battiti,
       con un'etichetta "+N voti".
   Al primo caricamento non c'è un "prima": niente animazione.

   Con le animazioni spente (Impostazioni, shared/motion.js) il colore
   cambia di colpo come prima, e resta solo l'etichetta.
   ══════════════════════════════════════════════════════════════ */

import maplibregl from 'maplibre-gl';
import { state } from './state.js';
import { countryAnchor } from './flowGeometry.js';
import { buildPoliticsColorExpression, turnoutByCountry, turnoutColor } from './politicsHeatmap.js';
import { animationsOn } from '../shared/motion.js';
import { t } from '../shared/i18n.js';
import { escapeHtml } from './utils.js';

const TRANSITION_MS = 1500;
const BEAT_MS = 1700;
const LABEL_MS = 4000;
const SRC = 'wp-elections-live-src';
const LYR = 'wp-elections-live-beat';

let _raf = null;
let _beats = [];   // { pos, color, start }

const votesOf = e => e?.votesCount || (e?.candidates || []).reduce((s, c) => s + (c.voteCount || 0), 0);

/** Voti saliti per nazione fra due letture: { countryId: delta }. */
function gains(prev, next) {
  const before = new Map();
  for (const list of Object.values(prev || {})) for (const e of list || []) if (e?._id) before.set(e._id, votesOf(e));
  const out = new Map();
  for (const [countryId, list] of Object.entries(next || {})) {
    for (const e of list || []) {
      if (!e?._id || !before.has(e._id)) continue;
      const d = votesOf(e) - before.get(e._id);
      if (d > 0) out.set(countryId, (out.get(countryId) || 0) + d);
    }
  }
  return out;
}

function ensureLayers(map) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: LYR, type: 'circle', source: SRC,
    paint: {
      'circle-radius': ['get', 'r'],
      'circle-color': ['get', 'c'],
      'circle-opacity': ['*', ['get', 'o'], 0.25],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': ['get', 'o'],
    },
  });
}

function showLabel(map, at, text) {
  const el = document.createElement('div');
  el.style.pointerEvents = 'none';
  el.style.zIndex = '2300';
  const inner = document.createElement('div');
  inner.className = 'wp-ping-label';
  inner.style.setProperty('--ping-c', '#e05252');
  inner.innerHTML = escapeHtml(text);
  el.appendChild(inner);
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] }).setLngLat(at).addTo(map);
  setTimeout(() => marker.remove(), LABEL_MS);
}

/**
 * Chiamata da _loadOpenElections dopo una lettura nuova. Ritorna true se
 * si occupa lei di ridipingere (transizione in corso): chi chiama allora
 * NON fa renderMap, altrimenti il colore nuovo arriverebbe di colpo prima
 * della transizione.
 */
export function onElectionsUpdate(prev, next) {
  const map = state.map;
  if (!prev || !next || !map?.getLayer('regions-fill') || state.coloringMode !== 'politics') return false;
  const up = gains(prev, next);
  if (!up.size) return false;

  for (const [countryId, d] of up) {
    const pos = countryAnchor(countryId);
    if (!pos) continue;
    showLabel(map, pos, `🗳️ +${t('vo_votes_n', { n: d.toLocaleString() })} · ${state.nationMap.get(countryId)?.name || ''}`);
    if (animationsOn()) _beats.push({ pos, color: turnoutColor(turnoutByCountry(Date.now(), next).get(countryId)), start: performance.now() });
  }
  if (!animationsOn()) return false;

  // Transizione del colore: affluenza vecchia → nuova, per le sole
  // nazioni salite; le altre hanno già il loro colore definitivo.
  const from = turnoutByCountry(Date.now(), prev);
  const to = turnoutByCountry(Date.now(), next);
  const isOriginal = state.mapSource === 'original';
  const t0 = performance.now();
  ensureLayers(map);
  const step = (now) => {
    _raf = null;
    if (state.coloringMode !== 'politics' || !map.getLayer('regions-fill')) { _beats = []; return; }
    const k = Math.min(1, (now - t0) / TRANSITION_MS);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;   // ease-in-out
    if (k < 1) {
      const mixed = new Map(to);
      for (const id of up.keys()) {
        const a = from.get(id), b = to.get(id);
        if (a != null && b != null) mixed.set(id, a + (b - a) * e);
      }
      map.setPaintProperty('regions-fill', 'fill-color', buildPoliticsColorExpression(isOriginal, mixed));
    }
    // I battiti: due "tu-tum" che si allargano e svaniscono.
    _beats = _beats.filter(b => now - b.start < BEAT_MS);
    const feats = _beats.map(b => {
      const x = (now - b.start) / BEAT_MS;
      const beat = Math.exp(-(((x - 0.12) / 0.07) ** 2)) + 0.7 * Math.exp(-(((x - 0.4) / 0.07) ** 2));
      return { type: 'Feature', properties: { r: 6 + 10 * beat + 14 * x, o: Math.max(0, 1 - x) * (0.4 + 0.6 * beat), c: b.color }, geometry: { type: 'Point', coordinates: b.pos } };
    });
    map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: feats });
    if (k < 1 || _beats.length) _raf = requestAnimationFrame(step);
    else import('./map.js').then(m => m.renderMap());   // fine: il ridisegno vero, colori definitivi
  };
  if (_raf) cancelAnimationFrame(_raf);
  _raf = requestAnimationFrame(step);
  return true;
}
