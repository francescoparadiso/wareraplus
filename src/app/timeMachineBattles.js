/* ══════════════════════════════════════════════════════════════
   WarEra+ — Le battaglie del giorno come frecce nella time machine
   ------------------------------------------------------------------
   Richiesta dell'utente: per ogni battaglia aperta quel giorno, una
   freccia dall'attaccante alla regione, spessa quanto il danno. Finora le
   battaglie del giorno (server/dayHistory.js) stavano solo nell'elenco
   sotto la classifica del territorio.

   Dati: la stessa giornata storica che timeMachineDay.js scarica già
   (una richiesta per giorno fermato, nessuna per fotogramma). La regione
   la aggiunge il server in lettura, cercando l'id della battaglia
   nell'archivio delle battaglie concluse e in quelle in corso: c'è per
   tutto da luglio 2026 (i 90 giorni dell'archivio), non per i giorni
   importati prima — lì niente frecce, e non è un "nessuna battaglia".

   ── Lo spessore ────────────────────────────────────────────────
   Il danno c'è solo nei giorni scattati da noi (dal 19 settembre 2026).
   Prima, le righe importate portano la POTENZA dei due schieramenti, che
   non è danno ma dice lo stesso quale battaglia pesava di più; senza
   neanche quella, tutte uguali. Lo spessore è sempre relativo alle
   battaglie DELLO STESSO giorno, quindi le tre misure non si mescolano.

   ── Da dove parte ──────────────────────────────────────────────
   Dalla capitale dell'attaccante QUEL giorno (stessa regola degli archi
   delle guerre, timeMachineLinks.js: la capitale originaria se ancora
   sua, altrimenti la sua regione più vicina). L'attaccante arriva come
   codice ISO: lo si risolve con state.nationByCode.

   Animazione: trattini che scorrono verso la regione (come nelle
   battaglie della mappa principale) e un anello fermo sulla regione.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { arc } from '../diplomacy/flowGeometry.js';
import { getTimeMachineMap, TM_LYR_FILL } from './timeMachineMap.js';
import { animationsOn } from '../shared/motion.js';

const SRC = 'wp-tm-battles-src';
const LYR_BASE = 'wp-tm-battles-base';
const LYR_DASH = 'wp-tm-battles-dash';
const LYR_TARGET = 'wp-tm-battles-target';
const COLOR = '#ff7b39';
const MIN_ARC_DEG = 0.8;

const DASH_SEQ = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];
const DASH_STEP_MS = 60;

let _raf = null;
let _step = -1;
let _has = false;

const posOf = id => {
  const p = state.regionData?.[id]?.position;
  return Array.isArray(p) ? p : null;
};

let _capsFrom = null;
let _caps = null;
function capitalRegion(countryId) {
  if (_capsFrom !== state.regionData) {
    _capsFrom = state.regionData;
    _caps = new Map();
    for (const r of Object.values(state.regionData || {})) if (r?.isCapital && r.initialCountry) _caps.set(r.initialCountry, r._id);
  }
  return _caps.get(countryId) || null;
}

function anchorAt(countryId, regionsMap, owned) {
  const capId = capitalRegion(countryId);
  if (capId && regionsMap[capId] === countryId) return posOf(capId);
  const list = owned.get(countryId);
  if (!list?.length) return null;
  const cap = capId ? posOf(capId) : null;
  if (!cap) return posOf(list[0]);
  let best = null, bestD = Infinity;
  for (const id of list) {
    const p = posOf(id);
    if (!p) continue;
    const d = (p[0] - cap[0]) ** 2 + (p[1] - cap[1]) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function ensureLayers(map) {
  if (map.getSource(SRC)) return true;
  if (!map.getLayer(TM_LYR_FILL)) return false;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const width = ['+', 1.2, ['*', 4.5, ['get', 'w']]];
  map.addLayer({
    id: LYR_BASE, type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': COLOR, 'line-width': width, 'line-opacity': 0.22 },
  });
  map.addLayer({
    id: LYR_DASH, type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': COLOR, 'line-width': width, 'line-opacity': 0.9, 'line-dasharray': DASH_SEQ[0] },
  });
  map.addLayer({
    id: LYR_TARGET, type: 'circle', source: SRC, filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['+', 4, ['*', 5, ['get', 'w']]],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': COLOR,
      'circle-stroke-width': 2,
    },
  });
  return true;
}

function tick(now) {
  _raf = null;
  const map = getTimeMachineMap();
  if (!_has || !state.timeMachineActive || !map?.getLayer(LYR_DASH) || !animationsOn()) return;
  const step = Math.floor(now / DASH_STEP_MS) % DASH_SEQ.length;
  if (step !== _step) {
    _step = step;
    map.setPaintProperty(LYR_DASH, 'line-dasharray', DASH_SEQ[step]);
  }
  _raf = requestAnimationFrame(tick);
}

/**
 * `battles`: le righe del giorno (timeMachineDay.js, con `regionId`);
 * null = nessun dato per quel giorno → via le frecce. `regionsMap`: chi
 * possiede cosa nel fotogramma corrente.
 */
export function setTimeMachineBattles(battles, regionsMap) {
  const map = getTimeMachineMap();
  if (!map) return;
  if (!battles?.length || !regionsMap) { clearTimeMachineBattles(); return; }
  if (!ensureLayers(map)) return;
  const owned = new Map();
  for (const [rid, cid] of Object.entries(regionsMap)) {
    if (!owned.has(cid)) owned.set(cid, []);
    owned.get(cid).push(rid);
  }
  const weightOf = b => {
    const dmg = (b.attackerDamage || 0) + (b.defenderDamage || 0);
    if (dmg > 0) return dmg;
    const pow = (b.attackerPower || 0) + (b.defenderPower || 0);
    return pow > 0 ? pow : 1;
  };
  const rows = battles
    .filter(b => b.regionId && b.attackerCode)
    .map(b => ({ b, v: weightOf(b) }));
  const maxV = Math.max(1, ...rows.map(r => r.v));
  const feats = [];
  for (const { b, v } of rows) {
    const to = posOf(b.regionId);
    const atk = state.nationByCode?.get(String(b.attackerCode).toUpperCase());
    if (!to || !atk) continue;
    const w = Math.sqrt(v / maxV);
    const from = anchorAt(atk._id, regionsMap, owned);
    if (from && Math.hypot(from[0] - to[0], from[1] - to[1]) >= MIN_ARC_DEG) {
      feats.push({ type: 'Feature', properties: { w }, geometry: { type: 'LineString', coordinates: arc(from, to).coords } });
    }
    feats.push({ type: 'Feature', properties: { w }, geometry: { type: 'Point', coordinates: to } });
  }
  map.getSource(SRC).setData({ type: 'FeatureCollection', features: feats });
  _has = feats.length > 0;
  if (_has && !_raf && animationsOn()) _raf = requestAnimationFrame(tick);
}

export function clearTimeMachineBattles() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = null;
  _has = false;
  getTimeMachineMap()?.getSource(SRC)?.setData({ type: 'FeatureCollection', features: [] });
}

// Riaccese dalle Impostazioni (vedi timeMachineLinks.js).
window.addEventListener('wareraplus:motionchange', () => {
  if (animationsOn() && _has && !_raf) _raf = requestAnimationFrame(tick);
});
