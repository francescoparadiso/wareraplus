/* ══════════════════════════════════════════════════════════════
   WarEra+ — Bonus danno d'alleanza
   ------------------------------------------------------------------
   Modulo NUOVO. Riproduce il bonus che il gioco mostra nella scheda
   dell'alleanza ("Bonus danno dall'alleanza"), che l'API non espone
   come campo: va ricalcolato dai dati che abbiamo già in memoria.

   Regola del gioco (testo in-game):
     - il bonus dipende dalla QUOTA di sviluppo dell'alleanza sul totale
       mondiale;
     - fino al 15% di quota il bonus è pieno: +10%;
     - oltre soglia cala di 0.5 punti per ogni punto percentuale di
       quota in eccesso.

   Lo sviluppo usato è `coreDevelopment` (lo sviluppo "core"), NON
   `currentDevelopment` né `rankings.countryDevelopment`: i tre campi
   hanno lo stesso totale mondiale ma valori diversi per nazione, e solo
   il core riproduce i numeri della schermata di gioco. Verificato su
   Olive Union: 3007.30 / 14932.33 = 20.14% di quota, bonus 7.43%,
   identico al +7.43% mostrato in gioco.

   Nessuna fetch: `coreDevelopment` sta già dentro l'oggetto nazione di
   country.getAllCountries, quindi in `state.nazioniGlobal`.
   ══════════════════════════════════════════════════════════════ */

/** Bonus pieno, in punti percentuali di danno. */
export const FULL_BONUS = 10;
/** Quota di sviluppo mondiale (in %) fino alla quale il bonus resta pieno. */
export const SHARE_THRESHOLD = 15;
/** Punti di bonus persi per ogni punto percentuale di quota oltre soglia. */
export const DECAY_PER_POINT = 0.5;
/** Pavimento del bonus: confermato a 0 dall’utente che legge il gioco (il
 *  testo della schermata era troncato, "fino a …"). Conta solo sopra il 35%
 *  di quota (10 − 0.5 × 20), che oggi nessuna alleanza raggiunge — ci si
 *  arriva solo simulando fusioni in Alliance Builder. */
export const BONUS_FLOOR = 0;

/** Sviluppo core mondiale: somma su TUTTE le nazioni, non solo quelle
 *  alleate (il denominatore della quota è il mondo intero). */
export function worldCoreDevelopment(nations) {
  let tot = 0;
  for (const n of nations || []) tot += n?.coreDevelopment || 0;
  return tot;
}

/** Sviluppo core di un insieme di nazioni (i membri di un'alleanza). */
export function coreDevelopmentOf(members) {
  let tot = 0;
  for (const n of members || []) tot += n?.coreDevelopment || 0;
  return tot;
}

/** Bonus a partire dalla quota già calcolata, in percentuale (es. 20.14). */
export function bonusFromShare(sharePct) {
  if (!Number.isFinite(sharePct)) return null;
  const excess = Math.max(0, sharePct - SHARE_THRESHOLD);
  return Math.max(BONUS_FLOOR, FULL_BONUS - DECAY_PER_POINT * excess);
}

/**
 * Bonus danno di un gruppo di nazioni.
 * @param {Array} members  nazioni del gruppo (oggetti di state.nazioniGlobal)
 * @param {Array} allNations  tutte le nazioni, per il totale mondiale
 * @returns {{core:number, world:number, share:number, bonus:number}|null}
 *          null se il mondo non ha ancora dati (divisione per zero).
 */
export function allianceDamageBonus(members, allNations) {
  const world = worldCoreDevelopment(allNations);
  if (!world) return null;
  const core = coreDevelopmentOf(members);
  const share = (core / world) * 100;
  return { core, world, share, bonus: bonusFromShare(share) };
}

/** "+7.43%" — il segno serve: è sempre un guadagno, e va letto come tale. */
export function formatBonus(bonus) {
  if (bonus == null) return '—';
  return `+${bonus.toFixed(2)}%`;
}
