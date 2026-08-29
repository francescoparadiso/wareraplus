/* ══════════════════════════════════════════════════════════════
   WarEra+ — Bonus danno d'alleanza
   ------------------------------------------------------------------
   Modulo NUOVO. Riproduce il bonus che il gioco mostra nella scheda
   dell'alleanza ("Bonus danno dall'alleanza"), che l'API non espone
   come campo: va ricalcolato dai dati che abbiamo già in memoria.

   Regola del gioco: il bonus dipende dalla QUOTA di sviluppo core
   dell'alleanza sul totale mondiale. Fino a una soglia il bonus è
   pieno, oltre soglia cala di N punti per ogni punto percentuale di
   quota in eccesso, fino a un pavimento.

   Lo sviluppo usato è `coreDevelopment` (lo sviluppo "core"), NON
   `currentDevelopment` né `rankings.countryDevelopment`: i tre campi
   hanno lo stesso totale mondiale ma valori diversi per nazione, e solo
   il core riproduce i numeri della schermata di gioco. Verificato sulla
   curva pre-ribilanciamento, su Olive Union: 3007.30 / 14932.33 =
   20.14% di quota, bonus 7.43%, identico al +7.43% mostrato in gioco.

   Nessuna fetch: `coreDevelopment` sta già dentro l'oggetto nazione di
   country.getAllCountries, quindi in `state.nazioniGlobal`.

   ── RIBILANCIAMENTO DEL 1 SETTEMBRE 2026 ──────────────────────────
   Il gioco cambia la curva: bonus pieno più alto (+20%), soglia più
   bassa (10%), decadimento otto volte più ripido (-4 punti) e
   pavimento NEGATIVO (-20%). Un'alleanza troppo grande da ora è
   penalizzata, non solo non premiata: il bonus può essere < 0, e ogni
   punto della UI che lo mostra deve saperlo (segno, colore, sentinelle
   di ordinamento — vedi src/diplomacy/blocStats.js).

   Come si attiva, e perché così:
     - la curva nuova è attiva SUBITO, anche in produzione e anche prima
       del 1 settembre (SHOW_REBALANCE_EARLY). Scelta deliberata: il
       senso del tool qui è far vedere ai leader d'alleanza il mondo di
       dopo il ribilanciamento mentre c'è ancora tempo per decidere una
       fusione o una scissione. Mostrare fino all'ultimo giorno numeri
       che stanno per non valere più sarebbe stato il contrario.
     - REBALANCE_AT resta la data VERA del cambio in gioco, e serve
       ancora: finché non è passata, il tooltip della curva lo dice in
       chiaro, altrimenti chi confronta col gioco vedrebbe due numeri
       diversi senza capire perché.
   Per tornare al comportamento "commuta da sola alla data" basta
   mettere SHOW_REBALANCE_EARLY a false.

   Nota su un pezzo che NON sta qui: il gioco taglia il bonus danno
   TOTALE a -100% (sommato ai malus esistenti, un bonus d'alleanza
   negativo produrrebbe altrimenti danno negativo). WarEra+ non somma
   mai i bonus fra loro — mostra solo quello d'alleanza — quindi non
   c'è nulla da tagliare in questo modulo.
   ══════════════════════════════════════════════════════════════ */

/** Curva in vigore fino al 31 agosto 2026 incluso. */
export const RULES_LEGACY = Object.freeze({
  id: 'legacy',
  fullBonus: 10,       // punti percentuali di danno a quota bassa
  shareThreshold: 15,  // % di sviluppo mondiale entro cui il bonus è pieno
  decayPerPoint: 0.5,  // punti persi per ogni punto di quota oltre soglia
  floor: 0,            // pavimento del bonus
});

/** Curva dal 1 settembre 2026. */
export const RULES_REBALANCE = Object.freeze({
  id: '2026-09',
  fullBonus: 20,
  shareThreshold: 10,
  decayPerPoint: 4,
  floor: -20,
});

/** 1 settembre 2026, 00:00 ora di Parigi (CEST = UTC+2). */
export const REBALANCE_AT = Date.parse('2026-09-01T00:00:00+02:00');

/* import.meta.env esiste solo dentro il bundle Vite: il try tiene il
   modulo utilizzabile anche fuori (test in Node, script isolati). */
const IS_DEV = (() => {
  try { return !!import.meta.env?.DEV; } catch { return false; }
})();

/** Mostra la curva nuova già da ora, prima che il gioco la applichi.
 *  Vedi il blocco in testa al file: è il punto di questa funzione. */
export const SHOW_REBALANCE_EARLY = true;

/** La curva da usare adesso. */
export function currentRules(now = Date.now()) {
  if (IS_DEV || SHOW_REBALANCE_EARLY) return RULES_REBALANCE;
  return now >= REBALANCE_AT ? RULES_REBALANCE : RULES_LEGACY;
}

/** true finché il gioco NON ha ancora applicato il ribilanciamento: i
 *  numeri mostrati sono quelli di dopo, e va detto. */
export function isShowingFutureCurve(now = Date.now()) {
  return currentRules(now).id === RULES_REBALANCE.id && now < REBALANCE_AT;
}

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
export function bonusFromShare(sharePct, rules = currentRules()) {
  if (!Number.isFinite(sharePct)) return null;
  const excess = Math.max(0, sharePct - rules.shareThreshold);
  return Math.max(rules.floor, rules.fullBonus - rules.decayPerPoint * excess);
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

/** "+7.43%" / "-12.00%". Il segno serve: dal ribilanciamento il bonus
 *  può essere una penalità, e "+-12%" sarebbe illeggibile. */
export function formatBonus(bonus) {
  if (bonus == null) return '—';
  return `${bonus >= 0 ? '+' : ''}${bonus.toFixed(2)}%`;
}

/** true se il valore è una penalità: chi disegna decide segno e colore
 *  da qui invece di ripetere il confronto con 0 in ogni vista. */
export function isPenalty(bonus) {
  return typeof bonus === 'number' && bonus < 0;
}

/** Testo che spiega la curva in vigore. Cambia da solo insieme alla
 *  curva: la spiegazione non deve poter restare indietro rispetto ai
 *  numeri che accompagna. */
export function curveTooltip(rules = currentRules()) {
  const dec = `${rules.decayPerPoint} pt${rules.decayPerPoint === 1 ? '' : 's'}`;
  const curve = `+${rules.fullBonus}% up to ${rules.shareThreshold}% of world core development, `
    + `then -${dec} per extra point, floored at ${rules.floor}%.`;
  // Prima del 1 settembre questi numeri NON sono ancora quelli della
  // schermata di gioco: dirlo evita di far sembrare il tool sbagliato.
  return isShowingFutureCurve()
    ? `${curve} New curve — live in game from 1 September 2026, shown here already.`
    : curve;
}
