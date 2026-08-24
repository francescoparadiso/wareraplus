/* ══════════════════════════════════════════════════════════════
   WarEra+ — Variazione nel tempo di "Guerra vs Eco"
   ------------------------------------------------------------------
   La vista "Guerra vs Eco" dice com'è FATTA una nazione adesso. Questa
   dice come sta CAMBIANDO: chi si sta convertendo alla guerra e chi
   all'economia negli ultimi sette giorni.

   Serve perché le due domande hanno risposte diverse. Una nazione può
   essere fortemente economica in assoluto e insieme la più veloce del
   mondo a riarmarsi; sulla mappa dello stato attuale resta verde, e la
   conversione non si vede. Al contrario una nazione storicamente
   guerrafondaia può essere ferma da settimane.

   Fonte: /mu-playstyle-history del server di cache (già esistente, usato
   dal pannello nazione per il movimento a 24 ore). Ogni riga è
   [ts, war, eco, mixed, undecided, known]: il server aggiunge un campione
   solo quando i conteggi di quella nazione cambiano, con 30 giorni di
   retention. Nessun nuovo endpoint, quindi nessun deploy del server.

   L'estremo destro del confronto è SEMPRE adesso; quello sinistro lo
   sposta lo slider del riepilogo, da ieri a una settimana fa. Lo storico
   scaricato copre già sette giorni, quindi muovere lo slider non costa
   nessuna richiesta: si ri-affetta lo stesso array in memoria.

   COME SI CALCOLA (la stessa spiegazione compare nel pannello):
     1. per ogni nazione si prende l'ULTIMO campione precedente al giorno
        scelto — cioè com'era quel giorno — e quello più recente;
     2. di entrambi si calcola l'equilibrio (guerra − economia) / noti,
        che va da −1 (tutta economia) a +1 (tutta guerra);
     3. la variazione è la differenza fra i due equilibri, in punti;
     4. il colore è la POSIZIONE PERCENTILE di quella variazione dentro
        il proprio verso — chi si muove verso la guerra confrontato con
        gli altri che si muovono verso la guerra — attenuata dalla
        confidenza del campione, esattamente come nella vista dello stato
        attuale (playstyleHeatmap.js). Una nazione con 8 classificati non
        può quindi finire in cima alla scala per il movimento di due
        persone.

   Limite dichiarato in legenda: lo storico è quello che il server ha in
   casa. Se è più corto dei giorni chiesti (server riavviato di recente),
   il confronto parte dal campione più vecchio disponibile — copre meno
   giorni, e il riepilogo lo dice nella riga "giorni coperti".
   ══════════════════════════════════════════════════════════════ */

import { COLORS } from './config.js';
import { getBalanceColor } from './playstyleHeatmap.js';

export const TREND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Sotto questo numero di classificati, a un capo o all'altro della
 *  finestra, la variazione non è misurabile: due persone su cinque fanno
 *  40 punti da sole. */
export const MIN_TREND_SAMPLE = 5;

/** Stessa k dello shrinkage della vista "stato attuale": è la scala di
 *  campione alla quale una nazione "si merita" metà del proprio valore. */
const K = 25;

function median(values) {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function balanceOf(war, eco, known) {
  return known > 0 ? (war - eco) / known : 0;
}

/**
 * @param {Record<string, Array<number[]>>} historyByCountry {countryId: [[ts,war,eco,mixed,undecided,known], ...]}
 * @param {Record<string, {war:number,eco:number,mixed:number}>} [nowByCountry] fotografia attuale, usata come
 *        estremo recente quando è più fresca dell'ultimo campione storico
 * @returns {{rows:Array, spanMs:number, get:(id:string)=>object|null}}
 */
export function buildTrendScale(historyByCountry, nowByCountry, days = 7) {
  const rows = [];
  let oldestTs = Infinity, newestTs = 0;

  // Il confronto parte SEMPRE da oggi e guarda indietro di `days`: lo
  // slider del pannello sposta solo questo estremo. Lo storico scaricato
  // è già di sette giorni, quindi cambiare giorno non costa una fetch.
  const cutoff = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;

  for (const [countryId, series] of Object.entries(historyByCountry || {})) {
    if (!Array.isArray(series) || series.length < 2) continue;
    // Campione di riferimento: l'ULTIMO precedente al taglio, cioè lo stato
    // del paese quel giorno lì. Se la serie comincia dopo (storico più
    // corto dei giorni chiesti) si usa il più vecchio che c'è, e la riga
    // "giorni coperti" nel riepilogo dice quanto vale davvero il confronto.
    let first = series[0];
    for (const row of series) {
      if (row[0] <= cutoff) first = row;
      else break;
    }
    const last = series[series.length - 1];

    const knownThen = first[5] || 0;
    let war = last[1], eco = last[2], knownNow = last[5] || 0;

    // La fotografia corrente arriva da /mu-playstyle-by-country, che il
    // server aggiorna ad ogni giro: se è più recente dell'ultimo campione
    // storico, è lei l'estremo destro della finestra.
    const now = nowByCountry?.[countryId];
    if (now) {
      const k = (now.war || 0) + (now.eco || 0) + (now.mixed || 0);
      if (k >= knownNow) { war = now.war || 0; eco = now.eco || 0; knownNow = k; }
    }

    if (knownThen < MIN_TREND_SAMPLE || knownNow < MIN_TREND_SAMPLE) continue;

    const balThen = balanceOf(first[1], first[2], knownThen);
    const balNow = balanceOf(war, eco, knownNow);
    const delta = balNow - balThen;

    oldestTs = Math.min(oldestTs, first[0]);
    newestTs = Math.max(newestTs, last[0]);

    rows.push({
      countryId,
      delta,                    // in punti di equilibrio, da −2 a +2
      balThen, balNow,
      knownThen, knownNow,
      warThen: first[1], ecoThen: first[2],
      warNow: war, ecoNow: eco,
      fromTs: first[0], toTs: last[0],
    });
  }

  // Percentile dentro il proprio verso: come nella vista dello stato
  // attuale, dividere per una deviazione lascerebbe quasi tutti incollati
  // ai due estremi (le variazioni vere sono poche e grosse, il resto del
  // mondo è fermo).
  const up = rows.filter(r => r.delta > 0).map(r => r.delta).sort((a, b) => a - b);
  const down = rows.filter(r => r.delta < 0).map(r => -r.delta).sort((a, b) => a - b);
  const rank = (sorted, v) => {
    if (sorted.length <= 1) return 1;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / (sorted.length - 1);
  };

  rows.forEach(r => {
    const base = r.delta > 0 ? rank(up, r.delta) : (r.delta < 0 ? -rank(down, -r.delta) : 0);
    // Confidenza sul capo PIÙ DEBOLE della finestra: una variazione vale
    // quanto il più piccolo dei due campioni su cui è misurata.
    const n = Math.min(r.knownThen, r.knownNow);
    r.confidence = n / (n + K);
    r.z = base * (0.5 + 0.5 * r.confidence);
  });

  return {
    rows,
    days,
    spanMs: newestTs > 0 && oldestTs < Infinity ? newestTs - oldestTs : 0,
    medianSample: median(rows.map(r => r.knownNow)),
    get: (id) => rows.find(r => r.countryId === id) || null,
  };
}

/** Stessa tavolozza della vista "stato attuale" (rosso guerra ↔ verde
 *  economia, grigio al centro): qui il centro non è "in equilibrio" ma
 *  "fermo", e il verso resta lo stesso — rosso vuol dire guerra in
 *  entrambe le viste. */
export const getTrendColor = getBalanceColor;

export function buildPlaystyleTrendColorExpression(trend, isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const rows = trend?.rows || [];
  if (!rows.length) return COLORS.DEFAULT_LAND;

  const expr = ['match', ['get', prop]];
  for (const r of rows) expr.push(r.countryId, getTrendColor(r.z));
  expr.push(COLORS.DEFAULT_LAND);   // storico assente o campione troppo piccolo
  return expr;
}

/** Numeri per legenda e riepilogo. La soglia di 2 punti separa il rumore
 *  (una persona che cambia in un campione da 50) da un movimento vero. */
export function getTrendStats(trend) {
  // `days` è quanto è stato CHIESTO, `spanDays` quanto lo storico copre
  // davvero: quando il secondo è più piccolo, il riepilogo mostra quello.
  const rows = trend?.rows || [];
  let toWar = 0, toEco = 0, still = 0;
  for (const r of rows) {
    if (r.delta > 0.02) toWar++;
    else if (r.delta < -0.02) toEco++;
    else still++;
  }
  return {
    covered: rows.length,
    toWar, toEco, still,
    spanDays: trend?.spanMs ? Math.max(1, Math.round(trend.spanMs / 86400000)) : 0,
  };
}

export function trendLegendGradient() {
  const stops = [-1, -0.5, 0, 0.5, 1].map(getTrendColor);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
