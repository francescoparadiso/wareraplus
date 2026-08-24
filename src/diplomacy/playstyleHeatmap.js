/* ══════════════════════════════════════════════════════════════
   WarEra+ — Heatmap "Guerra vs Eco" (guerrafondaie vs economiche)
   ------------------------------------------------------------------
   Torna alla granularità PER NAZIONE (match su countryId /
   initialCountryId, come population.js): il dato è un aggregato di
   paese, non ha un valore per regione.

   Fonte: /mu-playstyle-by-country del server di cache, già esistente e
   già usato dal pannello nazione e da Statistiche alleanze — nessuna
   nuova chiamata, nessun deploy necessario. Il campione sono i cittadini
   che militano in una unità militare: è l'unico insieme di utenti di cui
   si conoscano le skill (l'API non espone gli skill nell'elenco
   cittadini di un paese — verificato: user.getUsersByCountry ritorna
   solo _id e createdAt). Il limite è dichiarato in legenda invece di
   essere nascosto: nazioni con pochi membri MU noti hanno una barra
   fragile, e sotto MIN_SAMPLE non vengono colorate affatto.

   NB: "eco" qui vuol dire BUILD ECONOMICA del giocatore (punti abilità
   spesi in produzione), non commercio/mercato — da cui il nome della vista,
   corretto da "Guerra vs Commercio" a "Guerra vs Eco".

   Scala BIPOLARE (rosso guerra ↔ verde economia) invece che sequenziale:
   qui lo zero non è "poco", è "in equilibrio".
   ══════════════════════════════════════════════════════════════ */

import { COLORS } from './config.js';

/** Sotto questa soglia non si colora affatto: con uno o due classificati non
 *  c'è niente da dire. Sopra, ci pensa lo shrinkage (vedi buildPlaystyleScale)
 *  a togliere peso ai campioni piccoli, quindi la soglia può stare bassa —
 *  era 5 quando la percentuale grezza finiva dritta sulla mappa. */
export const MIN_SAMPLE = 3;

/** -1 = tutta economia, 0 = equilibrio, +1 = tutta guerra. `mixed` conta
 *  come metà da entrambe le parti: sono build ibride vere, non un errore. */
export function playstyleBalance(entry) {
  if (!entry) return null;
  const war = entry.war || 0, eco = entry.eco || 0, mixed = entry.mixed || 0;
  const known = war + eco + mixed;
  if (known < MIN_SAMPLE) return null;
  return ((war + mixed / 2) - (eco + mixed / 2)) / known;
}

/* ── Scala della vista ────────────────────────────────────────────────
   Prima la mappa mostrava la percentuale GREZZA, e aveva due difetti
   opposti, segnalati dal vivo:

   · una nazione con 8 giocatori tutti eco finiva a −100%, cioè al fondo
     della scala, e si prendeva la stessa intensità di un paese con 400
     giocatori — una manciata di persone stravolgeva la mappa;
   · una nazione grande che si converte davvero alla guerra sposta la sua
     percentuale di pochi punti, quindi il cambiamento non si vedeva.

   Due correzioni, entrambe standard e indipendenti:

   1. SHRINKAGE verso la media mondiale (empirical Bayes): la stima di un
      paese vale quanto pesa il suo campione, `(n·raw + k·mondo)/(n + k)`,
      con k = mediana dei campioni. Con n piccolo il valore scivola verso
      la media mondiale (niente estremi da 8 persone), con n grande resta
      praticamente il suo.
   2. Colore per DISTANZA DALLA MEDIA MONDIALE, non per valore assoluto,
      normalizzata sulla dispersione reale (deviazione mediana assoluta,
      robusta alle code): ±1 della scala = due deviazioni. Così "più
      guerrafondaia della media" è leggibile anche quando lo scarto
      assoluto è di pochi punti percentuali — che è esattamente il caso
      delle nazioni grandi.
   ─────────────────────────────────────────────────────────────────── */

function median(values) {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * @param {Record<string, {war:number,eco:number,mixed:number}>} byCountry
 * @returns {{world:number, k:number, spread:number, get:(id:string)=>({raw:number,shrunk:number,z:number,known:number}|null), all:Array}}
 */
export function buildPlaystyleScale(byCountry) {
  const rows = [];
  let sumDiff = 0, sumKnown = 0;
  for (const [countryId, entry] of Object.entries(byCountry || {})) {
    const war = entry?.war || 0, eco = entry?.eco || 0, mixed = entry?.mixed || 0;
    const known = war + eco + mixed;
    if (known < MIN_SAMPLE) continue;
    // `mixed` conta metà per parte: si annulla, ma resta nel denominatore —
    // una nazione tutta ibrida è in equilibrio, non "senza dati".
    rows.push({ countryId, known, raw: (war - eco) / known });
    sumDiff += war - eco;
    sumKnown += known;
  }
  const world = sumKnown ? sumDiff / sumKnown : 0;
  // k = quanto campione serve per "meritarsi" metà del proprio valore.
  // La mediana dei campioni è la scelta naturale: chi sta sopra la mediana
  // pesa più della media mondiale, chi sta sotto pesa meno.
  const k = Math.max(5, Math.min(60, median(rows.map(r => r.known)) || 10));

  rows.forEach(r => { r.shrunk = (r.known * r.raw + k * world) / (r.known + k); });

  // Dispersione robusta, tenuta solo come informazione per la legenda: con
  // la deviazione standard bastano due code per gonfiarla e appiattire
  // tutto il resto.
  const devs = rows.map(r => Math.abs(r.shrunk - world));
  const spread = Math.max(0.04, 1.4826 * median(devs));

  // Posizione PERCENTILE dentro il proprio verso (più guerrafondaie della
  // media da una parte, più economiche dall'altra), non rapporto sulla
  // dispersione: dividendo per una sigma la maggior parte delle nazioni
  // finiva incollata ai due estremi della scala — misurato, 9 su 10 fra
  // le prime e le ultime erano tutte a ±1, cioè indistinguibili fra loro.
  // Col percentile ogni quinto di nazioni occupa un quinto di scala.
  const pos = rows.filter(r => r.shrunk - world > 0).map(r => r.shrunk - world).sort((a, b) => a - b);
  const neg = rows.filter(r => r.shrunk - world < 0).map(r => world - r.shrunk).sort((a, b) => a - b);
  const rank = (sorted, v) => {
    if (sorted.length <= 1) return 1;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / (sorted.length - 1);
  };

  rows.forEach(r => {
    const d = r.shrunk - world;
    const base = d > 0 ? rank(pos, d) : (d < 0 ? -rank(neg, -d) : 0);
    // Confidenza del campione: una nazione con 8 classificati non può
    // arrivare in fondo alla scala nemmeno se sono tutti guerra. Il peso è
    // lo stesso dello shrinkage (n/(n+k)), riportato in [0.5, 1] — il
    // campione piccolo perde intensità, non il segno.
    const confidence = r.known / (r.known + k);
    r.confidence = confidence;
    r.z = base * (0.5 + 0.5 * confidence);
  });

  const index = new Map(rows.map(r => [r.countryId, r]));
  return { world, k, spread, all: rows, get: (id) => index.get(id) || null };
}

export function getBalanceColor(balance) {
  const t = Math.max(-1, Math.min(1, balance));
  if (t >= 0) {
    // equilibrio (grigio caldo) → rosso guerra
    return `rgb(${Math.round(150 + 90 * t)},${Math.round(145 - 100 * t)},${Math.round(140 - 105 * t)})`;
  }
  // equilibrio → verde economia
  const u = -t;
  return `rgb(${Math.round(150 - 105 * u)},${Math.round(145 + 50 * u)},${Math.round(140 - 60 * u)})`;
}

/**
 * @param {Record<string, {war:number,eco:number,mixed:number,undecided:number,known:number,total:number}>} byCountry
 * @param {boolean} isOriginal usa initialCountryId invece di countryId
 */
export function buildPlaystyleColorExpression(byCountry, isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const scale = buildPlaystyleScale(byCountry);
  if (!scale.all.length) return COLORS.DEFAULT_LAND;

  const expr = ['match', ['get', prop]];
  for (const r of scale.all) expr.push(r.countryId, getBalanceColor(r.z));
  expr.push(COLORS.DEFAULT_LAND);   // campione troppo piccolo o nessun dato
  return expr;
}

/** Quante nazioni sono state effettivamente colorate e come si dividono —
 *  serve alla legenda per dire quanto è coperto il mondo. */
export function getPlaystyleStats(byCountry) {
  const scale = buildPlaystyleScale(byCountry);
  const total = Object.keys(byCountry || {}).length;
  let warLeaning = 0, ecoLeaning = 0, balanced = 0;
  for (const r of scale.all) {
    // Le soglie sono sulla scala relativa: "pende" vuol dire mezza
    // deviazione oltre la media mondiale, non una percentuale assoluta.
    if (r.z > 0.25) warLeaning++;
    else if (r.z < -0.25) ecoLeaning++;
    else balanced++;
  }
  return {
    colored: scale.all.length,
    warLeaning, ecoLeaning, balanced,
    skipped: Math.max(0, total - scale.all.length),
    world: scale.world,
    spread: scale.spread,
  };
}

export function playstyleLegendGradient() {
  const stops = [-1, -0.5, 0, 0.5, 1].map(getBalanceColor);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
