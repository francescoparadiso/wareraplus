/* ══════════════════════════════════════════════════════════════════════
   WarEra+ — Rimettere nella classifica per nazione chi il gioco ha perso
   ----------------------------------------------------------------------
   La classifica del gioco per NAZIONE di una battaglia a volte non contiene
   i cittadini di intere nazioni (Libano–Siria, 19 novembre 2026: sul lato
   siriano 349,6M di danno contro 508,3M dei giocatori, e 16.142 incassati
   contro 27.440; vedi la testata di server/battleNations.js). Il server rifà
   la somma dalla classifica per GIOCATORE raggruppata per cittadinanza.

   Qui la si fonde con quella del gioco, e di proposito NON la si sostituisce:
   la cittadinanza del server è quella di ADESSO, quella del gioco è del
   momento del colpo. Quindi:
     · se i totali del gioco tornano (scarto sotto lo 0,5%) non si tocca
       niente, anche se qualcuno nel frattempo ha cambiato cittadinanza;
     · altrimenti a ogni nazione si aggiunge solo quanto le MANCA rispetto ai
       giocatori (mai si toglie), e la somma delle aggiunte non supera lo
       scarto totale del lato (se lo supera, si riduce in proporzione);
     · quel che resta dello scarto (giocatori senza cittadinanza risolta) si
       restituisce come `unattributed`, e la vista lo dichiara.
   Usata dal dettaglio battaglia (src/battles/api.js) e dal pannello «Battle
   spending» della mappa (src/diplomacy/battleSpending.js).
   ══════════════════════════════════════════════════════════════════════ */

const TOLERANCE = 0.005;

/** Una metrica di un lato.
 *  @param {Map<string,number>} game   valore per nazione dalla classifica del gioco
 *  @param {{c:string}[]} countries    righe del server
 *  @param {'d'|'m'} key
 *  @param {number} fullTotal          totale dei giocatori del lato
 *  @returns {{ values: Map<string,number>, added: number, unattributed: number }} */
function fillMetric(game, countries, key, fullTotal) {
  const values = new Map(game);
  const gameTotal = [...game.values()].reduce((s, v) => s + v, 0);
  const gap = (fullTotal || 0) - gameTotal;
  if (!(gap > Math.max(1e-6, fullTotal * TOLERANCE))) return { values, added: 0, unattributed: 0 };
  const adds = [];
  let sumAdds = 0;
  for (const r of countries || []) {
    const a = (r[key] || 0) - (game.get(r.c) || 0);
    if (a > 0) { adds.push([r.c, a]); sumAdds += a; }
  }
  const scale = sumAdds > gap ? gap / sumAdds : 1;
  for (const [c, a] of adds) values.set(c, (values.get(c) || 0) + a * scale);
  return { values, added: sumAdds * scale, unattributed: Math.max(0, gap - sumAdds * scale) };
}

/** Righe { id, damage, money } di un lato (dettaglio battaglia), completate.
 *  @param {{id:string,damage:number,money:number}[]} rows
 *  @param {object|null} side  `sides.<lato>` della risposta /battle-nations
 *  @returns {{ rows: object[], fix: null|{damage:number,money:number,
 *            unattributedDamage:number,unattributedMoney:number} }} */
export function fillMissingNations(rows, side) {
  if (!side?.totals) return { rows, fix: null };
  const dmg = fillMetric(new Map(rows.map(r => [r.id, r.damage || 0])), side.countries, 'd', side.totals.d);
  const mon = fillMetric(new Map(rows.map(r => [r.id, r.money || 0])), side.countries, 'm', side.totals.m);
  if (!dmg.added && !mon.added && !dmg.unattributed && !mon.unattributed) return { rows, fix: null };
  const ids = new Set([...dmg.values.keys(), ...mon.values.keys()]);
  const out = [...ids]
    .map(id => ({ id, damage: dmg.values.get(id) || 0, money: mon.values.get(id) || 0 }))
    .filter(r => r.damage > 0 || r.money > 0)
    .sort((a, b) => b.damage - a.damage);
  return {
    rows: out,
    fix: {
      damage: dmg.added, money: mon.added,
      unattributedDamage: dmg.unattributed, unattributedMoney: mon.unattributed,
    },
  };
}

/** Lista { countryId, value } dell'incassato (pannello della mappa), completata.
 *  @returns {{ list: {countryId:string,value:number}[], added:number, unattributed:number }} */
export function fillMissingEarned(list, side) {
  if (!side?.totals) return { list, added: 0, unattributed: 0 };
  const r = fillMetric(new Map(list.map(x => [x.countryId, x.value || 0])), side.countries, 'm', side.totals.m);
  if (!r.added && !r.unattributed) return { list, added: 0, unattributed: 0 };
  return {
    list: [...r.values].map(([countryId, value]) => ({ countryId, value })).sort((a, b) => b.value - a.value),
    added: r.added,
    unattributed: r.unattributed,
  };
}
