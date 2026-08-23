/* ══════════════════════════════════════════════════════════════
   WarEra+ — Heatmap "Intensità bellica storica"
   ------------------------------------------------------------------
   Danno totale accumulato in TUTTE le battaglie risolte, per singola
   regione (stessa granularità di contestedHeatmap.js, stessa proprietà
   `regionId`). Risponde a una domanda diversa da "regioni contese": una
   regione può essere passata di mano una volta sola dopo una battaglia
   enorme, o venti volte con scaramucce da niente.

   Il dato NON è calcolabile dal browser: sta nelle 15.240 battaglie
   risolte che il server di cache ha scaricato una tantum col bootstrap
   (bootstrap-raw-battles.json). Il client si limita a leggere
   /region-history/war-intensity; se il server non è ancora aggiornato
   l'endpoint non esiste e la vista lo dice in chiaro invece di mostrare
   una mappa vuota senza spiegazione (stesso trattamento della riga
   "danno di oggi" in Alliance Overview).

   Limite dichiarato: il poll del bootstrap è disattivato di proposito
   nello scheduler del server, quindi questo totale è fermo alla sua
   istantanea iniziale — è una foto del passato, non un contatore vivo.
   ══════════════════════════════════════════════════════════════ */

import { COLORS } from './config.js';

/** Grigio → ambra → rosso scuro: volutamente diversa sia dalla scala di
 *  "regioni contese" (grigio→rosso acceso) sia dalla battle heatmap live. */
function colorAt(t) {
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(110 + 145 * u);
  const g = Math.round(115 + 55 * (1 - Math.abs(u - 0.5) * 2) - 60 * u);
  const b = Math.round(125 - 115 * u);
  return `rgb(${r},${Math.max(0, g)},${Math.max(0, b)})`;
}

/** Percentile, come in contestedHeatmap.js: fra la regione più martoriata e
 *  la mediana ci sono ordini di grandezza, e qualunque scala proporzionale
 *  (lineare o logaritmica) schiaccia tutto il resto del mondo in una tinta
 *  sola. Col percentile ogni quinto di mappa occupa un quinto della scala. */
function makePercentileScale(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return (v) => {
    if (n <= 1) return 1;
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / (n - 1);
  };
}

export function getWarIntensityStats(intensity) {
  const values = Object.values(intensity || {}).filter(v => v > 0);
  if (!values.length) return { regions: 0, max: 0, total: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    regions: values.length,
    max: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
    total: values.reduce((s, v) => s + v, 0),
  };
}

/**
 * @param {Record<string, number>} intensity {regionId: danno totale storico}
 */
export function buildWarIntensityColorExpression(intensity) {
  const entries = Object.entries(intensity || {}).filter(([, v]) => v > 0);
  if (!entries.length) return COLORS.DEFAULT_LAND;
  const scale = makePercentileScale(entries.map(([, v]) => v));

  const expr = ['match', ['get', 'regionId']];
  for (const [regionId, dmg] of entries) expr.push(regionId, colorAt(scale(dmg)));
  expr.push(COLORS.DEFAULT_LAND);   // mai stata teatro di battaglie risolte
  return expr;
}

export function warIntensityLegendGradient() {
  const stops = [0, 0.25, 0.5, 0.75, 1].map(colorAt);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
