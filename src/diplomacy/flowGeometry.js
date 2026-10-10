/* ══════════════════════════════════════════════════════════════
   WarEra+ — Geometria delle frecce sulla mappa (condivisa)
   ------------------------------------------------------------------
   Nata dentro migrationFlows.js (vista Migrazioni) e spostata qui quando
   le stesse frecce sono servite al clic su una battaglia (battleFlows.js):
   dove si aggancia una nazione (la capitale) e come si disegna un arco
   che si legga come una traiettoria sollevata. Solo geometria, nessun
   layer e nessuno stato oltre alla cache dei punti di aggancio.
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';

let _anchorsFrom = null;
let _anchorsRegions = null;
let _anchors = new Map();

/** Dove parte e arriva una freccia (richiesta dell'utente: «nella
 *  capitale»), in quest'ordine:
 *   1. la capitale, se la nazione la possiede ancora — `position` della
 *      regione con isCapital, cioè la città vera (state.regionData, già
 *      in memoria, zero fetch);
 *   2. il punto dell'etichetta della nazione, se la capitale è OCCUPATA:
 *      la freccia partirebbe da dentro il paese che l'ha presa, e la si
 *      leggerebbe come sua. Il 10 ott 2026 erano 55 capitali su 180;
 *   3. la capitale originaria per chi non ha più territorio (niente
 *      etichetta): è l'unico posto della mappa che è ancora "suo";
 *   4. il centroide dei marker battaglia. */
export function countryAnchor(id) {
  if (_anchorsFrom !== state.labelsData || _anchorsRegions !== state.regionData) {
    _anchorsFrom = state.labelsData;
    _anchorsRegions = state.regionData;
    const labels = new Map();
    for (const l of state.labelsData || []) {
      const cId = l.properties?.countryId;
      if (cId && Array.isArray(l.coordinates) && !labels.has(cId)) labels.set(cId, l.coordinates);
    }
    const held = new Map(), original = new Map();
    for (const r of Object.values(state.regionData || {})) {
      if (!r?.isCapital || !Array.isArray(r.position)) continue;
      if (r.country && r.country === r.initialCountry) held.set(r.country, r.position);
      if (r.initialCountry) original.set(r.initialCountry, r.position);
    }
    _anchors = new Map(labels);
    for (const [cId, pos] of original) if (!_anchors.has(cId)) _anchors.set(cId, pos);
    for (const [cId, pos] of held) _anchors.set(cId, pos);
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
export function arc(a, b, steps = 28) {
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

// Mercatore dritto da a a b: l'ombra "a terra" di un punto che vola sull'arco.
export function groundAt(a, b, t) {
  const ay = toY(a[1]), by = toY(b[1]);
  return [a[0] + (b[0] - a[0]) * t, toLat(ay + (by - ay) * t)];
}

/** Punto a frazione t (0–1) lungo una polilinea a passi uniformi. */
export function alongArc(coords, t) {
  const f = Math.max(0, Math.min(1, t)) * (coords.length - 1);
  const i = Math.min(coords.length - 2, Math.floor(f));
  const k = f - i;
  const p = coords[i], q = coords[i + 1];
  return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
}
