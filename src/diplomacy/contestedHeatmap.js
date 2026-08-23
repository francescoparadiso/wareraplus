/* ══════════════════════════════════════════════════════════════
   WarEra+ — Heatmap "Regioni contese" (volatilità storica)
   ------------------------------------------------------------------
   Quante volte OGNI SINGOLA REGIONE ha cambiato padrone da inizio gioco.
   È la prima heatmap del progetto che NON colora per nazione: le altre
   (population.js, weeklyDamage.js) partono da un numero per paese e
   fanno `['match', ['get','countryId'], ...]`, qui invece regioni della
   stessa nazione possono avere storie completamente diverse — un fronte
   passato di mano quindici volte accanto a un entroterra mai toccato.
   La proprietà giusta è `regionId`, presente nelle feature di
   topoData.objects.regions (verificata sul dato reale, insieme a
   countryId/initialCountryId).

   Il dato di partenza è lo stesso storico che alimenta la time machine
   (eventi {ts, regionId, fromCountry, toCountry}): il conteggio non
   dipende dalla mappa attuale, quindi vale identico in vista "Attuale" e
   "Originale" — nessun ramo isOriginal come nelle heatmap per nazione.
   ══════════════════════════════════════════════════════════════ */

import { COLORS } from './config.js';

/** Grigio neutro → rosso acceso. Scala volutamente diversa da quella di
 *  weeklyDamage (blu→rosso) e della battle heatmap: sono tutte "calde" e
 *  affiancate nella stessa barra delle viste, devono restare distinguibili. */
function colorAt(t) {
  const u = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(120 + 135 * u)},${Math.round(125 - 95 * u)},${Math.round(135 - 105 * u)})`;
}

/** Posizione PERCENTILE invece del rapporto sul massimo. Verificato sul
 *  dato reale: 726 regioni, massimo 42 passaggi, media ~16 — con la scala
 *  proporzionale (anche con radice) quasi tutto il mondo finiva nella metà
 *  rossa e la mappa non distingueva più niente. Col percentile metà mondo
 *  sta sempre sotto la metà della scala, qualunque sia la distribuzione. */
function makePercentileScale(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return (v) => {
    if (n <= 1) return 1;
    // quanti valori sono strettamente minori: ricerca binaria
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / (n - 1);
  };
}

/** Statistiche per la legenda: quante regioni con almeno un passaggio,
 *  massimo e totale dei trasferimenti. */
export function getContestedStats(counts) {
  const values = Object.values(counts || {}).filter(c => c > 0);
  if (!values.length) return { regions: 0, max: 0, total: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    regions: values.length,
    max: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
    total: values.reduce((s, c) => s + c, 0),
  };
}

/**
 * Espressione fill-color per regione.
 * @param {Record<string, number>} counts {regionId: numero di passaggi di mano}
 */
export function buildContestedColorExpression(counts) {
  const entries = Object.entries(counts || {}).filter(([, c]) => c > 0);
  if (!entries.length) return COLORS.DEFAULT_LAND;
  const scale = makePercentileScale(entries.map(([, c]) => c));

  const expr = ['match', ['get', 'regionId']];
  for (const [regionId, count] of entries) expr.push(regionId, colorAt(scale(count)));
  expr.push(COLORS.DEFAULT_LAND);   // mai cambiata padrone: resta neutra
  return expr;
}

/** Classifica delle regioni più contese, colorata con la stessa scala
 *  percentile della mappa (non una tinta inventata per la legenda: la
 *  riga dell'elenco e il territorio hanno lo stesso colore).
 *  @returns {{regionId:string, value:number, color:string}[]} */
export function contestedRankedList(counts, limit = 8) {
  const entries = Object.entries(counts || {}).filter(([, c]) => c > 0);
  if (!entries.length) return [];
  const scale = makePercentileScale(entries.map(([, c]) => c));
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([regionId, value]) => ({ regionId, value, color: colorAt(scale(value)) }));
}

/** Gradiente CSS della legenda, costruito dagli stessi colori della mappa
 *  (non ricopiati a mano: se cambia getContestColor cambia anche qui). */
export function contestedLegendGradient() {
  const stops = [0, 0.25, 0.5, 0.75, 1].map(colorAt);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
