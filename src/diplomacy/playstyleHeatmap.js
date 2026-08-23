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

/** Sotto questa soglia di cittadini classificati la percentuale è rumore
 *  (una nazione con 3 membri MU noti farebbe 100% guerra con due persone). */
export const MIN_SAMPLE = 5;

/** -1 = tutta economia, 0 = equilibrio, +1 = tutta guerra. `mixed` conta
 *  come metà da entrambe le parti: sono build ibride vere, non un errore. */
export function playstyleBalance(entry) {
  if (!entry) return null;
  const war = entry.war || 0, eco = entry.eco || 0, mixed = entry.mixed || 0;
  const known = war + eco + mixed;
  if (known < MIN_SAMPLE) return null;
  return ((war + mixed / 2) - (eco + mixed / 2)) / known;
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
  const entries = [];
  for (const [countryId, entry] of Object.entries(byCountry || {})) {
    const balance = playstyleBalance(entry);
    if (balance != null) entries.push([countryId, balance]);
  }
  if (!entries.length) return COLORS.DEFAULT_LAND;

  const expr = ['match', ['get', prop]];
  for (const [countryId, balance] of entries) expr.push(countryId, getBalanceColor(balance));
  expr.push(COLORS.DEFAULT_LAND);   // campione troppo piccolo o nessun dato
  return expr;
}

/** Quante nazioni sono state effettivamente colorate e come si dividono —
 *  serve alla legenda per dire quanto è coperto il mondo. */
export function getPlaystyleStats(byCountry) {
  let colored = 0, warLeaning = 0, ecoLeaning = 0, balanced = 0, skipped = 0;
  for (const entry of Object.values(byCountry || {})) {
    const balance = playstyleBalance(entry);
    if (balance == null) { skipped++; continue; }
    colored++;
    if (balance > 0.2) warLeaning++;
    else if (balance < -0.2) ecoLeaning++;
    else balanced++;
  }
  return { colored, warLeaning, ecoLeaning, balanced, skipped };
}

export function playstyleLegendGradient() {
  const stops = [-1, -0.5, 0, 0.5, 1].map(getBalanceColor);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
