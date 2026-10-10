/* ══════════════════════════════════════════════════════════════
   WarEra+ — Frecce del danno quando si apre una battaglia
   ------------------------------------------------------------------
   Richiesta dell'utente, dopo le frecce della vista Migrazioni:
   cliccando una battaglia, frecce animate che vanno da ogni nazione
   verso la regione contesa, proporzionali alla sua quota di danno. Con
   un'animazione DIVERSA dalle comete delle migrazioni.

   Zero fetch: chi ha combattuto e quanto lo sa già la heatmap della
   battaglia (battleHeatmap.js → state.battleHeatmapData, rinfrescato
   ogni 10 s con la battaglia aperta). Le frecce partono dalle stesse
   nazioni che la heatmap colora — `highlightedIds`, almeno l'1% del
   danno del proprio lato — così mappa, nomi e frecce dicono la stessa
   cosa. Il punto di partenza è la capitale (flowGeometry.js), quello
   d'arrivo la `position` della regione (state.regionData).

   ── QUALE PERCENTUALE ──────────────────────────────────────────
   Due misure diverse, ognuna dove serve:
     · lo SPESSORE segue il danno vero (√ danno / danno del primo), così
       le frecce dei due lati si confrontano fra loro: sulla quota di
       lato, l'unico difensore di una battaglia a senso unico farebbe
       100% e sembrerebbe pesare quanto tutto l'attacco;
     · il NUMERO è la quota sul proprio lato, lo stesso che le etichette
       della heatmap scrivono sulla nazione (labels.js) e la legenda
       («Share = nation damage / side total»). Con la quota sul totale
       la stessa nazione mostrava due percentuali diverse a un dito di
       distanza.
   La legenda dice tutte e due le cose.

   ── ANIMAZIONE ─────────────────────────────────────────────────
   Niente comete (quelle sono delle migrazioni). Qui il danno SCORRE:
     · ogni arco è una linea a trattini che avanzano verso la regione
       (line-dasharray ciclata a ogni passo: si cambia una proprietà di
       stile, nessuna setData sulle frecce);
     · sulla regione si allargano onde d'impatto, tre anelli sfasati
       nella tinta di chi sta facendo più danno in quel momento.
   Arco sollevato con l'ombra a terra sotto, come nelle migrazioni: è
   quello che l'utente ha chiamato "il 3D". Fermo con la scheda
   nascosta, la time machine e gli overlay (mapIdle.js).
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { countryAnchor, arc } from './flowGeometry.js';

// Le stesse due famiglie della heatmap e della sua legenda (ui.js):
// attaccanti blu, difensori rossi.
export const ATTACKER_COLOR = '#4d8dff';
export const DEFENDER_COLOR = '#ff4d4d';
const MAX_ARROWS = 24;
// Sotto questa distanza (gradi) la capitale è praticamente sulla regione
// contesa — la classica nazione che si difende in casa: niente arco, solo
// il numero sul suo pallino.
const MIN_ARC_DEG = 1.2;

const SRC = 'wp-bflow-src';
const SRC_FX = 'wp-bflow-fx-src';
const LYR_GROUND = 'wp-bflow-ground';
const LYR_BASE = 'wp-bflow-base';
const LYR_DASH = 'wp-bflow-dash';
const LYR_ORIGIN = 'wp-bflow-origin';
const LYR_RING = 'wp-bflow-ring';
const LYR_TARGET = 'wp-bflow-target';
const LYR_BADGE = 'wp-bflow-badge';
const LYR_BADGE_TXT = 'wp-bflow-badge-txt';

function regionPosition(d) {
  const id = d?.regionId;
  if (!id) return null;
  const p = state.regionData?.[id]?.position || state.regionCache?.get(id)?.position;
  return Array.isArray(p) ? p : null;
}

function fmtShare(s) {
  const pct = s * 100;
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

// Chi sta facendo più danno: decide la tinta delle onde d'impatto.
let _leader = 'attacker';

function overlayFeatures() {
  const d = state.battleHeatmapData;
  if (!d?.nations?.length) return [];
  const target = regionPosition(d);
  if (!target) return [];
  let total = 0, atk = 0;
  for (const n of d.nations) {
    total += n.totalDamage;
    if (n.side === 'attacker') atk += n.totalDamage;
  }
  if (!total) return [];
  const sideTotal = { attacker: atk, defender: total - atk };
  _leader = atk >= total - atk ? 'attacker' : 'defender';

  const hi = d.highlightedIds;
  // `nations` arriva già ordinato per danno decrescente (buildNationRanking).
  const rows = d.nations.filter(n => n.totalDamage > 0 && (!hi || hi.has(n.countryId))).slice(0, MAX_ARROWS);
  const maxDmg = rows.length ? rows[0].totalDamage : 1;
  const feats = [];
  for (const r of rows) {
    const from = countryAnchor(r.countryId);
    if (!from) continue;
    const w = Math.sqrt(r.totalDamage / maxDmg);
    const props = { side: r.side, w, label: fmtShare(r.totalDamage / (sideTotal[r.side] || total)) };
    if (Math.hypot(from[0] - target[0], from[1] - target[1]) < MIN_ARC_DEG) {
      feats.push({ type: 'Feature', properties: { ...props, role: 'badge' }, geometry: { type: 'Point', coordinates: from } });
      continue;
    }
    const { coords, mid } = arc(from, target);
    feats.push({ type: 'Feature', properties: { ...props, role: 'ground' }, geometry: { type: 'LineString', coordinates: [from, target] } });
    feats.push({ type: 'Feature', properties: { ...props, role: 'arc' }, geometry: { type: 'LineString', coordinates: coords } });
    feats.push({ type: 'Feature', properties: { ...props, role: 'origin' }, geometry: { type: 'Point', coordinates: from } });
    feats.push({ type: 'Feature', properties: { ...props, role: 'badge' }, geometry: { type: 'Point', coordinates: mid } });
  }
  if (feats.length) feats.push({ type: 'Feature', properties: { role: 'target' }, geometry: { type: 'Point', coordinates: target } });
  return feats;
}

function ensureLayers(map) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource(SRC_FX, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const sideColor = ['match', ['get', 'side'], 'attacker', ATTACKER_COLOR, DEFENDER_COLOR];
  const role = r => ['==', ['get', 'role'], r];
  const width = (lo, hi) => ['interpolate', ['linear'], ['zoom'],
    1, ['+', lo, ['*', hi, ['get', 'w']]],
    5, ['+', lo * 1.8, ['*', hi * 1.8, ['get', 'w']]]];
  map.addLayer({
    id: LYR_GROUND, type: 'line', source: SRC, filter: role('ground'),
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#000000', 'line-width': width(1.5, 3), 'line-blur': 2.5, 'line-opacity': 0.3 },
  });
  // Sotto, la linea piena e tenue: dice dove va la freccia anche fra un
  // trattino e l'altro. Sopra, i trattini che scorrono.
  map.addLayer({
    id: LYR_BASE, type: 'line', source: SRC, filter: role('arc'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': sideColor, 'line-width': width(1.5, 6), 'line-opacity': 0.28 },
  });
  map.addLayer({
    id: LYR_DASH, type: 'line', source: SRC, filter: role('arc'),
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': sideColor, 'line-width': width(1.5, 6), 'line-opacity': 0.95, 'line-dasharray': DASH_SEQ[0] },
  });
  map.addLayer({
    id: LYR_ORIGIN, type: 'circle', source: SRC, filter: role('origin'),
    paint: { 'circle-radius': 4, 'circle-color': sideColor, 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 1.5 },
  });
  map.addLayer({
    id: LYR_RING, type: 'circle', source: SRC_FX,
    paint: {
      'circle-radius': ['get', 'r'],
      'circle-color': ['get', 'c'],
      'circle-opacity': ['*', ['get', 'o'], 0.12],
      'circle-stroke-color': ['get', 'c'],
      'circle-stroke-width': 2.5,
      'circle-stroke-opacity': ['get', 'o'],
    },
  });
  map.addLayer({
    id: LYR_TARGET, type: 'circle', source: SRC, filter: role('target'),
    paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 2.5 },
  });
  map.addLayer({
    id: LYR_BADGE, type: 'circle', source: SRC, filter: role('badge'),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'w'], 0, 11, 1, 15],
      'circle-color': sideColor,
      'circle-stroke-color': '#0b1c33',
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: LYR_BADGE_TXT, type: 'symbol', source: SRC, filter: role('badge'),
    layout: {
      // Solo font che fonts.openmaptiles.org ha davvero: vedi migrationFlows.js.
      'text-field': ['get', 'label'], 'text-size': 10.5, 'text-font': ['Open Sans Bold'],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#0b1c33', 'text-halo-width': 0.6 },
  });
}

/* ── Animazione ──
   La sequenza di line-dasharray è quella classica della "ant path": 14
   passi di mezzo trattino ciascuno, e ogni passo sposta il disegno verso
   la FINE della linea — qui la regione, perché gli archi partono dalla
   capitale. Misurato sul disegno: [0,4,3] → [0.5,4,2.5] sposta il
   trattino da [4,7) a [4.5,7.5). */
const DASH_SEQ = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];
const FX_FRAME_MS = 33;
const DASH_STEP_MS = 55;
const RING_PERIOD_MS = 1800;
const RINGS = 3;
let _raf = null;
let _last = 0;
let _dashStep = -1;
let _paused = false;
let _target = null;
let _fxOn = false;

function setFx(features) {
  const src = state.map?.getSource(SRC_FX);
  if (src) src.setData({ type: 'FeatureCollection', features });
  _fxOn = features.length > 0;
}

function tick(now) {
  _raf = null;
  const map = state.map;
  if (_paused || state.timeMachineActive || state.coloringMode !== 'battleHeatmap' || !_target || !map?.getLayer(LYR_DASH)) {
    if (_fxOn) setFx([]);
    return;
  }
  if (now - _last >= FX_FRAME_MS) {
    _last = now;
    const step = Math.floor(now / DASH_STEP_MS) % DASH_SEQ.length;
    if (step !== _dashStep) {
      _dashStep = step;
      map.setPaintProperty(LYR_DASH, 'line-dasharray', DASH_SEQ[step]);
    }
    const color = _leader === 'attacker' ? ATTACKER_COLOR : DEFENDER_COLOR;
    const rings = [];
    for (let i = 0; i < RINGS; i++) {
      const t = (now / RING_PERIOD_MS + i / RINGS) % 1;
      rings.push({
        type: 'Feature',
        properties: { r: 7 + 38 * t, o: 0.85 * (1 - t) * (1 - t), c: color },
        geometry: { type: 'Point', coordinates: _target },
      });
    }
    setFx(rings);
  }
  _raf = requestAnimationFrame(tick);
}

function start() {
  if (_raf || _paused) return;
  _raf = requestAnimationFrame(tick);
}

function stop() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = null;
  if (_fxOn) setFx([]);
}

/** Overlay a tutto schermo aperto sopra la mappa (src/app/mapIdle.js). */
export function pauseBattleFlowFx() {
  _paused = true;
  stop();
}

export function resumeBattleFlowFx() {
  _paused = false;
  if (state.coloringMode === 'battleHeatmap' && _target) start();
}

/** Chiamata da renderMap a ogni ridisegno (anche dal giro live della
 *  heatmap ogni 10 s): accende, aggiorna o spegne le frecce. */
export function syncBattleFlowOverlay() {
  const map = state.map;
  if (!map?.getLayer('regions-fill')) return;
  const on = state.coloringMode === 'battleHeatmap' && !!state.battleHeatmapData;
  if (!on && !map.getSource(SRC)) return;
  if (on) ensureLayers(map);
  const feats = on ? overlayFeatures() : [];
  map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: feats });
  _target = feats.length ? regionPosition(state.battleHeatmapData) : null;
  if (_target) start();
  else stop();
}
